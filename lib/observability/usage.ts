import { trace, type Span } from '@opentelemetry/api';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@/lib/mcp/tools/tools';
import type { WorkOSAuthInfo } from '@/lib/auth/types';
import { resolveOrganizationId } from '@/lib/business/organization';
import { getRegion } from '@/lib/region';
import { captureToolUsage } from './posthog';
import { getLogger } from './logger';
import {
  UNKNOWN,
  type ToolOutcome,
  type ToolUsageEvent,
  type UsageSurface,
} from './usage-event';

/**
 * Per-tool-call usage accounting. Absent values are recorded as `unknown`
 * rather than omitted, so a query never has to tell a missing field from an
 * unresolvable one.
 */

const tracer = trace.getTracer('mcp-usage');

// Re-exported so callers have one import; the definitions live apart to keep
// this module and its PostHog sink out of an import cycle.
export {
  UNKNOWN,
  type ToolOutcome,
  type ToolUsageEvent,
  type UsageSurface,
} from './usage-event';

/** Derive the closed-set surface label from a route's base path. */
export function surfaceFromBasePath(basePath: string): UsageSurface {
  const segments = basePath.split('/').filter(Boolean);
  if (segments.length === 0) {
    // The aggregate server at `/mcp`, which exposes every tool.
    return { surface: 'full', scoped: false };
  }
  return { surface: segments[0]!, scoped: segments.length > 1 };
}

function workosAuth(
  authInfo: AuthInfo | undefined
): WorkOSAuthInfo | undefined {
  if (!authInfo?.extra) {
    return undefined;
  }
  const extra = authInfo.extra as WorkOSAuthInfo;
  return extra.user ? extra : undefined;
}

/**
 * Classify how the call ended. Rate limiting is separated from other tool
 * errors because it is this server's own limiter turning users away, and it is
 * read from the auth context rather than by matching on error text.
 */
export function classifyOutcome({
  authInfo,
  result,
  threw,
}: {
  authInfo: AuthInfo | undefined;
  result: unknown;
  threw: boolean;
}): ToolOutcome {
  if (!workosAuth(authInfo)) {
    return 'unauthenticated';
  }
  if (threw) {
    return 'exception';
  }
  const isError =
    typeof result === 'object' &&
    result !== null &&
    (result as { isError?: unknown }).isError === true;
  if (!isError) {
    return 'success';
  }
  return workosAuth(authInfo)?.rateLimit ? 'rate_limited' : 'tool_error';
}

function projectIdFromArgs(toolArgs: unknown): string {
  if (typeof toolArgs !== 'object' || toolArgs === null) {
    return UNKNOWN;
  }
  const projectId = (toolArgs as { projectId?: unknown }).projectId;
  return typeof projectId === 'string' && projectId ? projectId : UNKNOWN;
}

function currentRegion(): string {
  try {
    return getRegion();
  } catch {
    // A bad region already fails the deployment at boot; it must not also take
    // down the call reporting it.
    return UNKNOWN;
  }
}

export function buildToolUsageEvent({
  tool,
  surface,
  authInfo,
  toolArgs,
  organizationId,
  outcome,
  durationMs,
}: {
  tool: string;
  surface: UsageSurface;
  authInfo: AuthInfo | undefined;
  toolArgs: unknown;
  organizationId: string | undefined;
  outcome: ToolOutcome;
  durationMs: number;
}): ToolUsageEvent {
  const user = workosAuth(authInfo)?.user;
  return {
    tool,
    surface: surface.surface,
    scoped: surface.scoped,
    region: currentRegion(),
    userId: user?.id ?? UNKNOWN,
    projectId: projectIdFromArgs(toolArgs),
    organizationId: organizationId ?? UNKNOWN,
    outcome,
    durationMs,
  };
}

/**
 * Publish to both sinks. The log line is the fallback for when the trace
 * exporter is unconfigured or failing, which would otherwise take the numbers
 * silently to zero.
 */
export function recordToolUsage(span: Span, event: ToolUsageEvent): void {
  span.setAttribute('mcp.tool', event.tool);
  span.setAttribute('mcp.surface', event.surface);
  span.setAttribute('mcp.scoped', event.scoped);
  span.setAttribute('mcp.region', event.region);
  span.setAttribute('mcp.user_id', event.userId);
  span.setAttribute('mcp.project_id', event.projectId);
  span.setAttribute('mcp.organization_id', event.organizationId);
  span.setAttribute('mcp.outcome', event.outcome);
  span.setAttribute('mcp.duration_ms', event.durationMs);
  getLogger().info('mcp.usage', event);
}

/** Skipped for unauthenticated calls: no token to look one up with. */
async function organizationForUsage(
  authInfo: AuthInfo | undefined,
  toolArgs: unknown
): Promise<string | undefined> {
  const user = workosAuth(authInfo)?.user;
  if (!user || !authInfo?.token) {
    return undefined;
  }
  const projectId = projectIdFromArgs(toolArgs);
  return resolveOrganizationId({
    authToken: authInfo.token,
    userId: user.id,
    projectId: projectId === UNKNOWN ? undefined : projectId,
  });
}

/**
 * The SDK calls back as `(args, extra)` with an input schema and `(extra)`
 * without, so `extra` is found from the end rather than by index.
 */
type ToolCallback = (...args: unknown[]) => unknown;

function withUsageAccounting(
  tool: string,
  surface: UsageSurface,
  callback: ToolCallback
): ToolCallback {
  return async (...callbackArgs: unknown[]) => {
    const extra = callbackArgs[callbackArgs.length - 1] as
      | { authInfo?: AuthInfo }
      | undefined;
    const toolArgs = callbackArgs.length > 1 ? callbackArgs[0] : undefined;
    const authInfo = extra?.authInfo;

    return tracer.startActiveSpan('mcp.tool_call', async (span) => {
      const startedAt = Date.now();
      // Started here rather than awaited in `finally`: an `await` there holds
      // the tool's response until it settles, which would put a cache-miss
      // lookup on the caller's critical path. It depends on nothing the tool
      // produces, so it runs alongside instead. Rejections are absorbed now
      // because nothing awaits it until the call is over.
      const organizationId = organizationForUsage(authInfo, toolArgs).catch(
        () => undefined
      );
      let result: unknown;
      let threw = false;
      try {
        result = await callback(...callbackArgs);
        return result;
      } catch (error) {
        threw = true;
        // Rethrown unchanged: the SDK turns a throw into an `isError` result
        // for the client, and swallowing it here would change what callers see.
        throw error;
      } finally {
        const durationMs = Date.now() - startedAt;
        try {
          const event = buildToolUsageEvent({
            tool,
            surface,
            authInfo,
            toolArgs,
            organizationId: await organizationId,
            outcome: classifyOutcome({ authInfo, result, threw }),
            durationMs,
          });
          recordToolUsage(span, event);
          // Awaited, not deferred: the function can freeze the moment it
          // returns, and an in-flight event would be lost without erroring.
          await captureToolUsage(event);
        } catch {
          // Accounting is never worth failing a tool call over.
        }
        span.end();
      }
    });
  };
}

/**
 * Wrap a server so every tool registered on it is accounted for. Applied at the
 * route seam rather than per tool, so the next tool added is covered too.
 */
export function instrumentToolUsage(
  server: McpServer,
  surface: UsageSurface
): McpServer {
  // `tool()` is overloaded, but the name is always first and the callback
  // always last, so the wrapper ignores everything in between.
  const registerTool = server.tool.bind(server) as (
    ...args: unknown[]
  ) => unknown;

  const wrappedTool = (...registrationArgs: unknown[]) => {
    const lastIndex = registrationArgs.length - 1;
    const callback = registrationArgs[lastIndex];
    if (typeof callback === 'function') {
      const tool =
        typeof registrationArgs[0] === 'string' ? registrationArgs[0] : UNKNOWN;
      registrationArgs[lastIndex] = withUsageAccounting(
        tool,
        surface,
        callback as ToolCallback
      );
    }
    return registerTool(...registrationArgs);
  };

  return new Proxy(server, {
    get(target, property) {
      if (property === 'tool') {
        return wrappedTool;
      }
      // Bound to the real server: SDK methods read private fields, which a
      // proxy receiver would break.
      const value = Reflect.get(target, property) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as McpServer;
}

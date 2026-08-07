import { PostHog } from 'posthog-node';
import { getLogger } from './logger';
import { UNKNOWN, type ToolUsageEvent } from './usage-event';

/**
 * Product analytics for MCP tool calls. PostHog identifies people by the raw
 * auth-provider UID — the same WorkOS user id resolved here — so MCP usage
 * lands on the same person as that user's console and API activity, with no
 * identity mapping.
 */

/** One event for every tool, with the tool as a property. */
export const TOOL_CALL_EVENT = 'mcp.tool.call';

/** Matches what the platform sets; org insights need both to agree. */
const ORGANIZATION_GROUP = 'organization';

/**
 * Matches the platform's default. A deployment reporting elsewhere sets
 * `POSTHOG_HOST`; the host is deployment configuration, not derived from
 * `LLAMA_CLOUD_REGION`.
 */
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

let cachedClient: PostHog | null | undefined;

function resolveHost(): string {
  return process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
}

/**
 * Vercel builds a preview per branch, running the same code against the same
 * key — without this, preview traffic looks like production.
 */
function environment(): string {
  return process.env.VERCEL_ENV?.trim() || 'development';
}

/**
 * Null when unconfigured. Absent key means off, not broken: local and
 * self-hosted deployments have no project and must not fail or log per call.
 */
function getPostHogClient(): PostHog | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }
  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  if (!apiKey) {
    cachedClient = null;
    return cachedClient;
  }
  cachedClient = new PostHog(apiKey, {
    host: resolveHost(),
    // Everything goes out via `captureImmediate`, so the flush timer would
    // only ever fire on an empty queue.
    flushAt: 1,
  });
  return cachedClient;
}

/** Exposed for tests, which need a fresh client per environment permutation. */
export function resetPostHogClient(): void {
  cachedClient = undefined;
}

/** snake_case to match the platform's own events, so breakdowns behave alike. */
function toProperties(
  event: ToolUsageEvent
): Record<string, string | number | boolean> {
  const properties: Record<string, string | number | boolean> = {
    tool: event.tool,
    surface: event.surface,
    scoped: event.scoped,
    region: event.region,
    user_id: event.userId,
    project_id: event.projectId,
    outcome: event.outcome,
    duration_ms: event.durationMs,
    environment: environment(),
  };
  if (event.organizationId !== UNKNOWN) {
    properties.organization_id = event.organizationId;
  }
  return properties;
}

/**
 * `captureImmediate`, not the batching `capture`: the function can freeze the
 * moment it returns, and a queued event would be lost without erroring. An
 * undercount is worse than a gap, because it still looks like real data.
 */
export async function captureToolUsage(event: ToolUsageEvent): Promise<void> {
  const client = getPostHogClient();
  if (!client) {
    return;
  }
  if (event.userId === UNKNOWN) {
    // No person to attribute; a placeholder id would merge every such caller
    // into one shared profile.
    return;
  }

  try {
    await client.captureImmediate({
      distinctId: event.userId,
      event: TOOL_CALL_EVENT,
      properties: toProperties(event),
      groups:
        event.organizationId === UNKNOWN
          ? undefined
          : { [ORGANIZATION_GROUP]: event.organizationId },
    });
  } catch (error) {
    getLogger().warn(`Could not report usage to PostHog: ${error}`);
  }
}

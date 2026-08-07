import type { McpServer } from '@/lib/mcp/tools/tools';
import {
  UNKNOWN,
  buildToolUsageEvent,
  classifyOutcome,
  instrumentToolUsage,
  surfaceFromBasePath,
} from '../lib/observability/usage';

const USER = { id: 'user_01ABC' };

function authInfo(extra: Record<string, unknown> | undefined) {
  return {
    token: 'token',
    clientId: 'client',
    scopes: [],
    extra,
  } as unknown as Parameters<typeof classifyOutcome>[0]['authInfo'];
}

const AUTHENTICATED = authInfo({
  user: USER,
  claims: {},
  rateLimit: undefined,
});
const RATE_LIMITED = authInfo({
  user: USER,
  claims: {},
  rateLimit: 'Too many requests. Retry in 30 seconds.',
});

describe('surfaceFromBasePath', () => {
  // `/index/[indexId]` and `/classify/[configId]` embed caller-controlled ids;
  // recording them verbatim would make the label unbounded.
  it.each([
    ['', 'full', false],
    ['/parse', 'parse', false],
    ['/index/idx_0199', 'index', true],
    ['/classify/cfg_42', 'classify', true],
  ])('labels %p as %p', (basePath, surface, scoped) => {
    expect(surfaceFromBasePath(basePath)).toEqual({ surface, scoped });
  });
});

describe('classifyOutcome', () => {
  it.each([
    ['success', AUTHENTICATED, { content: [] }, false],
    ['tool_error', AUTHENTICATED, { content: [], isError: true }, false],
    ['rate_limited', RATE_LIMITED, { content: [], isError: true }, false],
    ['exception', AUTHENTICATED, undefined, true],
    ['unauthenticated', authInfo({ claims: {} }), { content: [] }, false],
    ['unauthenticated', undefined, undefined, true],
  ])('reports %s', (expected, auth, result, threw) => {
    expect(
      classifyOutcome({
        authInfo: auth as Parameters<typeof classifyOutcome>[0]['authInfo'],
        result,
        threw,
      })
    ).toBe(expected);
  });
});

describe('buildToolUsageEvent', () => {
  const base = {
    tool: 'parseFile',
    surface: { surface: 'parse', scoped: false },
    organizationId: 'org_7',
    outcome: 'success' as const,
    durationMs: 120,
  };

  it('carries the caller identity and the target project', () => {
    const event = buildToolUsageEvent({
      ...base,
      authInfo: AUTHENTICATED,
      toolArgs: { fileId: 'file_1', projectId: 'proj_9' },
    });

    expect(event).toEqual({
      tool: 'parseFile',
      surface: 'parse',
      scoped: false,
      region: 'na',
      userId: USER.id,
      projectId: 'proj_9',
      organizationId: 'org_7',
      outcome: 'success',
      durationMs: 120,
    });
  });

  it('fills every dimension when nothing is resolvable', () => {
    const event = buildToolUsageEvent({
      ...base,
      authInfo: undefined,
      // A non-string projectId is as unusable as an absent one.
      toolArgs: { projectId: 42 },
      organizationId: undefined,
    });

    expect(event).toMatchObject({
      userId: UNKNOWN,
      projectId: UNKNOWN,
      organizationId: UNKNOWN,
    });
  });
});

describe('instrumentToolUsage', () => {
  type ToolCallback = (...args: unknown[]) => unknown;

  function fakeServer() {
    const registrations: unknown[][] = [];
    const server = {
      tool: (...args: unknown[]) => {
        registrations.push(args);
      },
      unrelated: () => 'passed through',
    };
    return { server, registrations };
  }

  /** The wrapped callback the instrumented server handed to the real one. */
  function registeredCallback(registration: unknown[]): ToolCallback {
    return registration[registration.length - 1] as ToolCallback;
  }

  const surface = { surface: 'parse', scoped: false };

  it('passes arguments and results through unchanged', async () => {
    const { server, registrations } = fakeServer();
    const handler = jest.fn().mockResolvedValue({ content: [] });

    instrumentToolUsage(server as unknown as McpServer, surface).tool(
      'parseFile',
      'description',
      {},
      handler
    );

    const registration = registrations[0]!;
    expect(registration.slice(0, 3)).toEqual(['parseFile', 'description', {}]);

    const extra = { authInfo: AUTHENTICATED };
    await expect(
      registeredCallback(registration)({ fileId: 'file_1' }, extra)
    ).resolves.toEqual({ content: [] });
    expect(handler).toHaveBeenCalledWith({ fileId: 'file_1' }, extra);
  });

  it('rethrows so the SDK still reports the failure to the client', async () => {
    const { server, registrations } = fakeServer();

    instrumentToolUsage(server as unknown as McpServer, surface).tool(
      'parseFile',
      'description',
      {},
      jest.fn().mockRejectedValue(new Error('parse exploded'))
    );

    await expect(
      registeredCallback(registrations[0]!)(
        { fileId: 'file_1' },
        { authInfo: AUTHENTICATED }
      )
    ).rejects.toThrow('parse exploded');
  });

  it('handles the schemaless callback shape, where extra is the only argument', async () => {
    const { server, registrations } = fakeServer();
    const handler = jest.fn().mockResolvedValue({ content: [] });

    instrumentToolUsage(server as unknown as McpServer, surface).tool(
      'noSchema',
      handler
    );

    const extra = { authInfo: AUTHENTICATED };
    await expect(registeredCallback(registrations[0]!)(extra)).resolves.toEqual(
      { content: [] }
    );
    expect(handler).toHaveBeenCalledWith(extra);
  });

  it('leaves other server members reachable through the proxy', () => {
    const { server } = fakeServer();
    const instrumented = instrumentToolUsage(
      server as unknown as McpServer,
      surface
    ) as unknown as { unrelated: () => string };

    expect(instrumented.unrelated()).toBe('passed through');
  });
});

/**
 * @jest-environment node
 */

// Module scope, not script scope: a second test file declaring the same
// top-level names would otherwise collide with this one in the global scope.
export {};

// Captures both halves of what buildMcpRouteHandler produces: the verifier it
// hands the adapter, and the wrapped handler the API-key branch delegates to.
let verifyToken: (
  request: Request,
  token?: string
) => Promise<Record<string, unknown> | undefined>;
let wrapped: jest.Mock;

jest.mock('@vercel/mcp-adapter', () => ({
  createMcpHandler: () => jest.fn(),
  experimental_withMcpAuth: (_handler: unknown, verifier: never) => {
    verifyToken = verifier;
    wrapped = jest.fn(async () => new Response('delegated'));
    return wrapped;
  },
}));

// The real validation logic runs; only the network call underneath is faked, so
// the cache and the error classification are under test rather than mocked out.
const mockProjectsList = jest.fn();
jest.mock('../lib/business/client', () => ({
  llamaCloudClient: () => ({
    projects: { list: (...args: unknown[]) => mockProjectsList(...args) },
  }),
}));

const mockJwtVerify = jest.fn();
jest.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  createRemoteJWKSet: () => jest.fn(),
}));

process.env.WORKOS_CLIENT_ID = 'client_test';
process.env.LLAMA_CLOUD_REGION = 'na';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMcpRouteHandler } = require('../lib/mcp/handler');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { clearApiKeyCache } = require('../lib/auth/api-key');

const handler = buildMcpRouteHandler(() => {}, '/parse') as (
  request: Request
) => Promise<Response>;

const KEY = 'llx-abcdef0123456789';
const JWT = 'a.b.c';

function requestWith(token: string) {
  return new Request('https://mcp.llamaindex.ai/parse/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

function httpError(status: number) {
  return Object.assign(new Error(`status ${status}`), { status });
}

type Extra = {
  user: { id: string };
  credential?: string;
  claims: Record<string, unknown>;
};

beforeEach(() => {
  mockProjectsList.mockReset();
  mockJwtVerify.mockReset();
  // Created once when the adapter mock ran at module load, so it accumulates
  // across tests unless cleared.
  wrapped.mockClear();
  clearApiKeyCache();
});

describe('an accepted API key', () => {
  it('reaches a tool with an identity and the credential recorded', async () => {
    mockProjectsList.mockResolvedValue([]);
    const req = requestWith(KEY);

    await handler(req);
    // The branch records the key against this request; the verifier reads it
    // back. Both halves have to agree or a tool sees no caller at all.
    const info = await verifyToken(req, KEY);
    const extra = info?.extra as Extra;

    // ensureUserAuthenticated throws unless `user` is populated, so every tool
    // on the server depends on this field existing.
    expect(extra.user.id).toMatch(/^apikey:[0-9a-f]{32}$/);
    expect(extra.credential).toBe('api_key');
    expect(extra.claims).toEqual({});
    expect(info?.token).toBe(KEY);
  });

  it('rate-limits per key rather than per source address', async () => {
    mockProjectsList.mockResolvedValue([]);
    const req = requestWith(KEY);

    await handler(req);
    await verifyToken(req, KEY);

    // Without this the limiter falls back to x-forwarded-for, which collapses
    // every caller behind one corporate egress into a single budget.
    expect(req.headers.get('x-user-id')).toMatch(/^apikey:/);
  });

  it('validates once and serves the rest of the window from cache', async () => {
    mockProjectsList.mockResolvedValue([]);

    await handler(requestWith(KEY));
    await handler(requestWith(KEY));

    expect(mockProjectsList).toHaveBeenCalledTimes(1);
  });

  it('does not let two concurrent requests share one entry', async () => {
    mockProjectsList.mockResolvedValue([]);
    const first = requestWith(KEY);
    const second = requestWith(KEY);

    await Promise.all([handler(first), handler(second)]);

    // Keyed by request, not by token: both must resolve independently.
    expect((await verifyToken(first, KEY))?.extra).toBeDefined();
    expect((await verifyToken(second, KEY))?.extra).toBeDefined();
  });

  it('coalesces a concurrent burst into one round-trip', async () => {
    mockProjectsList.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5))
    );

    await Promise.all([
      handler(requestWith(KEY)),
      handler(requestWith(KEY)),
      handler(requestWith(KEY)),
    ]);

    // A session opening several tools at once against a cold cache is ordinary,
    // and without coalescing each one pays its own validation.
    expect(mockProjectsList).toHaveBeenCalledTimes(1);
  });
});

describe('a rejected API key', () => {
  it('answers 401 without steering the caller into OAuth', async () => {
    mockProjectsList.mockRejectedValue(httpError(401));

    const response = await handler(requestWith(KEY));

    expect(response.status).toBe(401);
    // The adapter's own challenge points at OAuth discovery. A caller holding
    // an API key cannot complete that flow, so the header must not be sent.
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
    expect(wrapped).not.toHaveBeenCalled();
  });

  it('accepts a key LlamaCloud recognises but declines', async () => {
    mockProjectsList.mockRejectedValue(httpError(403));

    // 403 means the credential authenticated and the action was refused, so the
    // key is good. Reading it as a bad key would let a permission gate on this
    // one route lock a valid key out of every surface for the cache window.
    expect((await handler(requestWith(KEY))).status).toBe(200);
  });

  it('reports a LlamaCloud outage as a server fault, not a bad key', async () => {
    mockProjectsList.mockRejectedValue(httpError(503));

    const response = await handler(requestWith(KEY));

    // Answering 401 here would tell every holder of a working key to go and
    // get a new one, against a platform that is simply down.
    expect(response.status).toBe(500);
    expect(wrapped).not.toHaveBeenCalled();
  });

  it('does not cache an outage as a verdict', async () => {
    mockProjectsList.mockRejectedValueOnce(httpError(503));
    mockProjectsList.mockResolvedValueOnce([]);

    await handler(requestWith(KEY));
    const second = await handler(requestWith(KEY));

    expect(second.status).toBe(200);
    expect(mockProjectsList).toHaveBeenCalledTimes(2);
  });
});

describe('the guard on unverified keys', () => {
  it('refuses a flood of unrecognised keys from one address', async () => {
    mockProjectsList.mockRejectedValue(httpError(401));
    const statuses: number[] = [];

    // Each distinct key misses the cache, so each would otherwise cost one
    // outbound call to LlamaCloud's auth path from this server's identity.
    for (let i = 0; i < 320; i++) {
      const req = new Request('https://mcp.llamaindex.ai/parse/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer llx-flood${i}`,
          'x-forwarded-for': '203.0.113.9',
        },
      });
      statuses.push((await handler(req)).status);
    }

    expect(statuses).toContain(429);
    expect(mockProjectsList.mock.calls.length).toBeLessThan(320);
  });
});

describe('the OAuth path', () => {
  it('is untouched by the API-key branch', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user_01ABC' } });
    const req = requestWith(JWT);

    await handler(req);
    const info = await verifyToken(req, JWT);
    const extra = info?.extra as Extra;

    // A JWT never reaches the validator, and still identifies by `sub`.
    expect(mockProjectsList).not.toHaveBeenCalled();
    expect(mockJwtVerify).toHaveBeenCalled();
    expect(extra.user.id).toBe('user_01ABC');
    expect(extra.credential).toBe('oauth');
  });

  it('delegates a tokenless request without validating anything', async () => {
    await handler(
      new Request('https://mcp.llamaindex.ai/parse/mcp', { method: 'POST' })
    );

    expect(mockProjectsList).not.toHaveBeenCalled();
    expect(wrapped).toHaveBeenCalled();
  });
});

describe('isApiKeyCaller', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isApiKeyCaller } = require('../lib/auth/helpers');

  it('is true only for the API-key path', () => {
    expect(isApiKeyCaller({ extra: { credential: 'api_key' } })).toBe(true);
    expect(isApiKeyCaller({ extra: { credential: 'oauth' } })).toBe(false);
  });

  it('reads a credential predating the field as OAuth', () => {
    // getUploadUrl refuses on this, so defaulting the wrong way would start
    // rejecting the OAuth callers it is meant to keep serving.
    expect(isApiKeyCaller({ extra: { user: { id: 'user_1' } } })).toBe(false);
    expect(isApiKeyCaller(undefined)).toBe(false);
  });
});

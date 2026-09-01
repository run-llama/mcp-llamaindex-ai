/**
 * @jest-environment node
 */

// Module scope, not script scope: a second test file declaring the same
// top-level names would otherwise collide with this one in the global scope.
export {};

/**
 * The sibling test mocks the adapter to drive the verifier directly. This one
 * runs the real `experimental_withMcpAuth`, because the seam that carries an
 * accepted key from the branch to a tool only exists when both halves are real:
 * the branch records the key against a request, the adapter hands that same
 * request to the verifier, and the verifier reads the entry back. If the
 * adapter ever passed a copy instead, every accepted key would fall through to
 * jwtVerify and 401 — while the mocked tests kept passing.
 *
 * Only the MCP server underneath and the network are faked.
 */

// Typed through the generic rather than a named parameter, so `mock.calls`
// carries a Request without declaring an argument the body never reads.
const innerHandler = jest.fn<Promise<Response>, [Request]>(
  async () => new Response('tool ran')
);
jest.mock('@vercel/mcp-adapter', () => {
  const actual = jest.requireActual('@vercel/mcp-adapter');
  return { ...actual, createMcpHandler: () => innerHandler };
});

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

const KEY = 'llx-integration0123456789';

function requestWith(token: string) {
  return new Request('https://mcp.llamaindex.ai/parse/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  mockProjectsList.mockReset();
  mockJwtVerify.mockReset();
  innerHandler.mockClear();
  clearApiKeyCache();
});

describe('an accepted key through the real adapter', () => {
  it('reaches the MCP handler carrying an API-key identity', async () => {
    mockProjectsList.mockResolvedValue([]);

    const response = await handler(requestWith(KEY));

    expect(response.status).toBe(200);
    expect(innerHandler).toHaveBeenCalledTimes(1);

    // The adapter sets `auth` on the request before dispatching, so this is the
    // shape a tool sees. `user` must be populated or ensureUserAuthenticated
    // rejects every call on the server.
    const dispatched = innerHandler.mock.calls[0]![0] as Request & {
      auth?: { extra?: { user?: { id: string }; credential?: string } };
    };
    expect(dispatched.auth?.extra?.user?.id).toMatch(/^apikey:[0-9a-f]{32}$/);
    expect(dispatched.auth?.extra?.credential).toBe('api_key');

    // Never verified as a JWT along the way.
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it('does not fall through to the JWT path when the key is good', async () => {
    mockProjectsList.mockResolvedValue([]);

    await handler(requestWith(KEY));

    // A WeakMap miss would land here instead, and jose would reject `llx-...`
    // as unparseable — the exact silent failure this test exists to catch.
    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(innerHandler).toHaveBeenCalled();
  });
});

describe('the OAuth path through the real adapter', () => {
  it('still verifies and dispatches unchanged', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user_01XYZ' } });

    const response = await handler(requestWith('a.b.c'));

    expect(response.status).toBe(200);
    expect(mockProjectsList).not.toHaveBeenCalled();
    const dispatched = innerHandler.mock.calls[0]![0] as Request & {
      auth?: { extra?: { user?: { id: string }; credential?: string } };
    };
    expect(dispatched.auth?.extra?.user?.id).toBe('user_01XYZ');
    expect(dispatched.auth?.extra?.credential).toBe('oauth');
  });

  it('still answers a bad JWT with the OAuth challenge', async () => {
    mockJwtVerify.mockRejectedValue(
      Object.assign(new Error('bad'), { code: 'ERR_JWS_INVALID' })
    );

    const response = await handler(requestWith('a.b.c'));

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(innerHandler).not.toHaveBeenCalled();
  });
});

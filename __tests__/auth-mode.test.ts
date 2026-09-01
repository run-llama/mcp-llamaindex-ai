/**
 * @jest-environment node
 */

// Module scope, not script scope: sibling test files declare some of the same
// top-level names and would otherwise collide in the global scope.
export {};

const innerHandler = jest.fn<Promise<Response>, [Request]>(
  async () => new Response('tool ran')
);
jest.mock('@vercel/mcp-adapter', () => {
  const actual = jest.requireActual('@vercel/mcp-adapter');
  return { ...actual, createMcpHandler: () => innerHandler };
});

const listProjects = jest.fn();
jest.mock('../lib/business/client', () => ({
  llamaCloudClient: () => ({
    projects: { list: (...args: unknown[]) => listProjects(...args) },
  }),
}));

const verifyJwt = jest.fn();
jest.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => verifyJwt(...args),
  createRemoteJWKSet: () => jest.fn(),
}));

// The deployment this file is about: no WorkOS configuration at all.
process.env.MCP_AUTH_MODE = 'api_key';
process.env.LLAMA_CLOUD_REGION = 'na';
delete process.env.WORKOS_CLIENT_ID;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMcpRouteHandler } = require('../lib/mcp/handler');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { clearApiKeyCache } = require('../lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { authMode, isOAuthEnabled } = require('../lib/auth/mode');

const handler = buildMcpRouteHandler(() => {}, '/parse') as (
  request: Request
) => Promise<Response>;

function requestWith(token: string) {
  return new Request('https://mcp.example.com/parse/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  listProjects.mockReset();
  verifyJwt.mockReset();
  innerHandler.mockClear();
  clearApiKeyCache();
  process.env.MCP_AUTH_MODE = 'api_key';
});

describe('MCP_AUTH_MODE', () => {
  it('defaults to oauth when unset or named explicitly', () => {
    delete process.env.MCP_AUTH_MODE;
    expect(authMode()).toBe('oauth');
    process.env.MCP_AUTH_MODE = 'oauth';
    expect(isOAuthEnabled()).toBe(true);
  });

  it('refuses a value it does not recognise', () => {
    process.env.MCP_AUTH_MODE = 'apikey';
    // Guessing at a typo would either take a hosted deployment's OAuth offline
    // or let a self-hosted one fail on its first request instead of at boot.
    expect(() => authMode()).toThrow(/must be "oauth" or "api_key"/);
  });
});

describe('a deployment serving API keys only', () => {
  it('boots and serves without WORKOS_CLIENT_ID', async () => {
    listProjects.mockResolvedValue([]);

    const response = await handler(requestWith('llx-selfhosted01234'));

    // The module-level throw is what used to make this mode impossible.
    expect(response.status).toBe(200);
    expect(innerHandler).toHaveBeenCalled();
  });

  it('turns a JWT away without pointing at a withdrawn document', async () => {
    const response = await handler(requestWith('a.b.c'));

    expect(response.status).toBe(401);
    // The adapter attaches resource_metadata to every 401 it builds, naming a
    // discovery document this mode answers with a 404. Sending a client there
    // is worse than telling it plainly what this server takes.
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
    expect(await response.text()).toContain('API keys only');
    expect(verifyJwt).not.toHaveBeenCalled();
  });
});

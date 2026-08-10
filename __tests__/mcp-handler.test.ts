/**
 * @jest-environment node
 */
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

// Captures the verifier callback that buildMcpRouteHandler hands the adapter,
// so it can be driven directly without standing up an MCP server.
let verifyToken: (
  request: Request,
  token?: string
) => Promise<Record<string, unknown> | undefined>;

jest.mock('@vercel/mcp-adapter', () => ({
  createMcpHandler: () => jest.fn(),
  experimental_withMcpAuth: (_handler: unknown, verifier: never) => {
    verifyToken = verifier;
    return jest.fn();
  },
}));

const mockJwtVerify = jest.fn();
let jwksUrl: URL | undefined;
jest.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  createRemoteJWKSet: (url: URL) => {
    jwksUrl = url;
    return jest.fn();
  },
}));

process.env.WORKOS_CLIENT_ID = 'client_test';
process.env.LLAMA_CLOUD_REGION = 'na';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../lib/mcp/handler').buildMcpRouteHandler(() => {}, '/parse');

const SUB = 'user_01ABCDEF';

function request() {
  return new Request('https://mcp.llamaindex.ai/parse/mcp', { method: 'POST' });
}

beforeEach(() => {
  mockJwtVerify.mockReset();
});

describe('MCP token verification', () => {
  it('identifies the caller by sub, without a directory lookup', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: SUB, iss: 'x' } });
    const req = request();

    const result = await verifyToken(req, 'a.b.c');

    // Both consumers of the identity read the same value straight off the token.
    expect((result?.extra as { user: { id: string } }).user.id).toBe(SUB);
    expect(req.headers.get('x-user-id')).toBe(SUB);
    expect(result?.token).toBe('a.b.c');
  });

  // Asserting the returned token only proves the verifier echoes its own
  // argument; these pin what was actually verified, and against which keys.
  it('verifies the presented token against the WorkOS JWKS', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: SUB } });

    await verifyToken(request(), 'a.b.c');

    expect(mockJwtVerify).toHaveBeenCalledWith('a.b.c', expect.anything());
    expect(jwksUrl?.href).toBe('https://api.workos.com/sso/jwks/client_test');
  });

  // The handler must forward the token so the message can name the sibling
  // region; dropping that argument is an easy "unused-looking" cleanup.
  it('gives a wrong-region token the sibling-region message', async () => {
    const part = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const euToken = [
      part({ alg: 'RS256', kid: 'k' }),
      part({ sub: SUB, iss: 'https://login.eu.llamaindex.ai' }),
      'sig',
    ].join('.');
    mockJwtVerify.mockRejectedValue({ code: 'ERR_JWKS_NO_MATCHING_KEY' });

    await expect(verifyToken(request(), euToken)).rejects.toThrow(
      'connect to https://mcp.eu.llamaindex.ai/mcp instead'
    );
  });

  it('passes the verified claims through untouched', async () => {
    const payload = { sub: SUB, org_id: 'org_1', exp: 123 };
    mockJwtVerify.mockResolvedValue({ payload });

    const result = await verifyToken(request(), 'a.b.c');

    expect((result?.extra as { claims: unknown }).claims).toEqual(payload);
  });

  // The mechanic the whole sibling-region message depends on: only this error
  // type is rendered as a 401 carrying the message.
  it('rejects a token fault as InvalidTokenError', async () => {
    mockJwtVerify.mockRejectedValue({ code: 'ERR_JWKS_NO_MATCHING_KEY' });

    await expect(verifyToken(request(), 'a.b.c')).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });

  // A JWKS fetch failure arrives from the same call as a bad signature. Turning
  // it into invalid_token would tell every good credential to re-authenticate
  // against the WorkOS that is down.
  it.each([
    ['a JWKS non-200', { code: 'ERR_JOSE_GENERIC' }],
    ['a JWKS timeout', { code: 'ERR_JWKS_TIMEOUT' }],
    ['a transport error', new TypeError('fetch failed')],
  ])('propagates %s as a server fault', async (_label, error) => {
    mockJwtVerify.mockRejectedValue(error);

    const thrown = await verifyToken(request(), 'a.b.c').catch((e) => e);

    expect(thrown).not.toBeInstanceOf(InvalidTokenError);
    expect(thrown).toBe(error);
  });

  it('rejects a token carrying no sub', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { iss: 'x' } });

    await expect(verifyToken(request(), 'a.b.c')).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });

  it('returns undefined when no token is presented', async () => {
    await expect(verifyToken(request(), undefined)).resolves.toBeUndefined();
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });
});

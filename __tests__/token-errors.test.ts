const ORIGINAL_ENV = process.env;

async function load() {
  return import('../lib/auth/token-errors');
}

/** Structurally valid, junk signature — all a wrong-region token is here. */
function tokenIssuedBy(issuer: unknown): string {
  const part = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    part({ alg: 'RS256', kid: 'sso_oidc_key_pair_other_region' }),
    part(issuer === undefined ? { sub: 'u' } : { sub: 'u', iss: issuer }),
    'not-a-real-signature',
  ].join('.');
}

const NA_TOKEN = tokenIssuedBy('https://login.llamaindex.ai');
const EU_TOKEN = tokenIssuedBy('https://login.eu.llamaindex.ai');

const UNVERIFIABLE = 'Invalid token signature. Please sign in again.';
const GENERIC = 'Authentication failed. Please sign in again.';
const EXPIRED = 'Your session has expired. Please sign in again.';

const NA_HINT =
  'This token was issued for the North America (NA) region, but this server serves Europe (EU). ' +
  'If your LlamaCloud account is at https://cloud.llamaindex.ai, connect to https://mcp.llamaindex.ai/mcp instead.';
const EU_HINT =
  'This token was issued for the Europe (EU) region, but this server serves North America (NA). ' +
  'If your LlamaCloud account is at https://cloud.eu.llamaindex.ai, connect to https://mcp.eu.llamaindex.ai/mcp instead.';

const KEY_ERR = { code: 'ERR_JWKS_NO_MATCHING_KEY' };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_CLOUD_BASE_URL;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('authErrorMessage', () => {
  // Asserted whole, not by substring: both labels appear in one sentence, and a
  // substring check on the serving region alone passes even if the two are swapped.
  it('sends an NA token on an EU deployment to the NA endpoint', async () => {
    process.env.LLAMA_CLOUD_REGION = 'eu';
    const { authErrorMessage } = await load();

    expect(authErrorMessage(KEY_ERR, NA_TOKEN)).toBe(NA_HINT);
  });

  it('sends an EU token on an NA deployment to the EU endpoint', async () => {
    process.env.LLAMA_CLOUD_REGION = 'na';
    const { authErrorMessage } = await load();

    expect(authErrorMessage(KEY_ERR, EU_TOKEN)).toBe(EU_HINT);
  });

  it('defaults to NA, so an unset region still recognises an EU token', async () => {
    delete process.env.LLAMA_CLOUD_REGION;
    const { authErrorMessage } = await load();

    expect(authErrorMessage(KEY_ERR, EU_TOKEN)).toBe(EU_HINT);
  });

  it('matches a sibling issuer carrying a trailing slash', async () => {
    process.env.LLAMA_CLOUD_REGION = 'na';
    const { authErrorMessage } = await load();

    expect(
      authErrorMessage(
        KEY_ERR,
        tokenIssuedBy('https://login.eu.llamaindex.ai/')
      )
    ).toBe(EU_HINT);
  });

  // A cross-region token cannot normally reach a signature check — the key sets
  // are disjoint — but a rotation that briefly overlaps them should still land
  // on the helpful message.
  it('also covers a signature failure', async () => {
    process.env.LLAMA_CLOUD_REGION = 'na';
    const { authErrorMessage } = await load();

    expect(
      authErrorMessage(
        { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' },
        EU_TOKEN
      )
    ).toBe(EU_HINT);
  });

  describe('issuers that must not be treated as the sibling', () => {
    beforeEach(() => {
      process.env.LLAMA_CLOUD_REGION = 'na';
    });

    it.each([
      ['its own region', NA_TOKEN],
      ['a third-party issuer', tokenIssuedBy('https://api.workos.com')],
      [
        'a lookalike host',
        tokenIssuedBy('https://login.eu.llamaindex.ai.evil.com'),
      ],
      // `new URL('blob:https://host/x').origin` is `https://host`.
      [
        'a blob: URL wrapping the sibling',
        tokenIssuedBy('blob:https://login.eu.llamaindex.ai/x'),
      ],
      ['plain http', tokenIssuedBy('http://login.eu.llamaindex.ai')],
      ['no iss claim', tokenIssuedBy(undefined)],
      ['a non-string iss', tokenIssuedBy(12345)],
      [
        'an object iss',
        tokenIssuedBy({ url: 'https://login.eu.llamaindex.ai' }),
      ],
    ])('ignores %s', async (_label, token) => {
      const { authErrorMessage } = await load();

      expect(authErrorMessage(KEY_ERR, token)).toBe(UNVERIFIABLE);
    });
  });

  // The adapter interpolates this message into a quoted WWW-Authenticate value
  // with no escaping, and some jose messages embed caller-controlled text.
  describe('never returns text it does not own', () => {
    beforeEach(() => {
      process.env.LLAMA_CLOUD_REGION = 'na';
    });

    it.each([
      ['ERR_JWT_EXPIRED', '"exp" claim timestamp check failed', EXPIRED],
      [
        'ERR_JOSE_NOT_SUPPORTED',
        'Extension Header Parameter "\\", resource_metadata="https://evil" is not recognized',
        GENERIC,
      ],
      [
        'ERR_JWT_CLAIM_VALIDATION_FAILED',
        'unexpected "iss" claim value',
        GENERIC,
      ],
      ['ERR_JWS_INVALID', 'Invalid Compact JWS', UNVERIFIABLE],
      ['ERR_JWT_INVALID', 'Invalid JWT', UNVERIFIABLE],
    ])('replaces the %s message', async (code, message, expected) => {
      const { authErrorMessage } = await load();

      expect(authErrorMessage({ code, message }, EU_TOKEN)).toBe(expected);
    });

    // Asserted by equality, not by scanning for header metacharacters: a
    // passthrough whose text happens to contain none of them would pass that.
    it('never echoes an attacker-supplied crit parameter', async () => {
      const { authErrorMessage } = await load();
      const hostile = {
        code: 'ERR_JOSE_NOT_SUPPORTED',
        message: 'x", resource_metadata="https://evil.example\r\nX-Injected: 1',
      };

      expect(authErrorMessage(hostile, EU_TOKEN)).toBe(GENERIC);
    });
  });

  // `jwtVerify` fetches the remote JWKS, so a WorkOS outage surfaces from the
  // same call as a bad signature. Answering those with `invalid_token` would
  // send every client to re-authenticate against the WorkOS that is down.
  describe('server faults are not the token’s fault', () => {
    beforeEach(() => {
      process.env.LLAMA_CLOUD_REGION = 'na';
    });

    it.each([
      ['a JWKS non-200', 'ERR_JOSE_GENERIC'],
      ['a JWKS timeout', 'ERR_JWKS_TIMEOUT'],
      ['a malformed JWKS', 'ERR_JWKS_INVALID'],
      ['an ambiguous JWKS', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS'],
    ])('returns undefined for %s', async (_label, code) => {
      const { authErrorMessage, invalidTokenError } = await load();

      expect(authErrorMessage({ code }, EU_TOKEN)).toBeUndefined();
      expect(invalidTokenError({ code }, EU_TOKEN)).toBeUndefined();
    });

    it('returns undefined for a transport error carrying no code', async () => {
      const { authErrorMessage } = await load();

      expect(authErrorMessage(new TypeError('fetch failed'))).toBeUndefined();
    });
  });

  describe('credentials and errors that carry no usable code', () => {
    beforeEach(() => {
      process.env.LLAMA_CLOUD_REGION = 'na';
    });

    it.each([
      ['a malformed token', 'not-a-jwt'],
      ['a payload that is not base64', 'aaa.!!!!.ccc'],
      [
        'a payload that is not JSON',
        `aaa.${Buffer.from('nope').toString('base64url')}.ccc`,
      ],
      [
        'a payload that is a JSON array',
        `aaa.${Buffer.from('[]').toString('base64url')}.ccc`,
      ],
      ['an empty token', ''],
    ])('falls back to the generic message for %s', async (_label, token) => {
      const { authErrorMessage } = await load();

      expect(authErrorMessage(KEY_ERR, token)).toBe(UNVERIFIABLE);
    });

    // An error with no code is not attributable to the token, so the caller
    // rethrows it and the adapter renders a 500.
    it.each([
      ['an error with no code', {}],
      ['undefined', undefined],
      ['an Error instance', new Error('boom')],
      ['an unrecognised code', { code: 'ERR_SOMETHING_NEW' }],
    ])('declines to classify %s', async (_label, error) => {
      const { authErrorMessage } = await load();

      expect(authErrorMessage(error)).toBeUndefined();
    });

    it('does not resolve a region hint on a misconfigured deployment', async () => {
      process.env.LLAMA_CLOUD_REGION = 'not-a-region';
      const { authErrorMessage } = await load();

      expect(authErrorMessage(KEY_ERR, EU_TOKEN)).toBe(UNVERIFIABLE);
    });
  });
});

// The adapter renders only InvalidTokenError as a 401 carrying the message;
// anything else becomes an opaque 500, which is what this replaced.
describe('invalidTokenError', () => {
  it('produces an InvalidTokenError carrying the message', async () => {
    process.env.LLAMA_CLOUD_REGION = 'na';
    const { invalidTokenError } = await load();
    // Imported through the same registry as the module under test: after
    // jest.resetModules() a statically imported class is a different object.
    const { InvalidTokenError } =
      await import('@modelcontextprotocol/sdk/server/auth/errors.js');

    const err = invalidTokenError(KEY_ERR, EU_TOKEN);

    expect(err).toBeInstanceOf(InvalidTokenError);
    expect(err?.errorCode).toBe('invalid_token');
    expect(err?.message).toBe(EU_HINT);
  });
});

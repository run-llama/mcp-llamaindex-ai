import { redisUriFromParts } from '../lib/business/kv';

// A Helm deployment supplies REDIS_* as separate variables and never a URI, so
// the discrete form has to produce the same connection the URI form does.
const ORIGINAL = { ...process.env };

function setRedisEnv(vars: Record<string, string>) {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('REDIS_')) delete process.env[k];
  }
  Object.assign(process.env, vars);
}

describe('redisUriFromParts', () => {
  afterAll(() => {
    process.env = { ...ORIGINAL };
  });

  it('returns undefined without a host, so REDIS_URI stays the only source', () => {
    setRedisEnv({});
    expect(redisUriFromParts()).toBeUndefined();
  });

  it('defaults the scheme and port', () => {
    setRedisEnv({ REDIS_HOST: 'llamacloud-redis' });
    expect(redisUriFromParts()).toBe('redis://llamacloud-redis:6379');
  });

  it('honours scheme, port and database', () => {
    setRedisEnv({
      REDIS_SCHEME: 'rediss',
      REDIS_HOST: 'r.internal',
      REDIS_PORT: '6380',
      REDIS_DB: '3',
    });
    expect(redisUriFromParts()).toBe('rediss://r.internal:6380/3');
  });

  // A password with `@` or `/` would otherwise redirect the connection to a
  // different host than the operator configured.
  it('encodes credentials that would otherwise change the target host', () => {
    setRedisEnv({
      REDIS_HOST: 'r.internal',
      REDIS_USERNAME: 'user',
      REDIS_PASSWORD: 'p@ss/word',
    });
    const uri = redisUriFromParts()!;
    expect(uri).toBe('redis://user:p%40ss%2Fword@r.internal:6379');
    expect(new URL(uri).hostname).toBe('r.internal');
  });

  // redis://::1:6379 does not parse — the port delimiter is ambiguous.
  it('brackets an IPv6 host', () => {
    setRedisEnv({ REDIS_HOST: '::1' });
    const uri = redisUriFromParts()!;
    expect(uri).toBe('redis://[::1]:6379');
    expect(new URL(uri).hostname).toBe('[::1]');
  });

  // `user:@` makes node-redis send AUTH with an empty password, which is
  // rejected — different from connecting as that user with no password.
  it('omits the password segment when only a username is set', () => {
    setRedisEnv({ REDIS_HOST: 'r.internal', REDIS_USERNAME: 'default' });
    expect(redisUriFromParts()).toBe('redis://default@r.internal:6379');
  });

  it('supports a password with no username', () => {
    setRedisEnv({ REDIS_HOST: 'r.internal', REDIS_PASSWORD: 'secret' });
    expect(redisUriFromParts()).toBe('redis://:secret@r.internal:6379');
  });
});

// The fall-through lives in the KVStore constructor, not in the helper, so it
// has to be exercised through getKVStore.
describe('KVStore construction', () => {
  afterAll(() => {
    process.env = { ...ORIGINAL };
  });

  function freshGetKVStore() {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../lib/business/kv').getKVStore as () => unknown;
  }

  // A chart or .env that renders REDIS_URI= must not shadow the discrete vars.
  it('falls through to the discrete vars when REDIS_URI is empty', () => {
    setRedisEnv({ REDIS_URI: '', REDIS_HOST: 'r.internal' });
    expect(() => freshGetKVStore()()).not.toThrow();
  });

  it('still refuses when neither form is configured', () => {
    setRedisEnv({});
    expect(() => freshGetKVStore()()).toThrow(/REDIS_URI/);
  });
});

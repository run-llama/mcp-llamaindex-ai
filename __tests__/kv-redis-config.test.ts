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

  it('supports a password with no username', () => {
    setRedisEnv({ REDIS_HOST: 'r.internal', REDIS_PASSWORD: 'secret' });
    expect(redisUriFromParts()).toBe('redis://:secret@r.internal:6379');
  });
});

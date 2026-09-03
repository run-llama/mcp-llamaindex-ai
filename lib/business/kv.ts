import { createClient } from 'redis';
import { Mutex } from 'async-mutex';

/**
 * Builds a connection URI from the discrete variables a Helm deployment
 * supplies. The chart emits REDIS_SCHEME/HOST/PORT/DB/USERNAME/PASSWORD as
 * separate Secret keys and never a URI, and a chart cannot assemble one itself
 * because the values may come from a Secret it only references by name.
 *
 * Credentials are encoded: a password containing `@` or `/` would otherwise
 * change which host the URI points at.
 */
export function redisUriFromParts(): string | undefined {
  // Trimmed because a value rendered from a Secret or a here-doc often carries
  // a trailing newline, which would make the URI unparseable.
  const host = process.env.REDIS_HOST?.trim();
  if (!host) return undefined;

  const scheme = process.env.REDIS_SCHEME?.trim() || 'redis';
  const port = process.env.REDIS_PORT?.trim() || '6379';
  const db = process.env.REDIS_DB;
  const user = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD;

  let credentials = '';
  if (user || password) {
    const encodedUser = encodeURIComponent(user ?? '');
    // `user:@` is not "no password" — node-redis sends AUTH with an empty
    // string and the server rejects it.
    credentials = password
      ? `${encodedUser}:${encodeURIComponent(password)}@`
      : `${encodedUser}@`;
  }

  // A bare IPv6 address makes the port delimiter ambiguous: redis://::1:6379
  // does not parse. An already-bracketed value is left alone — bracketing it
  // again produces `[[::1]]`, which does not parse either.
  const bracketed = host.startsWith('[') && host.endsWith(']');
  const authority = !bracketed && host.includes(':') ? `[${host}]` : host;

  return `${scheme}://${credentials}${authority}:${port}${db ? `/${db}` : ''}`;
}

class KVStore {
  private client: ReturnType<typeof createClient> | undefined = undefined;
  private uri: string;
  private mu: Mutex;

  constructor() {
    const uri = process.env.REDIS_URI?.trim() || redisUriFromParts();
    if (uri) {
      this.uri = uri;
      this.mu = new Mutex();
    } else {
      throw new Error(
        'Cannot initialize Redis client: set REDIS_URI, or REDIS_HOST with the optional REDIS_SCHEME, REDIS_PORT, REDIS_DB, REDIS_USERNAME and REDIS_PASSWORD'
      );
    }
  }

  private async getClient() {
    const client = await this.mu.runExclusive(async () => {
      if (this.client) {
        return this.client;
      }
      this.client = await createClient({ url: this.uri }).connect();
      return this.client;
    });
    return client;
  }

  async set(token: string, accessToken: string) {
    const client = await this.getClient();
    await client.set(token, accessToken, {
      expiration: {
        type: 'EX',
        value: 600, // 10 minutes
      },
    });
  }

  async get(token: string) {
    const client = await this.getClient();
    return await client.get(token);
  }

  async setFileId(token: string, fileId: string) {
    const key = `file_id:${token}`;
    const client = await this.getClient();
    await client.set(key, fileId, {
      expiration: {
        type: 'EX',
        value: 3600, // 1 hour
      },
    });
  }

  async getFileId(token: string) {
    const key = `file_id:${token}`;
    const client = await this.getClient();
    return await client.get(key);
  }

  async delete(token: string) {
    const client = await this.getClient();
    await client.del(token);
  }
}

let kvStore: KVStore | undefined = undefined;

export function getKVStore() {
  if (kvStore) {
    return kvStore;
  }
  kvStore = new KVStore();
  return kvStore;
}

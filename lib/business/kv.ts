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
  const host = process.env.REDIS_HOST;
  if (!host) return undefined;

  const scheme = process.env.REDIS_SCHEME || 'redis';
  const port = process.env.REDIS_PORT || '6379';
  const db = process.env.REDIS_DB;
  const user = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD;

  const credentials =
    user || password
      ? `${encodeURIComponent(user ?? '')}:${encodeURIComponent(password ?? '')}@`
      : '';

  return `${scheme}://${credentials}${host}:${port}${db ? `/${db}` : ''}`;
}

class KVStore {
  private client: ReturnType<typeof createClient> | undefined = undefined;
  private uri: string;
  private mu: Mutex;

  constructor() {
    const uri = process.env.REDIS_URI ?? redisUriFromParts();
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

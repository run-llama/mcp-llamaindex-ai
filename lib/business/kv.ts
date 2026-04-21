import { createClient } from 'redis';
import { Mutex } from 'async-mutex';

class KVStore {
  private client: ReturnType<typeof createClient> | undefined = undefined;
  private uri: string;
  private mu: Mutex;

  constructor() {
    const key = process.env.REDIS_URI;
    if (key) {
      this.uri = key;
      this.mu = new Mutex();
    } else {
      throw new Error(
        'Cannot initialize Redis client as REDIS_URI is not available in the current environment'
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

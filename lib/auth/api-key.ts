import 'server-only';
import { createHash } from 'crypto';
import { llamaCloudClient } from '../business/client';
import { getLogger } from '../observability/logger';

/**
 * LlamaCloud API keys. The platform matches on this prefix too, so a token
 * carrying it is an API key even when it turns out to be an invalid one — which
 * is what lets the caller be told that, rather than being pushed at OAuth.
 */
const API_KEY_PREFIX = 'llx-';

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

/**
 * A stable per-key identity, derived rather than looked up.
 *
 * The rate limiter needs to tell two keys apart before anything about the
 * caller is known, and an API key resolves to its owner only through a
 * round-trip this server does not yet make. Hashing the key gives a value that
 * is constant for a key, distinct between keys, and useless if it leaks.
 *
 * Namespaced because it lands in `user.id`, where it would otherwise be
 * mistaken for the WorkOS subject the OAuth path puts there.
 */
export function apiKeyFingerprint(token: string): string {
  return `apikey:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

/** Bounds how long a revoked key keeps working. Matches the org cache. */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** The cache lives as long as a warm instance, so it needs a ceiling. */
const MAX_CACHE_ENTRIES = 1000;

/** Short, because this is on the path of every request. */
const VALIDATION_TIMEOUT_MS = 5_000;
const VALIDATION_MAX_RETRIES = 0;

type CacheEntry = { valid: boolean; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function readCache(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Re-insert to move the entry to the end, so eviction drops the least
  // recently *used* key rather than the oldest write.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function writeCache(key: string, valid: boolean): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const evicted = cache.keys().next();
    if (!evicted.done) {
      cache.delete(evicted.value);
    }
  }
  cache.set(key, { valid, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exposed for tests; a warm instance otherwise carries entries between them. */
export function clearApiKeyCache(): void {
  cache.clear();
}

/**
 * Whether LlamaCloud accepts this key.
 *
 * There is no local check available — the server holds no secret a key could be
 * verified against — so this asks LlamaCloud. `projects.list` is the cheapest
 * authenticated call the SDK exposes, and it is one the request is likely to
 * make again anyway when usage attribution resolves the organization.
 *
 * Both answers are cached, including "no": a client looping on a mistyped key
 * would otherwise hammer the platform's auth path, and a key that is invalid
 * does not become valid.
 *
 * Throws when the failure is LlamaCloud's rather than the key's. Rejecting on a
 * timeout would tell every holder of a good credential to go and get a new one,
 * which is the same reason `lib/auth/token-errors.ts` refuses to turn a JWKS
 * outage into `invalid_token`.
 */
export async function validateApiKey(token: string): Promise<boolean> {
  const key = apiKeyFingerprint(token);
  const cached = readCache(key);
  if (cached) {
    return cached.valid;
  }

  try {
    await llamaCloudClient(token).projects.list(undefined, {
      timeout: VALIDATION_TIMEOUT_MS,
      maxRetries: VALIDATION_MAX_RETRIES,
    });
    writeCache(key, true);
    return true;
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      writeCache(key, false);
      return false;
    }
    getLogger().error(
      `Could not reach LlamaCloud to validate an API key: ${error}`
    );
    throw error;
  }
}

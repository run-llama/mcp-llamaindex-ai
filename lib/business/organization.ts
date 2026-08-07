import LlamaCloud from '@llamaindex/llama-cloud';
import { llamaCloudClient } from './client';
import { getLogger } from '../observability/logger';

/**
 * Resolve the LlamaCloud organization a caller's usage belongs to. Not the
 * WorkOS `org_id` claim — a different id space, which would group to nothing.
 */

/** Bounds staleness after a genuine move; membership rarely changes. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Best-effort, so a short budget: the client defaults suit awaited calls. */
const LOOKUP_TIMEOUT_MS = 5_000;
const LOOKUP_MAX_RETRIES = 0;

/** The cache lives as long as a warm instance, so it needs a ceiling. */
const MAX_CACHE_ENTRIES = 1000;

type CacheEntry = {
  organizationId: string | undefined;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, projectId: string | undefined): string {
  // A user can hold projects in more than one organization, so the project is
  // part of the answer's identity.
  return `${userId}\u0000${projectId ?? ''}`;
}

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

function writeCache(key: string, organizationId: string | undefined): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    // Map iterates in insertion order, and reads re-insert, so the first key
    // is the least recently used.
    const evicted = cache.keys().next();
    if (!evicted.done) {
      cache.delete(evicted.value);
    }
  }
  cache.set(key, { organizationId, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exposed for tests; a warm instance otherwise carries entries between them. */
export function clearOrganizationCache(): void {
  cache.clear();
}

const REQUEST_OPTIONS = {
  timeout: LOOKUP_TIMEOUT_MS,
  maxRetries: LOOKUP_MAX_RETRIES,
};

/**
 * A named project is fetched directly; the listing is unpaginated, so a caller
 * with enough projects could have theirs fall outside it. With none named, only
 * the default will do — an arbitrary one would name the wrong organization,
 * which is worse than recording nothing.
 */
async function fetchOrganizationId(
  client: LlamaCloud,
  projectId: string | undefined
): Promise<string | undefined> {
  if (projectId) {
    const project = await client.projects.get(
      projectId,
      undefined,
      REQUEST_OPTIONS
    );
    return project.organization_id;
  }
  const projects = await client.projects.list(undefined, REQUEST_OPTIONS);
  return projects.find((project) => project.is_default)?.organization_id;
}

export async function resolveOrganizationId({
  authToken,
  userId,
  projectId,
}: {
  authToken: string;
  userId: string;
  projectId?: string | undefined;
}): Promise<string | undefined> {
  const key = cacheKey(userId, projectId);
  const cached = readCache(key);
  if (cached) {
    return cached.organizationId;
  }

  try {
    const organizationId = await fetchOrganizationId(
      llamaCloudClient(authToken),
      projectId
    );
    writeCache(key, organizationId);
    return organizationId;
  } catch (error) {
    // Not cached: a transient API failure should not blind attribution for the
    // next ten minutes.
    getLogger().warn(`Could not resolve the organization for usage: ${error}`);
    return undefined;
  }
}

import { llamaCloudAdminClient as adminClient } from './admin-client';

/** Longest life this server will mint. */
export const MAX_EXPIRY_DAYS = 90;

export type CreatedProjectApiKey = {
  apiKeyId: string;
  name: string | null;
  projectId: string | null;
  /** The plaintext key. Returned once by the API and never retrievable again. */
  secret: string;
  expiresAt: string | null;
};

/**
 * Mint an API key scoped to one project.
 *
 * `project_id` is required here though the API allows omitting it: an unscoped
 * key reaches every project its owner can read, which is not something to hand
 * out by accident from an agent.
 *
 * The secret arrives in a field named `redacted_api_key`, which is only
 * redacted on reads — on create it is the live key. It is returned to the
 * caller and deliberately never logged or attached to a span.
 */
export async function createProjectApiKey({
  authToken,
  projectId,
  name = null,
  expiryDays = MAX_EXPIRY_DAYS,
}: {
  authToken: string;
  projectId: string;
  name?: string | null;
  expiryDays?: number;
}): Promise<CreatedProjectApiKey> {
  if (!Number.isInteger(expiryDays) || expiryDays < 1) {
    throw new Error('expiryDays must be a whole number of days, at least 1.');
  }
  if (expiryDays > MAX_EXPIRY_DAYS) {
    throw new Error(
      `expiryDays must be at most ${MAX_EXPIRY_DAYS}. Mint a shorter-lived key, or create a longer-lived one in the LlamaCloud UI where a human is present.`
    );
  }

  const expiresAt = new Date(
    Date.now() + expiryDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const created = await adminClient(authToken).apiKeys.create({
    project_id: projectId,
    name,
    expires_at: expiresAt,
    key_type: 'user',
  });

  return {
    apiKeyId: created.id,
    name: created.name ?? null,
    projectId: created.project_id ?? null,
    secret: created.redacted_api_key,
    expiresAt: created.expires_at ?? null,
  };
}

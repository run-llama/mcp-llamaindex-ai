/**
 * Which credentials this deployment accepts.
 *
 * `oauth` is the hosted product: WorkOS AuthKit plus API keys, with the OAuth
 * discovery documents advertised. `api_key` is for a self-hosted or BYOC
 * deployment, where OAuth cannot work at all — the tenant's users exist in the
 * customer's own LlamaCloud, not in our WorkOS directory — so the WorkOS
 * configuration is not required and the discovery documents are withdrawn
 * rather than pointing at an authorization server nobody can complete a flow
 * against.
 *
 * Read from the environment on every call rather than captured once, so a test
 * can set it without reloading the module graph.
 */
export type AuthMode = 'oauth' | 'api_key';

export const MCP_AUTH_MODE_VAR = 'MCP_AUTH_MODE';

export function authMode(): AuthMode {
  const raw = process.env[MCP_AUTH_MODE_VAR]?.trim();
  if (!raw || raw === 'oauth') {
    return 'oauth';
  }
  if (raw === 'api_key') {
    return 'api_key';
  }
  // Deliberately fatal rather than defaulting. The two modes differ in whether
  // WorkOS is required at boot, so guessing at a typo would either take a
  // hosted deployment's OAuth offline or let a self-hosted one fail on the
  // first request instead of at startup.
  throw new Error(
    `${MCP_AUTH_MODE_VAR} must be "oauth" or "api_key", not ${JSON.stringify(raw)}.`
  );
}

/**
 * Whether OAuth is served here.
 *
 * The mode is stated explicitly and never inferred from a missing
 * `WORKOS_CLIENT_ID`: a variable dropped from the hosted deployment's
 * configuration would otherwise silently downgrade it to API keys only, which
 * looks like working software right up until every browser client fails to
 * sign in.
 */
export function isOAuthEnabled(): boolean {
  return authMode() === 'oauth';
}

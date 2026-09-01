/**
 * Everything this server knows about the caller. For an OAuth caller that is
 * the `sub` of their token; for an API key it is a hash of the key, because
 * resolving a key to its owner would take a round-trip and no tool reads the
 * difference. Profile fields would cost another, and nothing reads those either.
 */
export type User = {
  id: string;
};

/**
 * Which credential the caller presented. Absent on anything constructed before
 * this field existed, which is why tools read it as optional and treat a
 * missing value as OAuth.
 */
export type Credential = 'oauth' | 'api_key';

export type WorkOSAuthInfo = {
  user: User;
  claims: Record<string, unknown>;
  rateLimit: string | undefined;
  credential?: Credential;
};

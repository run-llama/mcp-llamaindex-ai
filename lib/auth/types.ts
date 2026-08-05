/**
 * Everything this server knows about the caller, which is the `sub` of the
 * token they presented. Profile fields would take a WorkOS round-trip per
 * request and no tool reads them.
 */
export type User = {
  id: string;
};

export type WorkOSAuthInfo = {
  user: User;
  claims: Record<string, unknown>;
  rateLimit: string | undefined;
};

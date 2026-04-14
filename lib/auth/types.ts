export type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl?: string | null;
};

export type WorkOSAuthInfo = {
  user: User;
  claims: Record<string, unknown>;
  rateLimit: string | undefined;
};

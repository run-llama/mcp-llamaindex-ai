import { withAuth } from '@workos-inc/authkit-nextjs';
import { User } from './auth/types';

// Shared authentication utility for server components using AuthKit
export async function getAuthenticatedUser(): Promise<User | null> {
  const { user } = await withAuth();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePictureUrl: user.profilePictureUrl,
  };
}

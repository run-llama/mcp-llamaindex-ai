import { signOut } from '@workos-inc/authkit-nextjs';

export const GET = async () => {
  // This helper deletes the session cookie and redirects.
  await signOut({
    returnTo: `${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}/upload`,
  });
};

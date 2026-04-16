import { handleAuth } from '@workos-inc/authkit-nextjs';

// Redirect the user to `/` after successful sign in (default can be overridden)
export const GET = handleAuth();

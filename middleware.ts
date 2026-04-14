import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

export default authkitMiddleware();

// Only protect specific routes? For now let auth decide based on withAuth usage
export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico).*)', // all app routes
  ],
};

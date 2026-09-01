import { authkitMiddleware } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';

// Read directly rather than through lib/auth/mode: middleware is bundled for
// the edge runtime, and the mode module is server-only.
const apiKeyOnly = process.env.MCP_AUTH_MODE?.trim() === 'api_key';

/**
 * AuthKit's middleware refreshes a WorkOS session when one is present; it does
 * not require authentication, which is why the MCP routes have always done
 * their own. But it does require WorkOS to be configured, and answers every
 * request with a 500 when it is not — so on a deployment that serves API keys
 * only it would take down routes that need no session at all.
 */
export default apiKeyOnly ? () => NextResponse.next() : authkitMiddleware();

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico).*)', // all app routes
  ],
};

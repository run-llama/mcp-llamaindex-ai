import { authkitMiddleware } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';

// Read directly rather than through lib/auth/mode, which validates the value
// and throws on anything it does not recognise. Middleware runs ahead of every
// route, so a throw here is a 500 on the whole deployment; the handler already
// rejects a bad value at boot, where it is visible. Only the exact opt-in
// switches this off.
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
    // /api/healthz is excluded so the probe reports on the server rather than
    // on WorkOS configuration: in oauth mode with WorkOS unset, AuthKit throws
    // per request, which would fail the probe and crash-loop the pod.
    '/((?!_next/static|_next/image|favicon.ico|api/healthz).*)', // all app routes
  ],
};

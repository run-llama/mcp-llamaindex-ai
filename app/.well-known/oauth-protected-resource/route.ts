import { NextResponse } from 'next/server';
import { authkitOrigin } from '@/lib/authkit';
import { isOAuthEnabled } from '@/lib/auth/mode';

export async function GET(request: Request) {
  // An api_key deployment has no authorization server to name. Advertising one
  // would send a spec-conformant client into a flow it cannot complete, so the
  // document is absent rather than wrong.
  if (!isOAuthEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({
    // The origin of the request being answered, not a configured one: this
    // document must describe the server the client actually reached, or a
    // spec-conformant client rejects the mismatch. Vercel's production-URL
    // variable is wrong on every preview deployment and domain alias.
    resource: new URL(request.url).origin,
    authorization_servers: [authkitOrigin()],
    bearer_methods_supported: ['header'],
  });
}

import { NextResponse } from 'next/server';
import { authkitOrigin } from '@/lib/authkit';

export async function GET(request: Request) {
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

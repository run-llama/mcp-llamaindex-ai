import { NextResponse } from 'next/server';

export async function GET() {
  const response = await fetch(
    `https://${process.env.WORKOS_AUTHKIT_DOMAIN}/.well-known/oauth-authorization-server`
  );
  const metadata = await response.json();
  return NextResponse.json(metadata);
}

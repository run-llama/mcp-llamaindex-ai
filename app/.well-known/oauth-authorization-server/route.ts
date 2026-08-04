import { NextResponse } from 'next/server';
import { authkitOrigin } from '@/lib/authkit';

export async function GET() {
  const response = await fetch(
    `${authkitOrigin()}/.well-known/oauth-authorization-server`
  );
  const metadata = await response.json();
  return NextResponse.json(metadata);
}

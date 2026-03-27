import { NextResponse } from 'next/server';

const WORKOS_AUTHKIT_BASE_URL = process.env.WORKOS_AUTHKIT_BASE_URL!;

// Proxy WorkOS AuthKit's authorization server metadata for backward compatibility
// with MCP clients that don't support Protected Resource Metadata discovery.
export async function GET() {
  const metadataUrl = `${WORKOS_AUTHKIT_BASE_URL}/.well-known/oauth-authorization-server`;

  const upstream = await fetch(metadataUrl, {
    next: { revalidate: 3600 }, // cache for 1 hour
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'Failed to fetch authorization server metadata' },
      { status: 502 },
    );
  }

  const metadata = await upstream.json();
  const response = NextResponse.json(metadata);
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

export async function OPTIONS() {
  const response = new NextResponse('OK', { status: 200 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

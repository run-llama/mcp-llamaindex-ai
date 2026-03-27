import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const WORKOS_AUTHKIT_BASE_URL = process.env.WORKOS_AUTHKIT_BASE_URL!;

export async function GET(request: NextRequest) {
  const baseUrl =
    process.env.MCP_BASE_URL ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  const metadata = {
    resource: baseUrl,
    authorization_servers: [WORKOS_AUTHKIT_BASE_URL],
    bearer_methods_supported: ['header'],
  };

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

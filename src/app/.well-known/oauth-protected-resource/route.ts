import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  const metadata = {
    resource: `${baseUrl}/sse`,
    authorization_servers: [baseUrl],
    scopes_supported: ["api:read", "api:write"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl}/docs`
  };

  const response = NextResponse.json(metadata);
  
  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  return response;
} 

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse("OK", { status: 200 });

  // Add CORS headers for preflight requests
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return response;
} 

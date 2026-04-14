import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    resource: process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
    authorization_servers: [`https://${process.env.WORKOS_AUTHKIT_DOMAIN}`],
    bearer_methods_supported: ['header'],
  });
}

import { NextResponse } from 'next/server';
import { authkitOrigin } from '@/lib/authkit';
import { publicBaseUrl } from '@/lib/urls';

export async function GET() {
  return NextResponse.json({
    resource: publicBaseUrl(),
    authorization_servers: [authkitOrigin()],
    bearer_methods_supported: ['header'],
  });
}

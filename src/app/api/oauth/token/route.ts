import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/app/prisma';
import { randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse("OK", {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const formData = await request.formData();
  const grant_type = formData.get('grant_type') as string;
  const code = formData.get('code') as string;
  const redirect_uri = formData.get('redirect_uri') as string;
  const client_id = formData.get('client_id') as string;
  const client_secret = formData.get('client_secret') as string;

  if (grant_type !== 'authorization_code') {
    return NextResponse.json({ error: 'Unsupported grant type' }, { 
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  if (!code || !redirect_uri || !client_id || !client_secret) {
    return NextResponse.json({ error: 'Invalid request' }, { 
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  try {
    const client = await prisma.client.findUnique({ where: { clientId: client_id } });
    if (!client || client.clientSecret !== client_secret) {
      return NextResponse.json({ error: 'Invalid client' }, { 
        status: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    const authCode = await prisma.authCode.findUnique({ where: { code } });
    if (!authCode || authCode.clientId !== client.id || authCode.redirectUri !== redirect_uri) {
      return NextResponse.json({ error: 'Invalid code' }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    if (authCode.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Code expired' }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    // Delete the auth code so it can't be used again
    await prisma.authCode.delete({ where: { id: authCode.id } });

    const accessToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.accessToken.create({
      data: {
        token: accessToken,
        expiresAt,
        clientId: client.id,
        userId: authCode.userId,
      },
    });

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Server error' }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }
} 

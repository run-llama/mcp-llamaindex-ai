import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/app/prisma';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const accessToken = await prisma.accessToken.findUnique({
      where: { token },
    });

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (accessToken.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 });
    }

    return NextResponse.json({
      message: 'Success! This is a protected resource.',
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Error validating token' },
      { status: 500 },
    );
  }
} 

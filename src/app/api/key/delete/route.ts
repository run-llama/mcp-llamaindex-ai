import { NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/prisma';

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find the user by email to get the user id
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Delete all tools belonging to the user
    await prisma.tools.deleteMany({
      where: { userId: user.id },
    });

    // Null out API key fields
    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        api_key: null,
        project_id: null,
        organization_id: null,
      },
    });
    return NextResponse.json({ status: 'success' });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete API key and tools' }, { status: 500 });
  }
} 

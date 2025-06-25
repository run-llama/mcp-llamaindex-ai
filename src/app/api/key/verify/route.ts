import { NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/prisma';

export async function GET(req: Request) {
  const session = await auth();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { api_key: true, project_id: true, organization_id: true },
  });

  if (user && user.api_key && user.project_id && user.organization_id) {
    return NextResponse.json({ status: 'success' });
  } else {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }
} 

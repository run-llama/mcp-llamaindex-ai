import { NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/prisma';
import { authOptions } from '@/app/auth';

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { apiKey } = await req.json();
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.cloud.llamaindex.ai/api/v1/projects/current', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('LlamaIndex API response status:', response.status);
    if (response.status === 200) {
      const data = await response.json();
      console.log('LlamaIndex API response:', data);
      // Save api_key, project_id, organization_id to user
      await prisma.user.update({
        where: { email: session.user.email },
        data: {
          api_key: apiKey,
          project_id: data.id,
          organization_id: data.organization_id,
        },
      });
      return NextResponse.json({
        keyStatus: 'valid',
        project_id: data.id,
        organization_id: data.organization_id,
      });
    } else {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
    }
  } catch (e) {
    console.error('Error validating API key:', e);
    return NextResponse.json({ error: 'Failed to validate API key' }, { status: 500 });
  }
} 

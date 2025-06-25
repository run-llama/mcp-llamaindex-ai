import { NextRequest, NextResponse } from "next/server";
import { auth } from '@/app/auth';
import { prisma } from '@/app/prisma';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch the user's API key and id from the database
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { api_key: true, id: true },
  });

  if (!user?.api_key || !user?.id) {
    return NextResponse.json({ error: 'No API key found' }, { status: 401 });
  }

  try {
    const res = await fetch("https://api.cloud.llamaindex.ai/api/v1/pipelines", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${user.api_key}`,
      },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch indexes" }, { status: res.status });
    }
    const data = await res.json();
    let indexes = Array.isArray(data) ? data : (data?.data || []);

    // Fetch all tools for this user
    const tools = await prisma.tools.findMany({
      where: { userId: user.id },
      select: { indexId: true, config: true },
    });
    const toolMap = new Map(tools.map(t => [t.indexId, t.config]));

    // Add tool_config to each index if present
    indexes = indexes.map((idx: any) => {
      const id = idx.id || idx.name;
      if (toolMap.has(id)) {
        return { ...idx, tool_config: toolMap.get(id) };
      }
      return idx;
    });

    return NextResponse.json({ indexes });
  } catch (error) {
    return NextResponse.json({ error: "Error fetching indexes" }, { status: 500 });
  }
} 

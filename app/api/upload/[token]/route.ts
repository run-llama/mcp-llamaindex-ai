import { getKVStore } from '@/lib/business/kv';
import { NextRequest, NextResponse } from 'next/server';
import LlamaCloud from '@llamaindex/llama-cloud';

// @ts-expect-error params is implictly any
export async function POST(req: NextRequest, { params }) {
  const { token } = await params; // NextJS requires this to be awaited even if it doesn't seem to need it
  if (!token) {
    return NextResponse.json(
      { detail: 'Token not found in request URL' },
      { status: 400 }
    );
  }
  const kvStore = getKVStore();
  const fileId = await kvStore.getFileId(token);
  if (fileId) {
    return NextResponse.json({ file_id: fileId }, { status: 200 });
  }
  const authToken = await kvStore.get(token);
  if (!authToken) {
    return NextResponse.json(
      { detail: 'Token is invalid or expired' },
      { status: 404 }
    );
  }
  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json(
      {
        detail:
          '`file` not found in form data or file is a string (which is not allowed)',
      },
      { status: 400 }
    );
  }
  const purpose = req.nextUrl.searchParams.get('purpose') ?? 'parse';
  const projectId = req.nextUrl.searchParams.get('project_id') ?? undefined;
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
  });
  try {
    const fileObj = await client.files.create({
      file,
      purpose,
      project_id: projectId,
    });
    // invalidate token only on success
    await kvStore.delete(token);
    // store file ID
    await kvStore.setFileId(token, fileObj.id);
    return NextResponse.json({ file_id: fileObj.id }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      {
        detail: `File upload failed because of ${e}. If less than 10 minutes have passed since the generation of the token, you will be able to retry with the same URL, otherwise you'll have to obtain a new one`,
      },
      { status: 500 }
    );
  }
}

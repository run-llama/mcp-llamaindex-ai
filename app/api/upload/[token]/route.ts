import { getKVStore } from '@/lib/business/kv';
import { NextRequest, NextResponse } from 'next/server';
import LlamaCloud from '@llamaindex/llama-cloud';
import { llamaCloudBaseUrl } from '@/lib/region';
import { getLogger } from '@/lib/observability/logger';

// @ts-expect-error params is implictly any
export async function POST(req: NextRequest, { params }) {
  const { token } = await params; // NextJS requires this to be awaited even if it doesn't seem to need it
  if (!token) {
    return NextResponse.json(
      { detail: 'Token not found in request URL' },
      { status: 400 }
    );
  }
  // Everything that can throw belongs inside: getKVStore() throws when REDIS_URI
  // is unset, the Redis reads reject when it is unreachable, and formData()
  // rejects on a malformed body. Callers parse `detail`, and the browser form
  // renders the raw response text, so an HTML 500 surfaces as a wall of markup.
  try {
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
      baseURL: llamaCloudBaseUrl(),
    });
    const fileObj = await client.files.create({
      file,
      purpose,
      project_id: projectId,
    });
    // The file is uploaded and billed by this point, so bookkeeping must not
    // fail the request: a 500 here would have the caller retry and pay twice,
    // and the id it already earned would be lost.
    try {
      await kvStore.setFileId(token, fileObj.id);
      await kvStore.delete(token);
    } catch (e) {
      getLogger().error(`Upload succeeded but token bookkeeping failed: ${e}`);
    }
    return NextResponse.json({ file_id: fileObj.id }, { status: 200 });
  } catch (e) {
    // Never interpolate the error: this endpoint is reachable before the token
    // is validated, and the browser form renders the response body verbatim, so
    // a Redis or config failure would put internal detail in front of any
    // caller. The token is still valid here — it is consumed only after a
    // successful upload — so the retry advice is accurate.
    getLogger().error(`Upload failed: ${e}`);
    return NextResponse.json(
      {
        detail:
          "File upload failed. If less than 10 minutes have passed since the generation of the token, you will be able to retry with the same URL, otherwise you'll have to obtain a new one",
      },
      { status: 500 }
    );
  }
}

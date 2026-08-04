import { NextResponse } from 'next/server';
import { authkitOrigin } from '@/lib/authkit';
import { getLogger } from '@/lib/observability/logger';

const UPSTREAM_TIMEOUT_MS = 5000;

export async function GET() {
  // Outside the try: a bad WORKOS_AUTHKIT_DOMAIN is permanent, and answering
  // 502 would have clients retry it forever. Let it surface as a 500, which is
  // what the sibling protected-resource route does with the same failure.
  const origin = authkitOrigin();

  try {
    const response = await fetch(
      `${origin}/.well-known/oauth-authorization-server`,
      { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
    );
    // Forward the upstream failure as a failure. Re-serving an error body at 200
    // would have clients accept it as metadata, and defeats their retry-on-5xx.
    if (!response.ok) {
      throw new Error(`upstream responded ${response.status}`);
    }
    // Inside the try: a 200 carrying HTML, or an abort that fires while the
    // body is still streaming, rejects here.
    const metadata = await response.json();
    return NextResponse.json(metadata, {
      headers: {
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    });
  } catch (e) {
    getLogger().error(`AuthKit metadata proxy failed: ${e}`);
    return NextResponse.json(
      { error: 'temporarily_unavailable' },
      { status: 502 }
    );
  }
}

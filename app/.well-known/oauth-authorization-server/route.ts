import { NextResponse } from 'next/server';
import { authkitOrigin } from '@/lib/authkit';

const UPSTREAM_TIMEOUT_MS = 5000;

export async function GET() {
  let response: Response;
  try {
    response = await fetch(
      `${authkitOrigin()}/.well-known/oauth-authorization-server`,
      { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
    );
  } catch {
    return NextResponse.json(
      { error: 'temporarily_unavailable' },
      { status: 502 }
    );
  }

  // Forward the upstream failure as a failure. Re-serving an error body at 200
  // would have clients accept it as metadata, and defeats their retry-on-5xx.
  if (!response.ok) {
    return NextResponse.json(
      { error: 'temporarily_unavailable' },
      { status: 502 }
    );
  }

  const metadata = await response.json();
  return NextResponse.json(metadata, {
    headers: {
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}

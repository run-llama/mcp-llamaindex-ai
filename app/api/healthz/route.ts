import { NextResponse } from 'next/server';

// Liveness/readiness target for orchestrators. Deliberately checks nothing:
// Redis and LlamaCloud are reached lazily per request, so failing this probe on
// a dependency blip would restart a pod that is still able to serve everything
// not touching that dependency. The chart's shared deployment template calls
// all three probes unconditionally, so this endpoint has to exist.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}

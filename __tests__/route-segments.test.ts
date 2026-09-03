import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// A route segment literally named `index` builds to
// .next/server/app/<parent>/index/<rest>, one level deeper than its own route.
// `next start` resolves that from the manifest, so it works locally and 404s on
// Vercel, which packages functions by path. /index/mcp shipped broken in both
// prod regions for two weeks that way. Serve such a URL through a rewrite
// instead — see next.config.ts.
function segments(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    acc.push(entry);
    segments(full, acc);
  }
  return acc;
}

describe('app route segments', () => {
  it('has no directory named "index"', () => {
    const offenders = segments(join(__dirname, '..', 'app')).filter(
      (s) => s === 'index'
    );
    expect(offenders).toEqual([]);
  });
});

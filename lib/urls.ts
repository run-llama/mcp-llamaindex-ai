/**
 * Normalise a configured host or URL into an absolute URL with no trailing
 * slash. Several deployment variables are documented with a scheme but set to a
 * bare host in production, so both forms are accepted.
 */
export function normalizeBaseUrl(raw: string, varName: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${varName} environment variable is empty`);
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`${varName} is not a valid URL: "${raw}"`);
  }
  if (url.search || url.hash) {
    throw new Error(
      `${varName} must not carry a query or fragment: "${raw}" (RFC 9728 requires a bare resource identifier)`
    );
  }

  return withScheme.replace(/\/+$/, '');
}

/**
 * Public base URL of this deployment, as an absolute URL.
 *
 * Client-safe: the only variable read is `NEXT_PUBLIC_`, spelled out in full so
 * Next substitutes it at build time in both the server and client bundles.
 */
export function publicBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (!raw) {
    throw new Error(
      'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL environment variable not set'
    );
  }
  return normalizeBaseUrl(raw, 'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL');
}

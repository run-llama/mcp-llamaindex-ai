/**
 * Normalise a configured host or URL into a canonical absolute URL with no
 * trailing slash. Several deployment variables are documented with a scheme but
 * set to a bare host in production, so both forms are accepted.
 *
 * The result is built from the parsed URL rather than the input string, so host
 * case and IDN reach consumers in the form the network actually uses.
 */
export function normalizeBaseUrl(raw: string, varName: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${varName} environment variable is empty`);
  }

  // Checked against the raw text, not the parsed URL: `URL.search` and
  // `URL.hash` are both empty strings for a lone trailing `?` or `#`, so a
  // truthiness test on them lets those delimiters through, and they go on to
  // corrupt every path concatenated onto the result.
  if (/[?#]/.test(trimmed)) {
    throw new Error(`${varName} must not carry a query or fragment`);
  }

  if (trimmed.startsWith('//')) {
    throw new Error(
      `${varName} must be an absolute URL or a bare host, not protocol-relative`
    );
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    // Without this the value is prefixed into `https://ftp://host`, which
    // parses cleanly with the single-label host `ftp`.
    throw new Error(`${varName} must use http or https, not "${scheme}:"`);
  }

  const withScheme = scheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`${varName} is not a valid URL`);
  }
  if (!url.hostname) {
    throw new Error(`${varName} has no host`);
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Public base URL of this deployment, as a canonical absolute URL.
 *
 * For contexts with no incoming request to derive an origin from — the
 * `getUploadUrl` tool hands this to a remote agent. Anything answering an HTTP
 * request should use that request's own origin instead, so the value stays
 * correct on preview deployments and domain aliases.
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

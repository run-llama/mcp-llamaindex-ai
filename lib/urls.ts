/**
 * Constraints a caller places on a configured URL. The three consumers of this
 * helper do not want the same thing: an OAuth issuer must be an https origin
 * with no path, while the upload base URL is allowed a path and allowed http
 * against localhost.
 */
export type NormalizeOptions = {
  /** Reject a path component. For values used as an origin or an issuer. */
  originOnly?: boolean;
  /** Reject cleartext http. */
  requireHttps?: boolean;
};

/**
 * Normalise a configured host or URL into a canonical absolute URL with no
 * trailing slash. Several deployment variables are documented with a scheme but
 * set to a bare host in production, so both forms are accepted.
 *
 * The result is built from the parsed URL rather than the input string, so host
 * case and IDN reach consumers in the form the network actually uses.
 */
export function normalizeBaseUrl(
  raw: string,
  varName: string,
  opts: NormalizeOptions = {}
): string {
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

  // The WHATWG parser treats a backslash like a slash in the authority, so
  // `\\host` silently becomes `https://host`. Refuse both spellings of an
  // authority-only value rather than accepting one and rejecting the other.
  if (/^[/\\]/.test(trimmed) || trimmed.includes('\\')) {
    throw new Error(
      `${varName} must be an absolute URL or a bare host, not protocol-relative`
    );
  }

  // Requires `://`, so a bare `host:port` is not misread as a scheme named
  // after its own hostname.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
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
  // Canonicalising through `url.origin` would drop these silently. Say so
  // instead: an operator who put credentials here needs to know they are unused,
  // and fetch() refuses a URL that carries them.
  if (url.username || url.password) {
    throw new Error(`${varName} must not embed credentials`);
  }
  if (opts.requireHttps && url.protocol !== 'https:') {
    throw new Error(
      `${varName} must use https — "${url.protocol}" would carry OAuth codes and tokens in cleartext.`
    );
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (opts.originOnly && path) {
    throw new Error(`${varName} must be an origin, with no path ("${path}")`);
  }

  return `${url.origin}${path}`;
}

/**
 * Public base URL of this deployment, as a canonical absolute URL.
 *
 * For contexts with no incoming request to derive an origin from — the
 * `getUploadUrl` tool hands this to a remote agent. Anything answering an HTTP
 * request should use that request's own origin instead, so the value stays
 * correct on preview deployments and domain aliases. A path is permitted here:
 * this is an upload base, not an origin.
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

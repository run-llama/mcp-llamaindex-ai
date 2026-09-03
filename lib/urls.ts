/**
 * Hosts that never leave the machine. Used to decide where cleartext http is
 * acceptable, and shared with the region guard so both layers agree on what
 * "local" means.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '[::1]' ||
    h === '0.0.0.0' ||
    /^127\./.test(h)
  );
}

/**
 * Hosts reachable only from inside the cluster this server runs in. Cleartext
 * is acceptable to these for the same reason it is to loopback: the traffic
 * never crosses a network the operator does not control.
 *
 * This exists because every other component in the LlamaCloud chart already
 * talks to its siblings over `http://<service>:80` — the frontend proxies
 * authenticated API traffic that way today. Refusing it here would make the MCP
 * server the only workload that cannot be wired the standard way, without
 * protecting anything its neighbours are not already sending.
 *
 * Decided from the name alone, so the check stays synchronous: resolving DNS
 * during config validation would make startup depend on the resolver, and a
 * resolver answer can change after the check anyway.
 */
export function isClusterInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Bracketed IPv6. Unique-local (fc00::/7) and link-local (fe80::/10) only.
  if (h.startsWith('[')) {
    return /^\[(f[cd]|fe[89ab])/.test(h);
  }

  // A single-label name has no meaning in public DNS: `llamacloud` can only be
  // a Service in the same namespace, or a hosts-file entry.
  if (!h.includes('.')) return true;

  if (h.endsWith('.svc') || h.endsWith('.svc.cluster.local')) return true;

  // RFC1918 and link-local literals.
  return (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h)
  );
}

/**
 * Constraints a caller places on a configured URL. The consumers of this helper
 * do not all want the same thing, and the differences are load-bearing: an
 * OAuth issuer must be an https origin with no path, while a base URL that
 * paths get appended to must simply not carry one of its own.
 */
export type NormalizeOptions = {
  /** Reject a path component. For values used as an origin or an issuer. */
  originOnly?: boolean;
  /** Reject cleartext http, except against a loopback host. */
  requireHttps?: boolean;
};

/**
 * Normalise a configured host or URL into a canonical absolute URL with no
 * trailing slash. Several deployment variables are documented with a scheme but
 * set to a bare host in production, so both forms are accepted.
 *
 * The result is built from the parsed URL rather than the input string, so host
 * case, IDN and a trailing dot reach consumers in the form the network wants.
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

  // A scheme is a prefix before `:` that is not followed by a digit. Requiring
  // `://` instead would misread `https:/host` (one slash, which the URL parser
  // repairs) as having no scheme; testing only for `:` would misread the port
  // in a bare `localhost:8000` as a scheme named after its own host.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i
    .exec(trimmed)?.[1]
    ?.toLowerCase();
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

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) {
    throw new Error(`${varName} has no host`);
  }
  // Canonicalising would drop these silently. Say so instead: an operator who
  // put credentials here needs to know they are unused, and fetch() refuses a
  // URL that carries them.
  if (url.username || url.password) {
    throw new Error(`${varName} must not embed credentials`);
  }
  if (
    opts.requireHttps &&
    url.protocol !== 'https:' &&
    !isLoopbackHostname(hostname)
  ) {
    throw new Error(
      `${varName} must use https for "${hostname}" — cleartext would expose what this URL carries.`
    );
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (opts.originOnly && path) {
    throw new Error(`${varName} must be an origin, with no path ("${path}")`);
  }

  // Rebuilt rather than taken from `url.origin`, which keeps a trailing dot;
  // that dot is forbidden in the TLS SNI extension and many edge terminators
  // reject it, so it must not reach a client.
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${hostname}${port}${path}`;
}

/**
 * Public base URL of this deployment, as a canonical absolute origin.
 *
 * For contexts with no incoming request to derive an origin from — the
 * `getUploadUrl` tool hands this to a remote agent. Anything answering an HTTP
 * request should use that request's own origin instead, so the value stays
 * correct on preview deployments and domain aliases.
 *
 * originOnly, because both consumers append an absolute app path to it and no
 * basePath is configured; requireHttps, because the URL built from it carries a
 * one-time upload token and the document body to a third party.
 */
export function publicBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (!raw) {
    throw new Error(
      'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL environment variable not set'
    );
  }
  return normalizeBaseUrl(raw, 'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL', {
    originOnly: true,
    requireHttps: true,
  });
}

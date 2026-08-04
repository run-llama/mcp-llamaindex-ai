import 'server-only';
import { normalizeBaseUrl } from './urls';

/**
 * Origin of the WorkOS AuthKit domain this deployment authenticates against —
 * the OAuth issuer, and the host its discovery documents are proxied from.
 *
 * `WORKOS_AUTHKIT_DOMAIN` has no `NEXT_PUBLIC_` prefix, so it does not exist in
 * the browser. The `server-only` import makes a client import a build error
 * rather than an `undefined` that surfaces on first user interaction.
 */
export function authkitOrigin(): string {
  const raw = process.env.WORKOS_AUTHKIT_DOMAIN;
  if (!raw) {
    throw new Error('WORKOS_AUTHKIT_DOMAIN environment variable not set');
  }
  return normalizeBaseUrl(raw, 'WORKOS_AUTHKIT_DOMAIN', {
    // This value becomes the advertised OAuth issuer and the host the discovery
    // proxy fetches from. A path would put the metadata somewhere RFC 8414 does
    // not look, and http would carry authorization codes and tokens in the clear.
    originOnly: true,
    requireHttps: true,
  });
}

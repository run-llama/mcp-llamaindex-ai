import { normalizeBaseUrl } from './urls';

/**
 * Origin of the WorkOS AuthKit domain this deployment authenticates against —
 * the OAuth issuer, and the host its discovery documents are proxied from.
 *
 * Server-only: `WORKOS_AUTHKIT_DOMAIN` is not a `NEXT_PUBLIC_` variable, so it
 * resolves to `undefined` in the browser. Do not import this from a client
 * component.
 */
export function authkitOrigin(): string {
  const raw = process.env.WORKOS_AUTHKIT_DOMAIN;
  if (!raw) {
    throw new Error('WORKOS_AUTHKIT_DOMAIN environment variable not set');
  }
  return normalizeBaseUrl(raw, 'WORKOS_AUTHKIT_DOMAIN');
}

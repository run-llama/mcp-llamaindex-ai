import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { regionProfile, siblingProfile } from '../region';

/**
 * jose codes meaning the token could not be tied to one of this region's
 * signing keys.
 *
 * `ERR_JWKS_NO_MATCHING_KEY` is the one a wrong-region token actually produces:
 * the regions are separate WorkOS environments with disjoint key sets, and
 * `jwtVerify` resolves the key by `kid` before it checks the signature and long
 * before it validates any claim — so an `issuer` option would never fire here.
 * The signature code is included so a key rotation that briefly leaves the two
 * sets overlapping still reaches the helpful message.
 */
const UNVERIFIABLE_TOKEN_CODES = new Set([
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
]);

const EXPIRED = 'Your session has expired. Please sign in again.';
const UNVERIFIABLE = 'Invalid token signature. Please sign in again.';
const GENERIC = 'Authentication failed. Please sign in again.';

/**
 * Messages this module owns, keyed by the error code that earns them.
 *
 * The set is closed on purpose. `@vercel/mcp-adapter` interpolates whatever it
 * is given into a quoted `WWW-Authenticate` value with no escaping, and some
 * jose messages embed caller-controlled text — `ERR_JOSE_NOT_SUPPORTED` quotes
 * an unrecognised `crit` header parameter name straight from the request, which
 * would let an unauthenticated caller inject their own auth-params. Others
 * merely embed quotes that break the header grammar. Nothing outside this file
 * reaches a client; the full error still goes to the log.
 */
const OWNED_MESSAGES = new Map([
  ['ERR_JWT_EXPIRED', EXPIRED],
  ['ERR_JWS_INVALID', UNVERIFIABLE],
  ['ERR_JWT_INVALID', UNVERIFIABLE],
]);

function httpsOriginOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    // Scheme-checked because `new URL('blob:https://host/x').origin` is
    // `https://host`, which would otherwise match a region.
    return url.protocol === 'https:' ? url.origin.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `iss` claim of a JWT, read without verifying it.
 *
 * Hand-decoded rather than via jose's `decodeJwt` only because jose is ESM-only
 * and `next/jest` will not transform it, which would leave this module
 * untestable.
 */
function unverifiedIssuer(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const { iss } = JSON.parse(json) as { iss?: unknown };
    return typeof iss === 'string' ? iss : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Trusting an unverified claim is safe here and nowhere else: this runs only
 * after verification has already failed, it chooses the wording of a rejection,
 * and nothing downstream treats the request as authenticated. Forging `iss`
 * changes only the error text the forger receives.
 */
function tokenBelongsToSibling(token: string, sibling: RegionLabels): boolean {
  const iss = unverifiedIssuer(token);
  return (
    iss !== undefined &&
    httpsOriginOf(iss) === sibling.authkitIssuerOrigin.toLowerCase()
  );
}

type RegionLabels = ReturnType<typeof siblingProfile>;

/**
 * The message an MCP client sees when its token is rejected.
 *
 * An expired token and a wrong-region token look identical to a user and have
 * completely different fixes, so only the second gets the region wording —
 * sending someone whose session merely lapsed to another server points them at
 * a region their account does not exist in.
 */
export function authErrorMessage(error: unknown, token?: string): string {
  const { code } = (error ?? {}) as { code?: string };
  if (!code) {
    return GENERIC;
  }

  if (UNVERIFIABLE_TOKEN_CODES.has(code)) {
    // Resolving the region can itself throw on a misconfigured deployment, and
    // this runs inside a catch block.
    let sibling: RegionLabels | undefined;
    let serving: string | undefined;
    try {
      sibling = siblingProfile();
      serving = regionProfile().label;
    } catch {
      return UNVERIFIABLE;
    }

    if (token && tokenBelongsToSibling(token, sibling)) {
      return (
        `This token was issued for the ${sibling.label} region, but this server serves ${serving}. ` +
        `If your LlamaCloud account is at ${sibling.consoleUrl}, connect to ${sibling.mcpUrl}/mcp instead.`
      );
    }
    return UNVERIFIABLE;
  }

  return OWNED_MESSAGES.get(code) ?? GENERIC;
}

/**
 * `InvalidTokenError`, not a bare `Error`: the adapter renders only this type
 * as a 401 carrying the message in `WWW-Authenticate`, which is both what the
 * client shows and the signal telling it to re-authenticate. Anything else it
 * does not recognise becomes an opaque 500 and the message is lost.
 */
export function invalidTokenError(
  error: unknown,
  token?: string
): InvalidTokenError {
  return new InvalidTokenError(authErrorMessage(error, token));
}

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
const UNVERIFIABLE_CODES = [
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
] as const;
const UNVERIFIABLE_TOKEN_CODES = new Set<string>(UNVERIFIABLE_CODES);

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
const OWNED = [
  ['ERR_JWT_EXPIRED', EXPIRED],
  ['ERR_JWS_INVALID', UNVERIFIABLE],
  ['ERR_JWT_INVALID', UNVERIFIABLE],
] as const;
const OWNED_MESSAGES = new Map<string, string>(OWNED);

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
 * Codes that mean the *presented token* is at fault.
 *
 * An allow-list, because `jwtVerify` also fetches the remote JWKS: a WorkOS
 * outage, a timeout or a DNS failure surfaces from the same call as a bad
 * signature. Those are server faults, and answering them with `invalid_token`
 * would tell every client holding a good credential to re-authenticate —
 * against the same WorkOS that is down. Narrowing the caller's `try` cannot
 * separate them; only the code can.
 */
const TOKEN_FAULT_CODES = new Set<string>([
  ...UNVERIFIABLE_CODES,
  ...OWNED.map(([code]) => code),
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  // The `crit` header the client sent names a parameter this server does not
  // implement — malformed input, not a server problem.
  'ERR_JOSE_NOT_SUPPORTED',
]);

/**
 * The message an MCP client sees when its token is rejected, or `undefined`
 * when the failure was not the token's fault and the caller should let the
 * error surface as a server error.
 *
 * An expired token and a wrong-region token look identical to a user and have
 * completely different fixes, so only the second gets the region wording.
 */
export function authErrorMessage(
  error: unknown,
  token?: string
): string | undefined {
  const { code } = (error ?? {}) as { code?: string };
  if (!code || !TOKEN_FAULT_CODES.has(code)) {
    return undefined;
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
 * The error to throw for a rejected token, or `undefined` when the failure was
 * not the token's fault.
 *
 * `InvalidTokenError` because the adapter renders only this type as a 401
 * carrying the message in `WWW-Authenticate`, which is both what the client
 * shows and the signal telling it to re-authenticate. Anything else it does not
 * recognise becomes an opaque 500 — which is the right answer for a server
 * fault, and the reason this returns `undefined` rather than guessing.
 */
export function invalidTokenError(
  error: unknown,
  token?: string
): InvalidTokenError | undefined {
  const message = authErrorMessage(error, token);
  return message === undefined ? undefined : new InvalidTokenError(message);
}

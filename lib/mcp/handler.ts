import {
  createMcpHandler,
  experimental_withMcpAuth,
} from '@vercel/mcp-adapter';
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { WorkOSAuthInfo } from '@/lib/auth/types';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getLogger } from '@/lib/observability/logger';
import { extractRateLimitFromResponse } from '@/lib/auth/helpers';
import { invalidTokenError } from '@/lib/auth/token-errors';
import {
  apiKeyFingerprint,
  cachedApiKeyVerdict,
  isApiKeyToken,
  validateApiKey,
} from '@/lib/auth/api-key';
import {
  instrumentToolUsage,
  surfaceFromBasePath,
} from '@/lib/observability/usage';
import type { McpServer } from '@/lib/mcp/tools/tools';
import { isOAuthEnabled } from '@/lib/auth/mode';

const oauthEnabled = isOAuthEnabled();
const clientId = process.env.WORKOS_CLIENT_ID;

// Still fatal at boot, but only where OAuth is actually served. A self-hosted
// deployment has no WorkOS directory to point at, so requiring the variable
// there would make the mode unusable rather than safe.
if (oauthEnabled && !clientId) {
  throw new Error('WORKOS_CLIENT_ID environment variable not set');
}

// Shared in-memory rate limiter: 100 requests per 60-second sliding window per key
// (+4 for connection-time authentication round-trips).
const rateLimiter = new RateLimiterMemory({
  points: 104,
  duration: 60,
});

async function applyRateLimit(request: Request): Promise<Response | null> {
  const key =
    request.headers.get('x-user-id') ||
    request.headers.get('x-forwarded-for') ||
    '127.0.0.1';
  try {
    await rateLimiter.consume(key);
    return null;
  } catch (res) {
    const retryAfter = Math.ceil((res as RateLimiterRes).msBeforeNext / 1000);
    return new Response('Too many requests, please try again later.', {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    });
  }
}

/**
 * Guards the outbound call an unrecognised API key triggers.
 *
 * Separate from the limiter above, and keyed by source address rather than by
 * caller: at this point the key has not been checked, so there is no identity
 * to trust, and keying on the key itself would give a caller cycling random
 * keys a fresh budget every request — which is the traffic this exists to stop.
 *
 * Deliberately loose. A fleet coming online behind one corporate egress pays
 * one miss per key before its cache warms, and throttling that would break the
 * deployment this feature is for. It caps what a single source can amplify into
 * LlamaCloud's auth path; a caller spread across many addresses is not stopped
 * here, and wants an upstream budget rather than a per-instance one.
 */
const unvalidatedKeyLimiter = new RateLimiterMemory({
  points: 300,
  duration: 60,
});

async function limitUnvalidatedKey(request: Request): Promise<Response | null> {
  const key = request.headers.get('x-forwarded-for') || '127.0.0.1';
  try {
    await unvalidatedKeyLimiter.consume(key);
    return null;
  } catch (res) {
    const retryAfter = Math.ceil((res as RateLimiterRes).msBeforeNext / 1000);
    return new Response(
      'Too many unverified API keys from this address. Try again later.',
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }
}

// Fetch the JWKS from WorkOS (shared across handlers). Absent in api_key mode,
// where there is no WorkOS environment and no JWT will ever be accepted.
const JWKS = oauthEnabled
  ? createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`))
  : undefined;

/**
 * Requests whose API key this server has already checked, carrying the
 * fingerprint the verifier needs.
 *
 * Keyed by the request object rather than the token: two requests presenting
 * the same key are still two requests, and a token-keyed entry would let them
 * race. A `WeakMap` also needs no eviction — the entry dies with the request.
 */
const validatedApiKeys = new WeakMap<Request, string>();

/** The bearer, parsed the way `experimental_withMcpAuth` parses it. */
function bearerToken(request: Request): string | undefined {
  const [scheme, token] =
    request.headers.get('Authorization')?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}

/**
 * Deliberately without `WWW-Authenticate`.
 *
 * The adapter answers a rejected token with a Bearer challenge pointing at
 * OAuth discovery, which is right for a bad JWT and wrong here: a caller who
 * presented an API key would be sent into a sign-in flow they did not ask for
 * and cannot complete headlessly. The status still says re-authenticate; only
 * the instruction to do it via OAuth is dropped.
 */
function unauthorized(description: string): Response {
  return new Response(
    JSON.stringify({ error: 'invalid_token', error_description: description }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}

type McpServerInfo = {
  instructions: string;
  serverInfo: {
    name: string;
    version: string;
  };
};

/**
 * Build a Next.js route handler that exposes an MCP server over Streamable HTTP,
 * wrapped with WorkOS auth + rate limiting.
 *
 * @param register   Function that registers tools on the MCP server.
 * @param basePath   Base path under which the `/mcp` endpoint is mounted.
 *                   For example, basePath: '/parse' → endpoint '/parse/mcp'.
 * @param serverInfo Information about the server, including name, instructions and version.
 */
export function buildMcpRouteHandler(
  register: (server: McpServer) => void,
  basePath: string,
  serverInfo?: McpServerInfo
) {
  // Usage accounting is attached here rather than inside each `register`
  // function, so a tool added later is covered without anyone remembering to
  // opt it in.
  const surface = surfaceFromBasePath(basePath);

  const handler = createMcpHandler(
    (server) => {
      register(instrumentToolUsage(server, surface));
    },
    { ...serverInfo },
    { basePath }
  );

  const authenticated = experimental_withMcpAuth(
    handler,
    async (request, token) => {
      const logger = getLogger();
      if (!token) {
        logger.error('Undefined token');
        return undefined;
      }

      // Already checked against LlamaCloud by the branch this handler is
      // wrapped in, so there is nothing to verify here and no JWKS to fetch.
      // The headers and the limiter are still applied from inside the verifier,
      // where the OAuth path applies them too.
      const fingerprint = validatedApiKeys.get(request);
      if (fingerprint !== undefined) {
        request.headers.set('x-user-id', fingerprint);
        const limiterResponse = await applyRateLimit(request);
        return {
          token,
          // No OAuth client is involved in an API-key call, and in api_key
          // mode there is none configured. The adapter's type requires
          // the field, so it names the credential kind instead.
          clientId: clientId ?? 'api-key',
          scopes: [],
          extra: {
            user: { id: fingerprint },
            // An API key carries no claims. Tools read `user`, never this.
            claims: {},
            rateLimit: extractRateLimitFromResponse(limiterResponse),
            credential: 'api_key',
          } satisfies WorkOSAuthInfo,
        };
      }

      if (!JWKS) {
        // Unreachable in practice: api_key mode turns a JWT away before the
        // wrapper is called. Kept because it is what makes JWKS non-optional
        // for jwtVerify below, and a 500 from an absent key set would be a
        // worse answer than this if a future path ever did reach here.
        logger.error('A JWT was presented to an API-key-only deployment');
        throw new InvalidTokenError(
          'This deployment accepts LlamaCloud API keys only. Send one as the bearer token.'
        );
      }

      // Only a fault in the token itself becomes a 401. Everything else here is
      // a server problem — including a JWKS fetch failure, which surfaces from
      // `jwtVerify` alongside real signature errors — and answering those with
      // `invalid_token` would tell users holding good credentials to
      // re-authenticate against the same WorkOS that is down.
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, JWKS));
      } catch (error: unknown) {
        logger.error('Token verification failed:', error);
        const rejection = invalidTokenError(error, token);
        if (!rejection) {
          throw error;
        }
        throw rejection;
      }

      if (!payload.sub) {
        logger.error('Token carried no sub claim');
        throw new InvalidTokenError('Invalid token. Please sign in again.');
      }

      // `sub` is the WorkOS user id, so the directory lookup this replaced
      // returned an id we already had, at the cost of a round-trip per request.
      //
      // It did also reject hard-deleted users — but as a 500, which clients
      // retry, and it never saw session revocation, sign-out-everywhere or org
      // removal, since WorkOS has no deactivated user state for it to read.
      // What makes dropping it safe is downstream: the tools that reach
      // LlamaCloud forward this caller's own bearer, and the API introspects it
      // against WorkOS userinfo — cached up to 5 minutes per token, so a
      // revocation is caught within that window rather than instantly. Keep
      // that property: a tool that authenticated with a service credential
      // instead would leave nothing re-checking the caller at all.
      request.headers.set('x-user-id', payload.sub);
      const limiterResponse = await applyRateLimit(request);

      logger.debug('Token validated and ready to get passed through');
      return {
        token,
        clientId: clientId!,
        scopes: [],
        extra: {
          user: { id: payload.sub },
          claims: payload,
          rateLimit: extractRateLimitFromResponse(limiterResponse),
          credential: 'oauth',
        } satisfies WorkOSAuthInfo,
      };
    },
    {
      required: false,
    }
  );

  // API keys are checked here rather than inside the verifier because a
  // rejection has to be answered without the adapter's OAuth challenge, and the
  // adapter hardcodes that header on every 401 it produces. Dispatching the
  // unwrapped handler ourselves is not an option either: `withAuthContext`, the
  // function that makes `authInfo` reachable from a tool, is internal to the
  // adapter and not exported. So a good key is recorded and handed on, and the
  // wrapper does the dispatch exactly as it does for a JWT.
  return async (request: Request) => {
    const token = bearerToken(request);

    // In api_key mode the challenge would name a discovery document this
    // deployment answers with a 404, so a JWT is turned away here rather than
    // by the verifier — the adapter attaches that pointer to every 401 it
    // builds, and pointing a client at a document that does not exist is worse
    // than telling it plainly what this server takes.
    if (!oauthEnabled && token !== undefined && !isApiKeyToken(token)) {
      return unauthorized(
        'This deployment accepts LlamaCloud API keys only. Send one as the bearer token.'
      );
    }

    if (token === undefined || !isApiKeyToken(token)) {
      return authenticated(request);
    }

    // Only an unrecognised key reaches LlamaCloud, so only that case is worth
    // limiting; a caller whose key is already cached is not costing anything
    // and is metered per-key inside the verifier like everyone else.
    if (cachedApiKeyVerdict(token) === undefined) {
      const limited = await limitUnvalidatedKey(request);
      if (limited) {
        return limited;
      }
    }

    let valid: boolean;
    try {
      valid = await validateApiKey(token);
    } catch {
      // LlamaCloud is unreachable, not the key's fault. Already logged.
      return new Response(
        JSON.stringify({
          error: 'server_error',
          error_description: 'Could not verify the API key. Try again.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!valid) {
      return unauthorized('Invalid API key.');
    }

    validatedApiKeys.set(request, apiKeyFingerprint(token));
    return authenticated(request);
  };
}

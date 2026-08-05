import {
  createMcpHandler,
  experimental_withMcpAuth,
} from '@vercel/mcp-adapter';
import { getWorkOS } from '@workos-inc/authkit-nextjs';
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { User, WorkOSAuthInfo } from '@/lib/auth/types';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getLogger } from '@/lib/observability/logger';
import { extractRateLimitFromResponse } from '@/lib/auth/helpers';
import { invalidTokenError } from '@/lib/auth/token-errors';
import type { McpServer } from '@/lib/mcp/tools/tools';

const workos = getWorkOS();
const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
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

// Fetch the JWKS from WorkOS (shared across handlers)
const jwksUrl = new URL(`https://api.workos.com/sso/jwks/${clientId}`);
const JWKS = createRemoteJWKSet(jwksUrl);

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
  const handler = createMcpHandler(
    (server) => {
      register(server);
    },
    { ...serverInfo },
    { basePath }
  );

  return experimental_withMcpAuth(
    handler,
    async (request, token) => {
      const logger = getLogger();
      if (!token) {
        logger.error('Undefined token');
        return undefined;
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

      const userProfile = await workos.userManagement.getUser(payload.sub);

      const user: User = {
        id: userProfile.id,
        email: userProfile.email,
        firstName: userProfile.firstName,
        lastName: userProfile.lastName,
        profilePictureUrl: userProfile.profilePictureUrl,
      };

      request.headers.set('x-user-id', userProfile.id);
      const limiterResponse = await applyRateLimit(request);

      logger.debug('Token validated and ready to get passed through');
      return {
        token,
        clientId: clientId!,
        scopes: [],
        extra: {
          user,
          claims: payload,
          rateLimit: extractRateLimitFromResponse(limiterResponse),
        } satisfies WorkOSAuthInfo,
      };
    },
    {
      required: false,
    }
  );
}

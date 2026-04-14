/**
 * AuthHandler Pattern Demo: Vercel MCP Adapter + WorkOS AuthKit
 *
 * This file demonstrates the powerful authHandler wrapper pattern that
 * transforms any MCP server built with the Vercel MCP Adapter into an
 * enterprise-ready, authenticated service with just a few lines of code.
 *
 * Key components:
 * 1. createMcpHandler() - builds the MCP server with type-safe tools
 * 2. experimental_withMcpAuth() - wraps with WorkOS authentication
 * 3. Zero-config deployment to Vercel Edge
 */

import {
  createMcpHandler,
  experimental_withMcpAuth,
} from '@vercel/mcp-adapter';
import { getWorkOS } from '@workos-inc/authkit-nextjs';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { User, WorkOSAuthInfo } from '@/lib/auth/types';
import { registerLlamaParseTools } from '@/lib/mcp/tools/tools';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getLogger } from '@/lib/observability/logger';
import { extractRateLimitFromResponse } from '@/lib/auth/helpers';

const workos = getWorkOS();
const clientId = process.env.WORKOS_CLIENT_ID;

// In-memory rate limiter: 100 requests per 60-second sliding window per key
const rateLimiter = new RateLimiterMemory({
  points: 104, // 100 max requests + 4 authentication requests when connecting the client
  duration: 60, // per 60 seconds
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

if (!clientId) {
  throw new Error('WORKOS_CLIENT_ID environment variable not set');
}

// Fetch the JWKS from WorkOS
const jwksUrl = new URL(`https://api.workos.com/sso/jwks/${clientId}`);
const JWKS = createRemoteJWKSet(jwksUrl);

const handler = createMcpHandler((server) => {
  // Register tool modules
  registerLlamaParseTools(server);
});

// 🔐 THE AUTHHANDLER PATTERN 🔐
// This is the magic: wrap any MCP server with enterprise authentication
// in just a few lines using experimental_withMcpAuth + WorkOS
const authHandler = experimental_withMcpAuth(
  handler,
  async (request, token) => {
    // If no token is provided, allow through for public tools (like ping)
    // Individual tools decide if they require authentication
    const logger = getLogger();
    if (!token) {
      logger.error('Undefined token');
      return undefined; // No auth context - tools can check isAuthenticated()
    }

    try {
      // Verify the JWT using WorkOS JWKS
      const { payload } = await jwtVerify(token, JWKS);

      if (!payload.sub) {
        throw new Error('Invalid token: missing sub claim');
      }

      // Fetch user profile from WorkOS
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

      const workosAuthInfo: WorkOSAuthInfo = {
        user,
        claims: payload,
        rateLimit: extractRateLimitFromResponse(limiterResponse),
      };

      logger.debug('Token validated and ready to get passed through');
      // Return MCP AuthInfo with our data in extra
      return {
        token,
        clientId: clientId!,
        scopes: [],
        extra: workosAuthInfo,
      };
    } catch (error: unknown) {
      console.error('Authentication error:', error);
      const errorObj = error as { code?: string; message?: string };
      const errorMessage =
        errorObj.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'
          ? 'Invalid token signature. Please sign in again.'
          : errorObj.message || 'Authentication failed. Please sign in again.';

      throw new Error(errorMessage);
    }
  },
  {
    // Allow unauthenticated requests through - individual tools decide auth requirements
    // This enables a mix of public tools and private tools
    required: false,
  }
);

export { authHandler as GET, authHandler as POST };

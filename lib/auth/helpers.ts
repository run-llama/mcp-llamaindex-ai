import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { User, WorkOSAuthInfo } from './types';
import { getLogger } from '../observability/logger';

// Ensures user is authenticated and extracts user from authInfo.extra
// Throws an error if user is not authenticated - use for tools that require auth
export const ensureUserAuthenticated = (
  authInfo: AuthInfo | undefined
): User => {
  const logger = getLogger();
  if (!authInfo?.extra) {
    logger.error('Unauthenticated user sent a request');
    throw new Error('Authentication required for this tool');
  }

  const workosAuth = authInfo.extra as WorkOSAuthInfo;
  if (!workosAuth || !workosAuth.user) {
    logger.error('Unauthenticated user sent a request');
    throw new Error('Authentication required for this tool');
  }
  return workosAuth.user;
};

/**
 * Whether the caller authenticated with an API key rather than OAuth.
 *
 * A credential recorded before this field existed reads as OAuth, which is what
 * it was — only the API-key path ever sets it.
 */
export const isApiKeyCaller = (authInfo: AuthInfo | undefined): boolean =>
  (authInfo?.extra as WorkOSAuthInfo | undefined)?.credential === 'api_key';

// Helper to check if request is authenticated (for optional auth tools)
export const isAuthenticated = (authInfo: AuthInfo | undefined): boolean => {
  if (!authInfo?.extra) {
    return false;
  }

  const workosAuth = authInfo.extra as WorkOSAuthInfo;
  return !!(workosAuth && workosAuth.user);
};

export function extractRateLimitFromResponse(
  response: Response | undefined | null
) {
  if (!response) {
    return undefined;
  }
  const retryAfter = response.headers.get('Retry-After');

  return `Too many requests. Retry in ${retryAfter} seconds.`;
}

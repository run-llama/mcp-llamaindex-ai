import { ensureUserAuthenticated, isAuthenticated } from '../lib/auth/helpers';
import { User } from '../lib/auth/types';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

describe('Authentication Helpers', () => {
  const mockUser: User = {
    id: 'user_123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
  };

  const mockAuthInfo: AuthInfo = {
    token: 'mock-token',
    clientId: 'mock-client-id',
    scopes: ['read'],
    extra: {
      user: mockUser,
      claims: { sub: 'user_123' },
    },
  };

  const mockAuthInfoWithoutUser: AuthInfo = {
    token: 'mock-token',
    clientId: 'mock-client-id',
    scopes: ['read'],
    extra: {},
  };

  describe('isAuthenticated', () => {
    it('should return true for valid auth info', () => {
      expect(isAuthenticated(mockAuthInfo)).toBe(true);
    });

    it('should return false for null auth info', () => {
      expect(isAuthenticated(undefined)).toBe(false);
    });

    it('should return false for auth info without user', () => {
      expect(isAuthenticated(mockAuthInfoWithoutUser)).toBe(false);
    });
  });

  describe('ensureUserAuthenticated', () => {
    it('should return user for valid auth info', () => {
      expect(ensureUserAuthenticated(mockAuthInfo)).toEqual(mockUser);
    });

    it('should throw error for null auth info', () => {
      expect(() => ensureUserAuthenticated(undefined)).toThrow(
        'Authentication required for this tool'
      );
    });

    it('should throw error for auth info without user', () => {
      expect(() => ensureUserAuthenticated(mockAuthInfoWithoutUser)).toThrow(
        'Authentication required for this tool'
      );
    });
  });
});

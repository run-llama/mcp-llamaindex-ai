import { normalizeBaseUrl, publicBaseUrl } from '../lib/urls';
import { authkitOrigin } from '../lib/authkit';

describe('normalizeBaseUrl', () => {
  const V = 'SOME_VAR';

  it('adds https to a bare host', () => {
    expect(normalizeBaseUrl('mcp.llamaindex.ai', V)).toBe(
      'https://mcp.llamaindex.ai'
    );
  });

  it('keeps an existing https scheme', () => {
    expect(normalizeBaseUrl('https://mcp.llamaindex.ai', V)).toBe(
      'https://mcp.llamaindex.ai'
    );
  });

  it('keeps an existing http scheme for local development', () => {
    expect(normalizeBaseUrl('http://localhost:3000', V)).toBe(
      'http://localhost:3000'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  mcp.llamaindex.ai  ', V)).toBe(
      'https://mcp.llamaindex.ai'
    );
  });

  it('strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://mcp.llamaindex.ai//', V)).toBe(
      'https://mcp.llamaindex.ai'
    );
  });

  // The previous inline normalisation used `.startsWith('http')`, which treats a
  // bare host beginning with those four letters as already carrying a scheme.
  it('adds a scheme to a bare host that starts with "http"', () => {
    expect(normalizeBaseUrl('httpbin.example.com', V)).toBe(
      'https://httpbin.example.com'
    );
  });

  it('rejects an empty value', () => {
    expect(() => normalizeBaseUrl('   ', V)).toThrow(
      /SOME_VAR environment variable is empty/
    );
  });

  it('rejects a value that is not a URL', () => {
    expect(() => normalizeBaseUrl('http://', V)).toThrow(
      /SOME_VAR is not a valid URL/
    );
  });

  it('rejects a query component', () => {
    expect(() => normalizeBaseUrl('mcp.llamaindex.ai/?a=1', V)).toThrow(
      /must not carry a query or fragment/
    );
  });

  it('rejects a fragment component', () => {
    expect(() => normalizeBaseUrl('mcp.llamaindex.ai/#x', V)).toThrow(
      /must not carry a query or fragment/
    );
  });

  it('preserves a path', () => {
    expect(normalizeBaseUrl('example.com/base', V)).toBe(
      'https://example.com/base'
    );
  });
});

describe('environment readers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('publicBaseUrl', () => {
    it('normalises the bare host used in production', () => {
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL =
        'mcp.llamaindex.ai';
      expect(publicBaseUrl()).toBe('https://mcp.llamaindex.ai');
    });

    it('accepts the full URL used locally', () => {
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL =
        'http://localhost:3000';
      expect(publicBaseUrl()).toBe('http://localhost:3000');
    });

    it('throws when unset', () => {
      delete process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
      expect(() => publicBaseUrl()).toThrow(
        /NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL environment variable not set/
      );
    });
  });

  describe('authkitOrigin', () => {
    it('normalises the bare host used in production', () => {
      process.env.WORKOS_AUTHKIT_DOMAIN = 'login.llamaindex.ai';
      expect(authkitOrigin()).toBe('https://login.llamaindex.ai');
    });

    it('accepts the scheme-prefixed form the README documents', () => {
      process.env.WORKOS_AUTHKIT_DOMAIN = 'https://example.authkit.app';
      expect(authkitOrigin()).toBe('https://example.authkit.app');
    });

    it('resolves the eu authkit domain', () => {
      process.env.WORKOS_AUTHKIT_DOMAIN = 'login.eu.llamaindex.ai';
      expect(authkitOrigin()).toBe('https://login.eu.llamaindex.ai');
    });

    it('throws when unset', () => {
      delete process.env.WORKOS_AUTHKIT_DOMAIN;
      expect(() => authkitOrigin()).toThrow(
        /WORKOS_AUTHKIT_DOMAIN environment variable not set/
      );
    });
  });
});

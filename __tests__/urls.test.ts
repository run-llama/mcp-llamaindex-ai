import {
  isLoopbackHostname,
  normalizeBaseUrl,
  publicBaseUrl,
} from '../lib/urls';
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

  it('preserves a path by default', () => {
    expect(normalizeBaseUrl('example.com/base', V)).toBe(
      'https://example.com/base'
    );
  });

  // A bare host:port must not be read as a scheme named after its own host.
  it('accepts a bare host and port', () => {
    expect(normalizeBaseUrl('localhost:8000', V)).toBe(
      'https://localhost:8000'
    );
  });

  it('accepts a bare host and port that is not loopback', () => {
    expect(normalizeBaseUrl('example.com:8080', V)).toBe(
      'https://example.com:8080'
    );
  });

  // The URL parser repairs the missing slash; requiring `://` to detect a
  // scheme would instead prefix this into the host `https`.
  it('repairs a single-slash scheme', () => {
    expect(normalizeBaseUrl('https:/mcp.llamaindex.ai', V)).toBe(
      'https://mcp.llamaindex.ai'
    );
  });

  // A trailing dot is forbidden in the TLS SNI extension, and `url.origin`
  // keeps it, so it must be stripped from what consumers receive.
  it('strips a trailing dot from the host', () => {
    expect(normalizeBaseUrl('https://api.cloud.eu.llamaindex.ai./', V)).toBe(
      'https://api.cloud.eu.llamaindex.ai'
    );
  });

  describe('caller constraints', () => {
    it('originOnly rejects a path', () => {
      expect(() =>
        normalizeBaseUrl('example.com/base', V, { originOnly: true })
      ).toThrow(/must be an origin, with no path/);
    });

    it('originOnly accepts a trailing slash as no path', () => {
      expect(
        normalizeBaseUrl('https://example.com/', V, { originOnly: true })
      ).toBe('https://example.com');
    });

    it('requireHttps rejects cleartext', () => {
      expect(() =>
        normalizeBaseUrl('http://login.example.com', V, { requireHttps: true })
      ).toThrow(/must use https/);
    });

    it('requireHttps still allows cleartext to loopback', () => {
      expect(
        normalizeBaseUrl('http://localhost:3000', V, { requireHttps: true })
      ).toBe('http://localhost:3000');
    });

    it('requireHttps allows https', () => {
      expect(
        normalizeBaseUrl('login.example.com', V, { requireHttps: true })
      ).toBe('https://login.example.com');
    });
  });

  describe('canonicalisation', () => {
    // Built from the parsed URL, so consumers see the form the network uses.
    it('lowercases the host', () => {
      expect(normalizeBaseUrl('MCP.LlamaIndex.AI', V)).toBe(
        'https://mcp.llamaindex.ai'
      );
    });

    it('lowercases the scheme', () => {
      expect(normalizeBaseUrl('HTTPS://mcp.llamaindex.ai', V)).toBe(
        'https://mcp.llamaindex.ai'
      );
    });

    it('punycodes an IDN host', () => {
      expect(normalizeBaseUrl('münchen.example', V)).toBe(
        'https://xn--mnchen-3ya.example'
      );
    });

    it('drops a default port', () => {
      expect(normalizeBaseUrl('https://mcp.llamaindex.ai:443', V)).toBe(
        'https://mcp.llamaindex.ai'
      );
    });

    it('keeps a non-default port', () => {
      expect(normalizeBaseUrl('https://mcp.llamaindex.ai:8443', V)).toBe(
        'https://mcp.llamaindex.ai:8443'
      );
    });
  });

  describe('rejections', () => {
    it('rejects an empty value', () => {
      expect(() => normalizeBaseUrl('   ', V)).toThrow(
        /SOME_VAR environment variable is empty/
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

    // `URL.search` and `URL.hash` are both '' for these, so a truthiness check
    // on the parsed URL lets them through, and they then corrupt every path
    // concatenated onto the result.
    it('rejects a lone trailing question mark', () => {
      expect(() => normalizeBaseUrl('https://mcp.llamaindex.ai?', V)).toThrow(
        /must not carry a query or fragment/
      );
    });

    it('rejects a lone trailing hash', () => {
      expect(() => normalizeBaseUrl('https://mcp.llamaindex.ai#', V)).toThrow(
        /must not carry a query or fragment/
      );
    });

    // Prefixing these produces `https://ftp://host`, which parses cleanly with
    // the single-label host `ftp`.
    it('rejects a non-http scheme', () => {
      expect(() => normalizeBaseUrl('ftp://example.com', V)).toThrow(
        /must use http or https, not "ftp:"/
      );
    });

    it('rejects a file scheme', () => {
      expect(() => normalizeBaseUrl('file:///etc/passwd', V)).toThrow(
        /must use http or https/
      );
    });

    it('rejects a protocol-relative value', () => {
      expect(() => normalizeBaseUrl('//mcp.llamaindex.ai', V)).toThrow(
        /not protocol-relative/
      );
    });

    // The WHATWG parser treats a backslash like a slash in the authority, so
    // this spelling would otherwise resolve to a perfectly valid absolute URL.
    it('rejects the backslash spelling of a protocol-relative value', () => {
      expect(() =>
        normalizeBaseUrl(String.raw`\\login.example.com`, V)
      ).toThrow(/not protocol-relative/);
    });

    it('rejects a value containing a backslash', () => {
      expect(() =>
        normalizeBaseUrl(String.raw`mcp.llamaindex.ai\evil`, V)
      ).toThrow(/not protocol-relative/);
    });

    it('rejects a value with no host', () => {
      expect(() => normalizeBaseUrl('https://', V)).toThrow(/SOME_VAR/);
    });

    // These messages travel to remote MCP clients and into the log stream, and
    // an override can carry credentials in either form.
    it('never echoes a scheme-prefixed value carrying credentials', () => {
      const secret = 'https://svc:s3cr3t@proxy.corp.internal/?tenant=acme';
      expect(() => normalizeBaseUrl(secret, V)).toThrow(
        /must not carry a query or fragment/
      );
      expect(() => normalizeBaseUrl(secret, V)).not.toThrow(/s3cr3t/);
    });

    it('never echoes a scheme-less value carrying credentials', () => {
      const secret = 'svc:s3cr3t@proxy.corp.internal/?tenant=acme';
      expect(() => normalizeBaseUrl(secret, V)).not.toThrow(/s3cr3t/);
    });
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

    // Both consumers append an absolute app path, and no basePath is
    // configured, so a path here produces URLs that cannot resolve.
    it('rejects a path', () => {
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL =
        'mcp.llamaindex.ai/mcp';
      expect(() => publicBaseUrl()).toThrow(/must be an origin, with no path/);
    });

    // The URL built from this carries a one-time upload token and the document
    // body to a third party.
    it('rejects cleartext for a remote host', () => {
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL =
        'http://mcp.example.com';
      expect(() => publicBaseUrl()).toThrow(/must use https/);
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

    // This value is advertised as the OAuth issuer; http would carry the
    // authorization code and the access token in the clear.
    it('refuses a cleartext authkit domain', () => {
      process.env.WORKOS_AUTHKIT_DOMAIN = 'http://login.example.com';
      expect(() => authkitOrigin()).toThrow(/must use https/);
    });

    // RFC 8414 looks for a path-ful issuer's metadata elsewhere, and the proxy
    // would fetch the wrong URL.
    it('refuses an authkit domain carrying a path', () => {
      process.env.WORKOS_AUTHKIT_DOMAIN = 'login.llamaindex.ai/authkit';
      expect(() => authkitOrigin()).toThrow(/must be an origin, with no path/);
    });

    it('throws when unset', () => {
      delete process.env.WORKOS_AUTHKIT_DOMAIN;
      expect(() => authkitOrigin()).toThrow(
        /WORKOS_AUTHKIT_DOMAIN environment variable not set/
      );
    });
  });
});

describe('isLoopbackHostname', () => {
  // The rejection message and the README both promise "a loopback host", so
  // the set has to match what a developer's local server actually prints.
  it.each([
    'localhost',
    'api.localhost',
    '127.0.0.1',
    '127.0.0.2',
    '0.0.0.0',
    '[::1]',
  ])('treats %s as loopback', (h) => {
    expect(isLoopbackHostname(h)).toBe(true);
  });

  it.each(['mcp.llamaindex.ai', 'localhost.example.com', '10.0.0.1'])(
    'does not treat %s as loopback',
    (h) => {
      expect(isLoopbackHostname(h)).toBe(false);
    }
  );
});

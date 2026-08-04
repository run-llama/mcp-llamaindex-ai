import {
  assertRegionConfig,
  getRegion,
  llamaCloudBaseUrl,
  regionProfile,
  RegionConfigError,
} from '../lib/region';

const NA_API = 'https://api.cloud.llamaindex.ai';
const EU_API = 'https://api.cloud.eu.llamaindex.ai';

describe('region', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLAMA_CLOUD_REGION;
    delete process.env.LLAMA_CLOUD_BASE_URL;
    delete process.env.VERCEL_REGION;
    delete process.env.NEXT_RUNTIME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('resolution without an override', () => {
    it('defaults to na', () => {
      expect(getRegion()).toBe('na');
      expect(llamaCloudBaseUrl()).toBe(NA_API);
    });

    it('honours a declared eu region', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      expect(getRegion()).toBe('eu');
      expect(llamaCloudBaseUrl()).toBe(EU_API);
      expect(regionProfile().label).toBe('Europe (EU)');
    });

    it('is case- and whitespace-insensitive', () => {
      process.env.LLAMA_CLOUD_REGION = '  EU ';
      expect(getRegion()).toBe('eu');
    });

    it('rejects an unknown region', () => {
      process.env.LLAMA_CLOUD_REGION = 'apac';
      expect(() => getRegion()).toThrow(/Invalid LLAMA_CLOUD_REGION "apac"/);
    });

    // Present-but-blank means someone intended to set it; treating that as
    // unset would silently resolve an EU-intended deployment to NA.
    // Silently ignoring a set-but-empty override would point a local deployment
    // at the production API with the operator's live key.
    it('rejects a present-but-blank base url', () => {
      process.env.LLAMA_CLOUD_BASE_URL = '  ';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /LLAMA_CLOUD_BASE_URL is set but empty/
      );
    });

    it('rejects a present-but-blank region', () => {
      process.env.LLAMA_CLOUD_REGION = '  ';
      expect(() => getRegion()).toThrow(/is set but empty/);
    });
  });

  describe('region derived from the base url', () => {
    // The pre-existing single-variable configuration: LLAMA_CLOUD_BASE_URL was
    // the whole story, so it must keep working and must not be read as NA.
    it('infers eu from the eu api host with no region declared', () => {
      process.env.LLAMA_CLOUD_BASE_URL = EU_API;
      expect(getRegion()).toBe('eu');
      expect(llamaCloudBaseUrl()).toBe(EU_API);
    });

    it('infers na from the na api host with no region declared', () => {
      process.env.LLAMA_CLOUD_BASE_URL = NA_API;
      expect(getRegion()).toBe('na');
    });

    it('accepts a declared region that agrees with the host', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = EU_API;
      expect(getRegion()).toBe('eu');
    });

    it('rejects a declared region that disagrees with the host', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = NA_API;
      expect(() => getRegion()).toThrow(
        /LLAMA_CLOUD_REGION is "eu" .* but LLAMA_CLOUD_BASE_URL points at the North America \(NA\) API/
      );
    });

    it('rejects the mismatch in the other direction too', () => {
      process.env.LLAMA_CLOUD_REGION = 'na';
      process.env.LLAMA_CLOUD_BASE_URL = EU_API;
      expect(() => getRegion()).toThrow(
        /LLAMA_CLOUD_REGION is "na" .* points at the Europe \(EU\) API/
      );
    });
  });

  describe('override allowlist', () => {
    // The SDK concatenates paths onto the base URL, so a path here would
    // double-prefix every request.
    it('rejects a region api carrying a path', () => {
      process.env.LLAMA_CLOUD_BASE_URL = `${EU_API}/api`;
      expect(() => llamaCloudBaseUrl()).toThrow(
        /must be an origin, with no path/
      );
    });

    it('accepts a bare loopback host and port with a scheme', () => {
      process.env.LLAMA_CLOUD_REGION = 'na';
      process.env.LLAMA_CLOUD_BASE_URL = 'http://localhost:8000';
      expect(llamaCloudBaseUrl()).toBe('http://localhost:8000');
    });

    it('rejects an unrecognised host outright', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://api.staging.llamaindex.ai';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /host "api.staging.llamaindex.ai" is not a recognised LlamaCloud API/
      );
    });

    it('rejects an arbitrary third-party host', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://evil.example.com';
      expect(() => llamaCloudBaseUrl()).toThrow(/is not a recognised/);
    });

    it('allows a loopback host when the region is declared', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'http://localhost:8000';
      expect(getRegion()).toBe('eu');
      expect(llamaCloudBaseUrl()).toBe('http://localhost:8000');
    });

    it('allows ipv6 loopback', () => {
      process.env.LLAMA_CLOUD_REGION = 'na';
      process.env.LLAMA_CLOUD_BASE_URL = 'http://[::1]:8000';
      expect(llamaCloudBaseUrl()).toBe('http://[::1]:8000');
    });

    it('requires an explicit scheme for a loopback override', () => {
      // Bare `127.0.0.1:8000` normalises to https; a local API is rarely TLS,
      // so that boots green and then fails every request on a handshake.
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = '127.0.0.1:8000';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /must include an explicit http:\/\/ or https:\/\/ scheme/
      );
    });

    it('rejects a base url embedding credentials', () => {
      // fetch() refuses a URL with credentials and puts them in its message,
      // which is rethrown to the caller.
      process.env.LLAMA_CLOUD_BASE_URL = `https://svc:s3cr3t@api.cloud.eu.llamaindex.ai`;
      expect(() => llamaCloudBaseUrl()).toThrow(/must not embed credentials/);
      expect(() => llamaCloudBaseUrl()).not.toThrow(/s3cr3t/);
    });

    it('requires a declared region for a loopback override', () => {
      process.env.LLAMA_CLOUD_BASE_URL = 'http://localhost:8000';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /LLAMA_CLOUD_REGION must state the region this deployment serves/
      );
    });

    // A scheme-less value gains https, so this resolves to the NA API and is
    // caught as a region conflict rather than as an unrecognised host.
    it('gives a scheme-less foreign host the same treatment as an absolute one', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'api.cloud.llamaindex.ai';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /but LLAMA_CLOUD_BASE_URL points at the North America \(NA\) API/
      );
    });

    it('rejects a non-http scheme', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'file:///etc/passwd';
      expect(() => llamaCloudBaseUrl()).toThrow(/must use http or https/);
    });

    it('rejects a query string on the override', () => {
      process.env.LLAMA_CLOUD_BASE_URL = `${EU_API}/?tenant=acme`;
      expect(() => llamaCloudBaseUrl()).toThrow(
        /must not carry a query or fragment/
      );
    });
  });

  describe('dns-equivalent spellings of a foreign host', () => {
    it('rejects a trailing-dot fqdn of the other region', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://api.cloud.llamaindex.ai./';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /points at the North America \(NA\) API/
      );
    });

    it('rejects the other region on an explicit port', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://api.cloud.llamaindex.ai:8443';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /points at the North America \(NA\) API/
      );
    });

    it('rejects a mixed-case spelling of the other region', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://API.Cloud.LlamaIndex.ai';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /points at the North America \(NA\) API/
      );
    });
  });

  describe('transport security', () => {
    it('rejects cleartext http to a region api', () => {
      process.env.LLAMA_CLOUD_BASE_URL = 'http://api.cloud.eu.llamaindex.ai';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /must use https .* would send the API key and document contents in cleartext/
      );
    });

    it('still allows cleartext http to loopback', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'http://localhost:8000';
      expect(() => llamaCloudBaseUrl()).not.toThrow();
    });
  });

  // Callers branch on this type to avoid advising a retry that can never
  // succeed. Every configuration failure must carry it, including the ones
  // delegated to normalizeBaseUrl, which throws plain Errors that are wrapped.
  describe('error type', () => {
    it.each([
      ['unknown region', { LLAMA_CLOUD_REGION: 'apac' }],
      [
        'cross-region base url',
        { LLAMA_CLOUD_REGION: 'eu', LLAMA_CLOUD_BASE_URL: NA_API },
      ],
      [
        'unrecognised host',
        {
          LLAMA_CLOUD_REGION: 'eu',
          LLAMA_CLOUD_BASE_URL: 'https://api.staging.llamaindex.ai',
        },
      ],
      [
        'cleartext transport',
        { LLAMA_CLOUD_BASE_URL: 'http://api.cloud.eu.llamaindex.ai' },
      ],
      [
        'embedded credentials',
        { LLAMA_CLOUD_BASE_URL: 'https://u:p@api.cloud.eu.llamaindex.ai' },
      ],
      [
        'delegated: non-http scheme',
        { LLAMA_CLOUD_REGION: 'eu', LLAMA_CLOUD_BASE_URL: 'ftp://example.com' },
      ],
      [
        'delegated: query component',
        { LLAMA_CLOUD_REGION: 'eu', LLAMA_CLOUD_BASE_URL: `${EU_API}/?a=1` },
      ],
    ])('reports %s as a RegionConfigError', (_name, env) => {
      Object.assign(process.env, env);
      expect(() => llamaCloudBaseUrl()).toThrow(RegionConfigError);
    });
  });

  describe('error messages', () => {
    // These throws are rethrown to remote MCP clients (lib/mcp/tools/tools.ts),
    // so no rejection path may echo an override's credentials. Each case below
    // exits through a different throw site.
    it('rejects credentials outright rather than quoting them', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL =
        'https://svc:s3cr3t@internal-proxy.corp.internal:8443/';
      expect(() => llamaCloudBaseUrl()).toThrow(/must not embed credentials/);
      expect(() => llamaCloudBaseUrl()).not.toThrow(/s3cr3t/);
    });

    it('names the host, not the value, for an unrecognised override', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL =
        'https://internal-proxy.corp.internal:8443/';
      expect(() => llamaCloudBaseUrl()).toThrow(/internal-proxy.corp.internal/);
    });

    it('redacts credentials when the override carries a query', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL =
        'https://svc:s3cr3t@proxy.corp.internal/?tenant=acme';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /must not carry a query or fragment/
      );
      expect(() => llamaCloudBaseUrl()).not.toThrow(/s3cr3t/);
    });

    it('redacts credentials when the override does not parse', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://svc:s3cr3t@';
      expect(() => llamaCloudBaseUrl()).toThrow(/is not a valid URL/);
      expect(() => llamaCloudBaseUrl()).not.toThrow(/s3cr3t/);
    });
  });

  describe('assertRegionConfig', () => {
    it('accepts the default configuration', () => {
      expect(() => assertRegionConfig()).not.toThrow();
    });

    it('rejects a cross-region base url', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = NA_API;
      expect(() => assertRegionConfig()).toThrow(/North America \(NA\)/);
    });

    describe('compute region', () => {
      // Node runtime only: Vercel ships middleware to every PoP, where
      // VERCEL_REGION is the serving PoP rather than the function's region.
      beforeEach(() => {
        process.env.NEXT_RUNTIME = 'nodejs';
      });

      it('accepts an eu deployment running in an eu vercel region', () => {
        process.env.LLAMA_CLOUD_REGION = 'eu';
        process.env.VERCEL_REGION = 'fra1';
        expect(() => assertRegionConfig()).not.toThrow();
      });

      it('rejects an eu deployment running in a us vercel region', () => {
        process.env.LLAMA_CLOUD_REGION = 'eu';
        process.env.VERCEL_REGION = 'iad1';
        expect(() => assertRegionConfig()).toThrow(
          /functions run in Vercel region "iad1"/
        );
      });

      it('rejects lhr1, which is not in the eu', () => {
        process.env.LLAMA_CLOUD_REGION = 'eu';
        process.env.VERCEL_REGION = 'lhr1';
        expect(() => assertRegionConfig()).toThrow(/"lhr1"/);
      });

      // The region can come from the base URL alone, and the residency check
      // must still apply to it.
      it('applies to a region derived from the base url', () => {
        process.env.LLAMA_CLOUD_BASE_URL = EU_API;
        process.env.VERCEL_REGION = 'iad1';
        expect(() => assertRegionConfig()).toThrow(
          /serves Europe \(EU\) but its functions run in Vercel region "iad1"/
        );
      });

      // Asserting in the edge runtime would 500 an EU deployment in every
      // non-EU PoP, because middleware is deployed everywhere.
      it('does not run in the edge runtime', () => {
        process.env.NEXT_RUNTIME = 'edge';
        process.env.LLAMA_CLOUD_REGION = 'eu';
        process.env.VERCEL_REGION = 'iad1';
        expect(() => assertRegionConfig()).not.toThrow();
      });

      it('skips the check during a build', () => {
        process.env.LLAMA_CLOUD_REGION = 'eu';
        process.env.VERCEL_REGION = 'dev1';
        expect(() => assertRegionConfig()).not.toThrow();
      });

      it('skips the check off Vercel', () => {
        process.env.LLAMA_CLOUD_REGION = 'eu';
        expect(() => assertRegionConfig()).not.toThrow();
      });

      it('does not constrain na compute', () => {
        process.env.LLAMA_CLOUD_REGION = 'na';
        process.env.VERCEL_REGION = 'fra1';
        expect(() => assertRegionConfig()).not.toThrow();
      });
    });

    it('rejects an unknown region', () => {
      process.env.LLAMA_CLOUD_REGION = 'apac';
      expect(() => assertRegionConfig()).toThrow(/Invalid LLAMA_CLOUD_REGION/);
    });

    it('rejects a malformed base url', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'ftp://example.com';
      expect(() => assertRegionConfig()).toThrow(/must use http or https/);
    });
  });
});

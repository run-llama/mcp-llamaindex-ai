import {
  assertRegionConfig,
  getRegion,
  llamaCloudBaseUrl,
  regionProfile,
} from '../lib/region';

const NA_API = 'https://api.cloud.llamaindex.ai';
const EU_API = 'https://api.cloud.eu.llamaindex.ai';

describe('region', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLAMA_CLOUD_REGION;
    delete process.env.LLAMA_CLOUD_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getRegion', () => {
    it('defaults to na when unset', () => {
      expect(getRegion()).toBe('na');
    });

    it('defaults to na when empty', () => {
      process.env.LLAMA_CLOUD_REGION = '';
      expect(getRegion()).toBe('na');
    });

    it('reads eu', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      expect(getRegion()).toBe('eu');
    });

    it('is case- and whitespace-insensitive', () => {
      process.env.LLAMA_CLOUD_REGION = '  EU ';
      expect(getRegion()).toBe('eu');
    });

    it('throws on an unknown region', () => {
      process.env.LLAMA_CLOUD_REGION = 'apac';
      expect(() => getRegion()).toThrow(/Invalid LLAMA_CLOUD_REGION "apac"/);
    });
  });

  describe('regionProfile', () => {
    it('describes na', () => {
      expect(regionProfile()).toEqual({
        label: 'North America (NA)',
        apiBaseUrl: NA_API,
      });
    });

    it('describes eu', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      expect(regionProfile()).toEqual({
        label: 'Europe (EU)',
        apiBaseUrl: EU_API,
      });
    });
  });

  describe('llamaCloudBaseUrl', () => {
    it('derives the na api base by default', () => {
      expect(llamaCloudBaseUrl()).toBe(NA_API);
    });

    it('derives the eu api base in the eu region', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      expect(llamaCloudBaseUrl()).toBe(EU_API);
    });

    it('honours an override', () => {
      process.env.LLAMA_CLOUD_BASE_URL = 'http://localhost:8000';
      expect(llamaCloudBaseUrl()).toBe('http://localhost:8000');
    });

    it('ignores a blank override', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = '   ';
      expect(llamaCloudBaseUrl()).toBe(EU_API);
    });

    it('strips trailing slashes from an override', () => {
      process.env.LLAMA_CLOUD_BASE_URL = 'http://localhost:8000//';
      expect(llamaCloudBaseUrl()).toBe('http://localhost:8000');
    });

    it('allows an override matching the configured region', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = EU_API;
      expect(llamaCloudBaseUrl()).toBe(EU_API);
    });

    it('rejects an eu deployment pointed at the na api', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = NA_API;
      expect(() => llamaCloudBaseUrl()).toThrow(
        /points at the North America \(NA\) API .* but LLAMA_CLOUD_REGION is "eu"/
      );
    });

    it('rejects an na deployment pointed at the eu api', () => {
      process.env.LLAMA_CLOUD_REGION = 'na';
      process.env.LLAMA_CLOUD_BASE_URL = EU_API;
      expect(() => llamaCloudBaseUrl()).toThrow(
        /points at the Europe \(EU\) API .* but LLAMA_CLOUD_REGION is "na"/
      );
    });

    it('rejects a cross-region override regardless of trailing path or case', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = 'https://API.Cloud.LlamaIndex.ai/';
      expect(() => llamaCloudBaseUrl()).toThrow(/North America \(NA\)/);
    });

    it('throws on a malformed override', () => {
      process.env.LLAMA_CLOUD_BASE_URL = 'not-a-url';
      expect(() => llamaCloudBaseUrl()).toThrow(
        /LLAMA_CLOUD_BASE_URL is not a valid URL/
      );
    });
  });

  describe('assertRegionConfig', () => {
    it('accepts the default configuration', () => {
      expect(() => assertRegionConfig()).not.toThrow();
    });

    it('accepts a consistent eu configuration', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = EU_API;
      expect(() => assertRegionConfig()).not.toThrow();
    });

    it('rejects an unknown region', () => {
      process.env.LLAMA_CLOUD_REGION = 'apac';
      expect(() => assertRegionConfig()).toThrow(/Invalid LLAMA_CLOUD_REGION/);
    });

    it('rejects a cross-region base url override', () => {
      process.env.LLAMA_CLOUD_REGION = 'eu';
      process.env.LLAMA_CLOUD_BASE_URL = NA_API;
      expect(() => assertRegionConfig()).toThrow(/North America \(NA\)/);
    });

    it('rejects a malformed base url override', () => {
      process.env.LLAMA_CLOUD_BASE_URL = 'not-a-url';
      expect(() => assertRegionConfig()).toThrow(
        /LLAMA_CLOUD_BASE_URL is not a valid URL/
      );
    });
  });
});

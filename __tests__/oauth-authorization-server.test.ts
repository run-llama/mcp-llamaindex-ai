/**
 * @jest-environment node
 *
 * Every behaviour this route guarantees is invisible to the other suites: it is
 * the only place that decides whether an upstream failure reaches clients as
 * metadata, and whether a permanent misconfiguration is retryable.
 */
import { GET } from '../app/.well-known/oauth-authorization-server/route';

const VALID = { issuer: 'https://login.llamaindex.ai' };

describe('/.well-known/oauth-authorization-server', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.WORKOS_AUTHKIT_DOMAIN = 'login.llamaindex.ai';
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  function mockFetch(impl: () => Promise<Response> | never) {
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
  }

  it('serves upstream metadata and asks clients to cache it', async () => {
    mockFetch(async () => new Response(JSON.stringify(VALID), { status: 200 }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
    expect(res.headers.get('cache-control')).toMatch(/max-age=300/);
  });

  it('fetches from the configured region', async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = 'login.eu.llamaindex.ai';
    const seen: string[] = [];
    mockFetch(async (...args: unknown[]) => {
      seen.push(String(args[0]));
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    await GET();
    expect(seen[0]).toBe(
      'https://login.eu.llamaindex.ai/.well-known/oauth-authorization-server'
    );
  });

  // Re-serving an upstream error at 200 would have clients accept it as valid
  // metadata, and would defeat their retry-on-5xx.
  it('does not re-serve an upstream error as metadata', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ error: 'service_unavailable' }), {
          status: 503,
        })
    );
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'temporarily_unavailable' });
  });

  // A 200 carrying HTML must not escape as an HTML 500 from a discovery endpoint.
  it('handles a 200 that is not JSON', async () => {
    mockFetch(async () => new Response('<html>nope</html>', { status: 200 }));
    const res = await GET();
    expect(res.status).toBe(502);
  });

  it('handles an upstream timeout', async () => {
    mockFetch(async () => {
      throw new Error('aborted due to timeout');
    });
    const res = await GET();
    expect(res.status).toBe(502);
  });

  // A permanent misconfiguration must not look transient: 502 would have
  // clients retry it forever.
  it('does not report a bad AuthKit domain as retryable', async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = 'ftp://login.example.com';
    mockFetch(async () => new Response(JSON.stringify(VALID), { status: 200 }));
    await expect(GET()).rejects.toThrow(/must use http or https/);
  });

  it('refuses a cleartext AuthKit domain', async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = 'http://login.example.com';
    mockFetch(async () => new Response(JSON.stringify(VALID), { status: 200 }));
    await expect(GET()).rejects.toThrow(/must use https/);
  });
});

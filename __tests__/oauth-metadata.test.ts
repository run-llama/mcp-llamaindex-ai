/**
 * @jest-environment node
 *
 * The suite default is jsdom, which has no global `Request`; next/server needs
 * it at import time.
 *
 * The defect this covers is an RFC 9728 violation in the response body itself:
 * `resource` was a bare host. Testing the helper alone cannot catch a
 * regression that reintroduces a raw env read in the route.
 */
import { GET } from '../app/.well-known/oauth-protected-resource/route';

describe('/.well-known/oauth-protected-resource', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.WORKOS_AUTHKIT_DOMAIN = 'login.llamaindex.ai';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function body(url: string) {
    const res = await GET(new Request(url));
    return res.json();
  }

  it('advertises the resource as an absolute URL', async () => {
    const json = await body('https://mcp.llamaindex.ai/.well-known/x');
    expect(json.resource).toBe('https://mcp.llamaindex.ai');
  });

  // Derived from the request, not from the production-URL variable, so the
  // document describes the server the client actually reached.
  it('reflects the origin the client connected to', async () => {
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL = 'mcp.llamaindex.ai';
    const json = await body(
      'https://mcp-abc123-preview.vercel.app/.well-known/x'
    );
    expect(json.resource).toBe('https://mcp-abc123-preview.vercel.app');
  });

  it('advertises the region-correct authorization server', async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = 'login.eu.llamaindex.ai';
    const json = await body('https://mcp.eu.llamaindex.ai/.well-known/x');
    expect(json.authorization_servers).toEqual([
      'https://login.eu.llamaindex.ai',
    ]);
  });

  it('does not leak a query or fragment into the resource', async () => {
    const json = await body('https://mcp.llamaindex.ai/.well-known/x?a=1#b');
    expect(json.resource).toBe('https://mcp.llamaindex.ai');
  });
});

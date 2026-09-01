/**
 * @jest-environment node
 */

// Module scope, not script scope: sibling test files declare some of the same
// top-level names and would otherwise collide in the global scope.
export {};

const mockLookup = jest.fn();
jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

const {
  fetchRemoteFile,
  isBlockedAddress,
  BlockedUrlError,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('../lib/business/remote-fetch');

const realFetch = global.fetch;
const mockFetch = jest.fn();

function resolvesTo(...addresses: string[]) {
  mockLookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }))
  );
}

function ok() {
  return new Response('file bytes', { status: 200 });
}

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

beforeEach(() => {
  mockLookup.mockReset();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  delete process.env.ALLOW_PRIVATE_UPLOAD_HOSTS;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('isBlockedAddress', () => {
  it.each([
    ['169.254.169.254', 'cloud metadata'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC1918'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.255', 'RFC1918 upper bound'],
    ['192.168.1.1', 'RFC1918'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique-local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['172.32.0.1'], // just outside RFC1918
    ['100.128.0.1'], // just outside CGNAT
    ['2606:4700::1111'],
  ])('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('fetchRemoteFile', () => {
  it('fetches a URL that resolves publicly', async () => {
    resolvesTo('93.184.216.34');
    mockFetch.mockResolvedValue(ok());

    const response = await fetchRemoteFile('https://example.com/doc.pdf');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a hostname that resolves to an internal address', async () => {
    resolvesTo('169.254.169.254');

    await expect(fetchRemoteFile('https://evil.test/doc.pdf')).rejects.toThrow(
      BlockedUrlError
    );
    // Nothing may be sent: the refusal has to happen before the connection.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a name that answers with one public and one private address', async () => {
    resolvesTo('93.184.216.34', '10.0.0.5');

    // Checking only the first would pass here and then connect to either.
    await expect(fetchRemoteFile('https://split.test/doc.pdf')).rejects.toThrow(
      BlockedUrlError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a literal internal address without resolving it', async () => {
    await expect(
      fetchRemoteFile('http://169.254.169.254/latest/meta-data/')
    ).rejects.toThrow(BlockedUrlError);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a scheme that is not http or https', async () => {
    await expect(fetchRemoteFile('file:///etc/passwd')).rejects.toThrow(
      /Only http and https/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('re-checks the destination on a redirect', async () => {
    resolvesTo('93.184.216.34');
    mockFetch.mockResolvedValueOnce(
      redirectTo('http://169.254.169.254/latest/meta-data/')
    );

    // The same attack with one extra step; automatic following would take it.
    await expect(
      fetchRemoteFile('https://public.test/doc.pdf')
    ).rejects.toThrow(BlockedUrlError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect that stays public', async () => {
    resolvesTo('93.184.216.34');
    mockFetch
      .mockResolvedValueOnce(redirectTo('https://cdn.example.com/doc.pdf'))
      .mockResolvedValueOnce(ok());

    const response = await fetchRemoteFile('https://example.com/doc.pdf');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up on a redirect loop', async () => {
    resolvesTo('93.184.216.34');
    mockFetch.mockResolvedValue(redirectTo('https://example.com/again'));

    await expect(
      fetchRemoteFile('https://example.com/doc.pdf')
    ).rejects.toThrow(/Gave up after/);
  });

  it('lets an operator opt in to internal hosts', async () => {
    // A deployment inside a corporate network may hold its documents there.
    process.env.ALLOW_PRIVATE_UPLOAD_HOSTS = 'true';
    mockFetch.mockResolvedValue(ok());

    const response = await fetchRemoteFile('http://files.internal/doc.pdf');

    expect(response.status).toBe(200);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('does not treat any other value as opting in', async () => {
    process.env.ALLOW_PRIVATE_UPLOAD_HOSTS = 'yes';
    resolvesTo('10.0.0.5');

    await expect(
      fetchRemoteFile('http://files.internal/doc.pdf')
    ).rejects.toThrow(BlockedUrlError);
  });

  it('refuses a name that does not resolve, without saying why', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    // Distinguishing "no such name" from "internal name" would confirm which
    // internal names exist.
    await expect(
      fetchRemoteFile('https://nope.internal/doc.pdf')
    ).rejects.toThrow(/Could not resolve/);
  });
});

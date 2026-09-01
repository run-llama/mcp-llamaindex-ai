import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getLogger } from '../observability/logger';

/**
 * Fetching a URL the caller chose, from inside our network.
 *
 * `uploadFileByUrl` hands a caller-supplied URL to the server and returns what
 * comes back, which makes the server a proxy into whatever it can reach. That
 * matters more since API keys became a supported credential: the tool is the
 * only upload route open to them, and a self-hosted deployment sits inside the
 * customer's own network, next to metadata endpoints and internal services.
 *
 * The realistic attacker here is not the account holder — they are
 * authenticated already — but a document that talks the agent into fetching
 * something. That attacker picks the URL and does not usually control DNS.
 *
 * KNOWN GAP: an attacker who *does* control DNS can answer the check below with
 * a public address and the connection itself with a private one. Closing that
 * means pinning the resolved address onto the socket with a custom lookup,
 * which global fetch does not expose. Until then this stops URLs that name
 * internal hosts, literal internal addresses, and redirects into them, and does
 * not stop rebinding.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/**
 * A deployment inside a corporate network may legitimately hold its documents
 * on an internal host, so the block is opt-out rather than absolute. Off unless
 * an operator sets it, and never inferred from the auth mode: self-hosting does
 * not by itself mean the operator wants the server reaching its own subnet.
 */
function privateHostsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_UPLOAD_HOSTS?.trim() === 'true';
}

/** Redirects are followed by hand so each hop is checked. Three is plenty. */
const MAX_REDIRECTS = 3;

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

/** CIDR blocks that never belong to a document on the public internet. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, and cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

function isBlockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === undefined) return true;
  return BLOCKED_V4.some(([base, bits]) => {
    const baseValue = ipv4ToInt(base);
    if (baseValue === undefined) return false;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
  });
}

function isBlockedV6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0]!;
  // An IPv4 address wearing an IPv6 coat reaches the same host.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]!);
  if (value === '::1' || value === '::') return true;
  const head = value.split(':')[0] ?? '';
  const leading = parseInt(head.padEnd(4, '0'), 16);
  if (Number.isNaN(leading)) return true;
  if ((leading & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((leading & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedV4(address);
  if (family === 6) return isBlockedV6(address);
  return true;
}

/**
 * Reject the URL unless every address it resolves to is routable on the public
 * internet. Every address, not the first: a name that answers with one public
 * and one private address would otherwise pass and then connect to either.
 */
async function assertReachable(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(
      `Only http and https URLs can be fetched, not "${url.protocol}".`
    );
  }
  if (privateHostsAllowed()) {
    return;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((a) => a.address);
    } catch {
      // A name that does not resolve cannot be fetched either way, and saying
      // which is which would confirm internal names exist.
      throw new BlockedUrlError(`Could not resolve "${url.hostname}".`);
    }
  }

  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new BlockedUrlError(
      `"${url.hostname}" resolves to an address this server will not fetch from. ` +
        'Provide a publicly reachable URL.'
    );
  }
}

/**
 * GET a caller-supplied URL, checking the destination at every hop.
 *
 * Redirects are followed manually because the check has to run again on each
 * one — a public URL answering 302 to `http://169.254.169.254/` is the same
 * attack with one extra step, and automatic following would take it.
 */
export async function fetchRemoteFile(rawUrl: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`"${rawUrl}" is not a valid URL.`);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertReachable(url);
    const response = await fetch(url, { method: 'GET', redirect: 'manual' });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }
    const next = new URL(location, url);
    getLogger().debug(`Following redirect to ${next.hostname}`);
    url = next;
  }

  throw new BlockedUrlError(
    `Gave up after ${MAX_REDIRECTS} redirects fetching "${rawUrl}".`
  );
}

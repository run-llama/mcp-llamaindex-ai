import 'server-only';
import {
  isClusterInternalHostname,
  isLoopbackHostname,
  normalizeBaseUrl,
} from './urls';
import { authMode } from './auth/mode';

export type Region = 'na' | 'eu';

/**
 * A deployment misconfiguration, as distinct from a runtime failure. Callers
 * use this to avoid telling a user to retry something that can never succeed,
 * and to avoid echoing a message that names internal hosts.
 */
export class RegionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegionConfigError';
  }
}

export type RegionProfile = {
  readonly label: string;
  readonly apiBaseUrl: string;
  /** Only read for the region a deployment is *not* serving. */
  readonly consoleUrl: string;
  readonly mcpUrl: string;
  /**
   * Recognises the `iss` of a token this deployment cannot verify. Distinct
   * from `authkitOrigin()` in lib/authkit.ts, which resolves *this*
   * deployment's issuer from `WORKOS_AUTHKIT_DOMAIN` — a sibling's origin
   * cannot be learned from this deployment's environment, so it is stated here.
   */
  readonly authkitIssuerOrigin: string;
  /**
   * Vercel regions whose compute satisfies this region's residency commitment.
   * Documents are terminated and parsed inside the function, so the API host
   * alone does not keep them in region.
   *
   * Only `eu` is constrained: it is the region with a published commitment
   * ("all data provided will remain within the EU region for storage and
   * processing"). Deliberately excludes lhr1 — the UK holds an adequacy
   * decision but is not in the EU. `na` is left unconstrained because there is
   * no equivalent commitment and the existing deployment does not pin a
   * function region.
   */
  readonly computeRegions?: readonly string[];
};

const PROFILES: Record<Region, RegionProfile> = Object.freeze({
  na: Object.freeze({
    label: 'North America (NA)',
    apiBaseUrl: 'https://api.cloud.llamaindex.ai',
    consoleUrl: 'https://cloud.llamaindex.ai',
    mcpUrl: 'https://mcp.llamaindex.ai',
    authkitIssuerOrigin: 'https://login.llamaindex.ai',
  }),
  eu: Object.freeze({
    label: 'Europe (EU)',
    apiBaseUrl: 'https://api.cloud.eu.llamaindex.ai',
    consoleUrl: 'https://cloud.eu.llamaindex.ai',
    mcpUrl: 'https://mcp.eu.llamaindex.ai',
    authkitIssuerOrigin: 'https://login.eu.llamaindex.ai',
    computeRegions: Object.freeze(['fra1', 'cdg1', 'arn1', 'dub1']),
  }),
});

const REGIONS = Object.keys(PROFILES) as Region[];

/** Vercel reports this during a build; it is not the region traffic is served from. */
const BUILD_TIME_VERCEL_REGION = 'dev1';

function hostnameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

const API_HOSTNAMES = REGIONS.map((region) => ({
  region,
  hostname: hostnameOf(new URL(PROFILES[region].apiBaseUrl)),
}));

function declaredRegion(): Region | undefined {
  const declared = process.env.LLAMA_CLOUD_REGION;
  if (declared === undefined) {
    return undefined;
  }
  // A present-but-blank value means someone intended to set this; treating it
  // as unset would silently resolve to NA.
  const raw = declared.trim().toLowerCase();
  if (!raw) {
    throw new RegionConfigError(
      `LLAMA_CLOUD_REGION is set but empty — remove it, or set one of: ${REGIONS.join(', ')}`
    );
  }
  if (!REGIONS.includes(raw as Region)) {
    // Quote the normalised value, not the raw one: this message reaches remote
    // MCP clients, and it should name exactly what was tested.
    throw new RegionConfigError(
      `Invalid LLAMA_CLOUD_REGION "${raw}" — expected one of: ${REGIONS.join(', ')}`
    );
  }
  return raw as Region;
}

/**
 * Resolve the region and API base URL together, so the two can never disagree.
 *
 * `LLAMA_CLOUD_BASE_URL` is an override for local development. When it names a
 * known region's API it *determines* the region, which keeps the pre-existing
 * single-variable configuration working and unambiguous. Any other host must be
 * loopback and must state its region explicitly — an unrecognised host is
 * refused rather than assumed to be in region, because documents transit this
 * server and a wrong guess moves them out of the region they were promised to
 * stay in.
 *
 * Error messages name only the hostname: the raw value can carry credentials
 * and these throws reach remote MCP clients.
 */
function resolveRegionConfig(): { region: Region; baseUrl: string } {
  const declared = declaredRegion();
  const override = process.env.LLAMA_CLOUD_BASE_URL;
  // Same reasoning as the blank region above: silently ignoring a set-but-empty
  // override would point a local deployment at the production API.
  if (override !== undefined && !override.trim()) {
    throw new RegionConfigError(
      'LLAMA_CLOUD_BASE_URL is set but empty — remove it, or give it a value'
    );
  }
  const rawOverride = override?.trim();

  if (!rawOverride) {
    const region = declared ?? 'na';
    return { region, baseUrl: PROFILES[region].apiBaseUrl };
  }

  let baseUrl: string;
  try {
    // originOnly: the SDK builds request URLs by concatenating onto this, so a
    // path would double-prefix every call.
    baseUrl = normalizeBaseUrl(rawOverride, 'LLAMA_CLOUD_BASE_URL', {
      originOnly: true,
    });
  } catch (e) {
    throw new RegionConfigError((e as Error).message);
  }
  const url = new URL(baseUrl);
  const hostname = hostnameOf(url);

  const match = API_HOSTNAMES.find((entry) => entry.hostname === hostname);
  if (match) {
    if (declared && declared !== match.region) {
      throw new RegionConfigError(
        `LLAMA_CLOUD_REGION is "${declared}" (${PROFILES[declared].label}) but LLAMA_CLOUD_BASE_URL points at the ${PROFILES[match.region].label} API ("${hostname}").`
      );
    }
    if (url.protocol !== 'https:') {
      throw new RegionConfigError(
        `LLAMA_CLOUD_BASE_URL must use https for "${hostname}" — "${url.protocol}" would send the API key and document contents in cleartext.`
      );
    }
    return { region: match.region, baseUrl };
  }

  if (isLoopbackHostname(hostname)) {
    if (!declared) {
      throw new RegionConfigError(
        `LLAMA_CLOUD_BASE_URL points at "${hostname}", which is not a known region API, so LLAMA_CLOUD_REGION must state the region this deployment serves.`
      );
    }
    // A bare `127.0.0.1:8000` is normalised to https, and a local API is almost
    // never TLS — that combination boots green and then fails every request on
    // a handshake error. Make the operator state the scheme.
    if (!/^https?:\/\//i.test(rawOverride)) {
      throw new RegionConfigError(
        `LLAMA_CLOUD_BASE_URL must include an explicit http:// or https:// scheme for the local host "${hostname}".`
      );
    }
    return { region: declared, baseUrl };
  }

  // A self-hosted deployment points at the customer's own LlamaCloud, which is
  // by definition not one of ours. The region is still required, but not for
  // routing — the base URL is explicit, and the wrong-region wording in
  // token-errors.ts is unreachable here because a JWT never gets as far as
  // being verified. It is required so the deployment states which region it
  // serves rather than silently inheriting NA, which is the value every
  // profile lookup would otherwise return.
  if (authMode() === 'api_key') {
    if (!declared) {
      throw new RegionConfigError(
        `LLAMA_CLOUD_BASE_URL points at "${hostname}", which is not a known region API, so LLAMA_CLOUD_REGION must state the region this deployment serves.`
      );
    }
    // Still required against a public host — that is the case that would put
    // the API key and document contents on the open internet. A cluster-internal
    // host is exempt: the chart wires every component to its siblings over
    // http://<service>:80 and already proxies authenticated traffic that way, so
    // demanding TLS only here would block the standard wiring without keeping
    // anything off a network the operator does not already control.
    const internal = isClusterInternalHostname(hostname);
    if (url.protocol !== 'https:' && !internal) {
      throw new RegionConfigError(
        `LLAMA_CLOUD_BASE_URL must use https for "${hostname}" — "${url.protocol}" would send the API key and document contents in cleartext. Cleartext is accepted only for a cluster-internal host (an unqualified Service name, a .svc address, or a private-range literal).`
      );
    }
    // Same trap as loopback: a bare `llamacloud:80` normalises to https and then
    // fails every request on a handshake error, having booted green.
    if (internal && !/^https?:\/\//i.test(rawOverride)) {
      throw new RegionConfigError(
        `LLAMA_CLOUD_BASE_URL must include an explicit http:// or https:// scheme for the cluster-internal host "${hostname}".`
      );
    }
    return { region: declared, baseUrl };
  }

  throw new RegionConfigError(
    `LLAMA_CLOUD_BASE_URL host "${hostname}" is not a recognised LlamaCloud API. Allowed: ${API_HOSTNAMES.map((e) => e.hostname).join(', ')}, or a loopback host for local development. Set MCP_AUTH_MODE=api_key with LLAMA_CLOUD_REGION to point at a self-hosted LlamaCloud.`
  );
}

export function getRegion(): Region {
  return resolveRegionConfig().region;
}

export function regionProfile(): RegionProfile {
  return PROFILES[getRegion()];
}

/** The region this deployment does *not* serve. */
export function siblingProfile(): RegionProfile {
  return PROFILES[getRegion() === 'eu' ? 'na' : 'eu'];
}

export function llamaCloudBaseUrl(): string {
  return resolveRegionConfig().baseUrl;
}

/**
 * Fail a misconfigured deployment at boot rather than on every tool call.
 * Called from `instrumentation.ts`, which Next runs once per runtime at startup.
 */
export function assertRegionConfig(): void {
  const { region } = resolveRegionConfig();
  // The compute pin exists to hold *our* EU residency commitment: documents are
  // terminated and parsed inside the function, so an EU deployment of ours must
  // run on EU compute. A self-hosted deployment talks to the customer's own
  // LlamaCloud under whatever commitments they have made, and refusing to boot
  // because their Vercel project sits in the wrong place would enforce a
  // promise we did not make on their behalf.
  if (authMode() === 'api_key') {
    return;
  }
  assertComputeRegion(region);
}

/**
 * The API host says where requests go; it says nothing about where this server
 * runs. Documents are proxied, downloaded and (for LiteParse) parsed inside the
 * function, so a region with a residency commitment must also pin its compute.
 *
 * Node runtime only. Vercel deploys middleware to every PoP regardless of the
 * project's region setting, so in the edge runtime `VERCEL_REGION` is whichever
 * PoP served the request — asserting there would take an EU deployment offline
 * everywhere outside the four EU cities. The functions that touch documents all
 * run on Node.
 *
 * Skipped when `VERCEL_REGION` is absent (local development, CI, self-hosted)
 * or reports the build-time placeholder, since neither is the region that
 * serves traffic.
 */
function assertComputeRegion(region: Region): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const allowed = PROFILES[region].computeRegions;
  if (!allowed) {
    return;
  }
  const vercelRegion = process.env.VERCEL_REGION?.trim().toLowerCase();
  if (!vercelRegion || vercelRegion === BUILD_TIME_VERCEL_REGION) {
    return;
  }
  if (!allowed.includes(vercelRegion)) {
    throw new RegionConfigError(
      `This deployment serves ${PROFILES[region].label} but its functions run in Vercel region "${vercelRegion}". Documents are processed inside the function, so the compute region must be one of: ${allowed.join(', ')}.`
    );
  }
}

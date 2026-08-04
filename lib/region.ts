export type Region = 'na' | 'eu';

type RegionProfile = {
  label: string;
  apiBaseUrl: string;
};

const PROFILES: Record<Region, RegionProfile> = {
  na: {
    label: 'North America (NA)',
    apiBaseUrl: 'https://api.cloud.llamaindex.ai',
  },
  eu: {
    label: 'Europe (EU)',
    apiBaseUrl: 'https://api.cloud.eu.llamaindex.ai',
  },
};

const REGIONS = Object.keys(PROFILES) as Region[];

function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

const API_HOSTS = REGIONS.map((region) => ({
  region,
  host: hostOf(PROFILES[region].apiBaseUrl),
}));

/**
 * The region this deployment serves. Defaults to `na` so an unset variable keeps
 * the historical single-region behaviour.
 */
export function getRegion(): Region {
  const raw = process.env.LLAMA_CLOUD_REGION?.trim().toLowerCase();
  if (!raw) {
    return 'na';
  }
  if (!REGIONS.includes(raw as Region)) {
    throw new Error(
      `Invalid LLAMA_CLOUD_REGION "${process.env.LLAMA_CLOUD_REGION}" — expected one of: ${REGIONS.join(', ')}`
    );
  }
  return raw as Region;
}

export function regionProfile(): RegionProfile {
  return PROFILES[getRegion()];
}

/**
 * LlamaCloud API base for this deployment. `LLAMA_CLOUD_BASE_URL` remains an
 * override for local development and staging, but may never point at another
 * region's API: documents transit this server, so a cross-region base URL would
 * move them out of the region they were promised to stay in.
 */
export function llamaCloudBaseUrl(): string {
  const override = process.env.LLAMA_CLOUD_BASE_URL?.trim();
  if (!override) {
    return regionProfile().apiBaseUrl;
  }

  let overrideHost: string;
  try {
    overrideHost = hostOf(override);
  } catch {
    throw new Error(`LLAMA_CLOUD_BASE_URL is not a valid URL: "${override}"`);
  }

  const region = getRegion();
  const foreign = API_HOSTS.find(
    (entry) => entry.region !== region && entry.host === overrideHost
  );
  if (foreign) {
    throw new Error(
      `LLAMA_CLOUD_BASE_URL points at the ${PROFILES[foreign.region].label} API ("${override}") ` +
        `but LLAMA_CLOUD_REGION is "${region}" (${PROFILES[region].label}).`
    );
  }

  return override.replace(/\/+$/, '');
}

/**
 * Fail a misconfigured deployment at boot rather than on every tool call.
 * Called from `instrumentation.ts`, which Next runs once per runtime at startup:
 * without it a bad region deploys green and only surfaces as a per-request error
 * that reaches the MCP client, long after the deployment has gone live.
 */
export function assertRegionConfig(): void {
  llamaCloudBaseUrl();
}

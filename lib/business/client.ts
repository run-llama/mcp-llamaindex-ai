import LlamaCloud from '@llamaindex/llama-cloud';
import { llamaCloudBaseUrl } from '../region';

/**
 * Identifies this server to the LlamaCloud API. The platform buckets
 * `X-SDK-Name` against a closed allowlist and emits it as a metric label;
 * anything outside that allowlist is recorded as `other`.
 */
export const SDK_NAME = 'llamacloud-mcp';

export const SDK_NAME_HEADER = 'X-SDK-Name';

/**
 * Every LlamaCloud call goes through here so a new call site cannot forget the
 * header — it is the only thing tying platform usage back to this server.
 */
export function llamaCloudClient(authToken: string): LlamaCloud {
  return new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
    defaultHeaders: { [SDK_NAME_HEADER]: SDK_NAME },
  });
}

import LlamaCloudAdmin from '@llamaindex/llama-cloud-admin';
import { llamaCloudBaseUrl } from '../region';
import { SDK_NAME, SDK_NAME_HEADER } from './client';

/**
 * The admin SDK, for the tenant-administration routes the product SDK does not
 * carry. It is generated from `admin_openapi.json` rather than the public spec,
 * which is the only place api-key management is published, and it publishes to
 * no registry — hence the git dependency and the `onlyBuiltDependencies` entry
 * that lets its `prepare` script build.
 *
 * Same host and same bearer as `llamaCloudClient`; only the generated surface
 * differs. The region guard applies identically, so `baseURL` is mandatory here
 * for the reason it is there.
 */
export function llamaCloudAdminClient(authToken: string): LlamaCloudAdmin {
  return new LlamaCloudAdmin({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
    defaultHeaders: { [SDK_NAME_HEADER]: SDK_NAME },
  });
}

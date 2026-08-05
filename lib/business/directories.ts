import LlamaCloud from '@llamaindex/llama-cloud';
import { llamaCloudBaseUrl } from '../region';

export type DirectoryType = 'user' | 'index' | 'ephemeral';

export interface DirectorySummary {
  directoryId: string;
  name: string;
  type: DirectoryType | null;
  description: string | null;
}

export interface DirectoryFileSummary {
  /** Stable handle for the file inside the directory (`dfl-...`). */
  directoryFileId: string;
  /**
   * Storage location ID. Nullable — a directory file can exist before its
   * underlying storage object does, so this is never a substitute for
   * directoryFileId.
   */
  fileId: string | null;
  displayName: string;
  uniqueId: string;
  metadata: Record<string, unknown>;
  downloadUrl: string | null;
}

export interface ListDirectoriesResult {
  directories: DirectorySummary[];
  nextPageToken: string | null;
}

export interface ListDirectoryResult {
  directoryId: string;
  name: string;
  type: DirectoryType | null;
  totalFiles: number | null;
  files: DirectoryFileSummary[];
  nextPageToken: string | null;
}

export interface AddedFile {
  fileId: string;
  directoryFileId: string;
  displayName: string;
}

export interface FailedFile {
  fileId: string;
  error: string;
}

export interface AddFilesResult {
  directoryId: string;
  added: AddedFile[];
  failed: FailedFile[];
}

function client(authToken: string): LlamaCloud {
  return new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
}

/**
 * Normalize a page token from a list response.
 *
 * The SDK types `next_page_token` as a non-nullable string, but the API omits
 * it (sending `null`) on the final page. Treat any falsy value as "no more
 * pages" — comparing against `''` alone loops forever on `null`.
 */
function nextToken(token: string | null | undefined): string | null {
  return token ? token : null;
}

export async function createDirectory({
  authToken,
  name,
  projectId,
  description = null,
}: {
  authToken: string;
  name: string;
  /**
   * Required. Directory creation is the only write in the index chain with no
   * existing resource to anchor it, so omitting the project would silently
   * create the directory in the caller's default project.
   */
  projectId: string;
  description?: string | null;
}): Promise<DirectorySummary> {
  const response = await client(authToken).beta.directories.create({
    name,
    project_id: projectId,
    description,
    type: 'user',
  });
  return {
    directoryId: response.id,
    name: response.name,
    type: (response.type as DirectoryType | undefined) ?? null,
    description: response.description ?? null,
  };
}

export async function listDirectories({
  authToken,
  projectId = null,
  name = null,
  type = 'user',
  pageSize = null,
  pageToken = null,
}: {
  authToken: string;
  projectId?: string | null;
  name?: string | null;
  /**
   * Defaults to `user`. Indexes create their own `index`-typed output
   * directory, which must not be offered as a source directory.
   */
  type?: DirectoryType | null;
  pageSize?: number | null;
  pageToken?: string | null;
}): Promise<ListDirectoriesResult> {
  const page = await client(authToken).beta.directories.list({
    project_id: projectId,
    name,
    type,
    page_size: pageSize ?? undefined,
    page_token: pageToken ?? undefined,
  });
  return {
    directories: page.items.map((d) => ({
      directoryId: d.id,
      name: d.name,
      type: (d.type as DirectoryType | undefined) ?? null,
      description: d.description ?? null,
    })),
    nextPageToken: nextToken(page.next_page_token),
  };
}

export async function listDirectory({
  authToken,
  directoryId,
  projectId = null,
  displayNameContains = null,
  pageSize = null,
  pageToken = null,
  includeDownloadUrls = false,
}: {
  authToken: string;
  directoryId: string;
  projectId?: string | null;
  displayNameContains?: string | null;
  pageSize?: number | null;
  pageToken?: string | null;
  includeDownloadUrls?: boolean;
}): Promise<ListDirectoryResult> {
  const c = client(authToken);
  const [directory, page] = await Promise.all([
    c.beta.directories.get(directoryId, { project_id: projectId }),
    c.beta.directories.files.list(directoryId, {
      project_id: projectId,
      display_name_contains: displayNameContains,
      expand: includeDownloadUrls ? ['download_url'] : null,
      page_size: pageSize ?? undefined,
      page_token: pageToken ?? undefined,
    }),
  ]);

  // `total_size` is only present when the API was asked to count; absent is
  // meaningfully different from zero, so it stays null rather than defaulting.
  const totalSize = (page as { total_size?: number | null }).total_size;

  return {
    directoryId: directory.id,
    name: directory.name,
    type: (directory.type as DirectoryType | undefined) ?? null,
    totalFiles: totalSize ?? null,
    files: page.items.map((f) => ({
      directoryFileId: f.id,
      fileId: f.file_id ?? null,
      displayName: f.display_name,
      uniqueId: f.unique_id,
      metadata: (f.metadata ?? {}) as Record<string, unknown>,
      downloadUrl: f.download_url?.url ?? null,
    })),
    nextPageToken: nextToken(page.next_page_token),
  };
}

/**
 * Add already-uploaded files to a directory.
 *
 * The API adds one file per call, so a partial failure is the normal case
 * rather than an edge case. Failures are collected and returned instead of
 * thrown: the caller needs to know which files landed so a retry does not
 * duplicate them.
 */
export async function addFilesToDirectory({
  authToken,
  directoryId,
  fileIds,
  projectId = null,
}: {
  authToken: string;
  directoryId: string;
  fileIds: string[];
  projectId?: string | null;
}): Promise<AddFilesResult> {
  const c = client(authToken);
  const added: AddedFile[] = [];
  const failed: FailedFile[] = [];

  for (const fileId of fileIds) {
    try {
      const response = await c.beta.directories.files.add(directoryId, {
        file_id: fileId,
        project_id: projectId,
      });
      added.push({
        fileId,
        directoryFileId: response.id,
        displayName: response.display_name,
      });
    } catch (err) {
      failed.push({
        fileId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { directoryId, added, failed };
}

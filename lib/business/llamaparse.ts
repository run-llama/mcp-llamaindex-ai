import LlamaCloud from '@llamaindex/llama-cloud';
import {
  CategoryType,
  ClassifyResult,
  ParsingResult,
  SplitCategoryType,
  SplitResult,
} from './types';
import { RetrievalGrepResponse } from '@llamaindex/llama-cloud/resources/beta.js';
import { llamaCloudBaseUrl } from '../region';

const MaximumWaitingTime: number = 1800 * 1000;
const MaxDelay: number = 60;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadFile({
  authToken,
  fileData,
  fileName,
  purpose = undefined,
  fileType = undefined,
  projectId = undefined,
}: {
  authToken: string;
  fileData: string | Uint8Array<ArrayBuffer>;
  fileName: string;
  purpose?: string | undefined;
  fileType?: string | undefined;
  projectId?: string | undefined;
}): Promise<string> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  let bytes;
  if (typeof fileData === 'string') {
    const binaryString = atob(fileData);
    bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  } else {
    bytes = fileData;
  }

  const blob = new Blob([bytes], {
    type: fileType ?? 'application/pdf',
  });

  // Cast Blob as File or use Object.assign to add name property
  const file = Object.assign(blob, { name: fileName });

  const fileObj = await client.files.create({
    file: file,
    purpose: purpose ?? 'parse',
    project_id: projectId,
  });
  return fileObj.id;
}

export async function parseFile({
  authToken,
  fileId,
  tier = undefined,
  version = undefined,
  markdown = true,
  projectId = undefined,
  pages = undefined,
}: {
  authToken: string;
  fileId: string;
  tier?: undefined | 'cost_effective' | 'agentic' | 'agentic_plus';
  version?: undefined | string;
  markdown?: boolean;
  projectId?: string | undefined;
  pages?: number[] | undefined;
}): Promise<ParsingResult> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  const expand = [markdown ? 'markdown_full' : 'text_full'];
  const result = await client.parsing.parse({
    version: version ?? 'latest',
    tier: tier ?? 'cost_effective',
    file_id: fileId,
    project_id: projectId,
    expand,
    page_ranges: {
      target_pages: pages
        ? pages.map((p) => p.toString()).join(',')
        : undefined,
    },
  });
  const parsingResult: ParsingResult = {};
  if (markdown) {
    parsingResult.markdown = result.markdown_full ?? 'No markdown content';
  } else {
    parsingResult.text = result.text_full ?? 'No text content';
  }
  return parsingResult;
}

export async function classifyFile({
  authToken,
  fileId,
  categories,
  mode = undefined,
  projectId = undefined,
  configurationId = undefined,
}: {
  authToken: string;
  fileId: string;
  categories?: CategoryType[];
  mode?: 'FAST' | undefined;
  projectId?: string | undefined;
  configurationId?: string | undefined;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });

  if (!configurationId && !categories) {
    throw new Error(
      'classifyFile requires either `categories` or a `configurationId`'
    );
  }

  const job = await client.classify.create(
    configurationId
      ? {
          file_input: fileId,
          configuration_id: configurationId,
          project_id: projectId,
        }
      : {
          file_input: fileId,
          configuration: {
            mode,
            rules: categories!,
          },
          project_id: projectId,
        }
  );

  const baseDelay = 0.1;
  const start = Date.now();
  let classRes;
  // max 30 minutes of total wait time
  while (Date.now() - start < MaximumWaitingTime) {
    const result = await client.classify.get(job.id, {
      project_id: projectId,
    });
    if (result.result) {
      classRes = result.result;
      break;
    }
    const delay = Math.min(baseDelay + 1, MaxDelay);
    await sleep(delay * 1000);
  }

  if (!classRes) {
    throw new Error('Classify operation timed out: result is not available');
  }

  const classifyResult: ClassifyResult = {
    fileId: fileId,
    classifiedAs: classRes.type ?? 'uncategorized',
    reasoning: classRes.reasoning,
    confidence: classRes.confidence,
    asString() {
      return `File ${this.fileId} classified as ${this.classifiedAs} (confidence: ${this.confidence}) with the following reasoning:\n\n${this.reasoning}`;
    },
  };

  return classifyResult;
}

export async function splitFile({
  authToken,
  fileId,
  categories,
  allowUnacategorized = undefined,
  projectId = undefined,
  configurationId = undefined,
}: {
  authToken: string;
  fileId: string;
  categories?: SplitCategoryType[];
  allowUnacategorized?: 'include' | 'omit' | 'forbid' | undefined;
  projectId?: string | undefined;
  configurationId?: string | undefined;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });

  if (!configurationId && !categories) {
    throw new Error(
      'splitFile requires either `categories` or a `configurationId`'
    );
  }

  const job = await client.beta.split.create(
    configurationId
      ? {
          document_input: { type: 'file_id', value: fileId },
          configuration_id: configurationId,
          project_id: projectId,
        }
      : {
          document_input: { type: 'file_id', value: fileId },
          configuration: {
            categories: categories!,
            splitting_strategy: {
              allow_uncategorized: allowUnacategorized ?? 'include',
            },
          },
          project_id: projectId,
        }
  );

  const result = await client.beta.split.waitForCompletion(job.id, {
    project_id: projectId,
  });
  if (result.result) {
    const splitResult: SplitResult = {
      fileId: fileId,
      segements: [],
      asString() {
        let s = '';
        for (const segment of this.segements) {
          s += `Pages ${segment.pages.join(', ')} where categorized as ${segment.category} with a confidence level of ${segment.confidence}\n`;
        }
        return s;
      },
    };
    for (const s of result.result.segments) {
      splitResult.segements.push({
        confidence: s.confidence_category,
        category: s.category,
        pages: s.pages,
      });
    }
    return splitResult;
  }
  throw new Error('No split result was produced');
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  isDefault: boolean;
}

export async function getProjects(
  authToken: string
): Promise<ProjectSummary[]> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  const projects = await client.projects.list();
  return projects.map((p) => ({
    projectId: p.id,
    name: p.name,
    isDefault: p.is_default ?? false,
  }));
}

export async function generateExtractSchema({
  token,
  fileId,
  projectId = undefined,
  generationPrompt,
}: {
  token: string;
  fileId: string;
  projectId?: string | undefined;
  generationPrompt: string;
}): Promise<[string, string]> {
  const client = new LlamaCloud({
    apiKey: token,
    baseURL: llamaCloudBaseUrl(),
  });
  const configCreateReq = await client.extract.generateSchema({
    project_id: projectId,
    prompt: generationPrompt,
    file_id: fileId,
  });
  const response = await client.configurations.create({
    ...configCreateReq,
    project_id: projectId,
  });
  if (response.parameters.product_type === 'extract_v2') {
    return [JSON.stringify(response.parameters.data_schema), response.id];
  } else {
    throw new Error('Could not generate a schema');
  }
}

export async function extract({
  token,
  fileId,
  projectId = undefined,
  configurationId,
}: {
  token: string;
  fileId: string;
  projectId?: string | undefined;
  configurationId: string;
}) {
  const client = new LlamaCloud({
    apiKey: token,
    baseURL: llamaCloudBaseUrl(),
  });
  const response = await client.extract.run({
    file_input: fileId,
    configuration_id: configurationId,
    project_id: projectId,
  });
  if (!response.extract_result) {
    throw new Error('No extract result produced');
  }
  let result: {
    [key: string]:
      | string
      | number
      | boolean
      | unknown[]
      | {
          [key: string]: unknown;
        }
      | null;
  };
  if (!Array.isArray(response.extract_result)) {
    result = response.extract_result;
  } else {
    result = response.extract_result[0]!;
  }

  return JSON.stringify(result, undefined, 2);
}

export async function listIndexes({
  authToken,
  projectId = null,
}: {
  authToken: string;
  projectId?: string | null;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  let pageToken: string | undefined = undefined;
  const indexes: { name: string; indexId: string; description: string }[] = [];
  while (true) {
    const response = await client.beta.indexes.list({
      project_id: projectId,
      page_token: pageToken,
    });
    const idxs = response.items.map((i) => {
      return {
        name: i.name,
        indexId: i.export_config_id,
        description: i.description ?? 'no description',
      };
    });
    indexes.push(...idxs);
    if (response.next_page_token === '') {
      break;
    }
    pageToken = response.next_page_token;
  }
  let s = '';
  for (const idx of indexes) {
    s += `- ${idx.name} (ID: ${idx.indexId}): ${idx.description}\n`;
  }
  return s;
}

export interface IndexSummary {
  /**
   * The index ID is the export config ID: `GET /indexes/{index_id}`,
   * `POST /indexes/{index_id}/sync` and `POST /retrieval/retrieve` all key on
   * it, and `listIndexes` reports it. The `id` field on the create response is
   * a different identifier and is not accepted by any of them.
   */
  indexId: string;
  name: string;
  sourceDirectoryId: string;
  status: string | null;
  lastSyncedAt: string | null;
  lastExportedAt: string | null;
}

function toIndexSummary(response: {
  export_config_id: string;
  name: string;
  source_directory_id: string;
  last_synced_at?: string | null;
  last_exported_at?: string | null;
  metadata?: { status?: unknown } | null;
}): IndexSummary {
  const status = response.metadata?.status;
  return {
    indexId: response.export_config_id,
    name: response.name,
    sourceDirectoryId: response.source_directory_id,
    // `metadata` is an open schema — only `ready` and `failed` are stable, so
    // this is passed through as a string rather than narrowed to an enum.
    status: typeof status === 'string' ? status : null,
    lastSyncedAt: response.last_synced_at ?? null,
    lastExportedAt: response.last_exported_at ?? null,
  };
}

export async function createIndex({
  authToken,
  sourceDirectoryId,
  projectId = null,
  name = null,
  description = null,
  storeAttachments = null,
  parseConfigId = null,
}: {
  authToken: string;
  sourceDirectoryId: string;
  projectId?: string | null;
  name?: string | null;
  description?: string | null;
  storeAttachments?: string[] | null;
  parseConfigId?: string | null;
}): Promise<IndexSummary> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  // sync_frequency is deliberately not exposed. Only `manual` is implemented
  // server-side; accepting `daily` would persist a setting that never runs.
  const response = await client.beta.indexes.create({
    source_directory_id: sourceDirectoryId,
    // project_id is a query param: omit when absent. Sending null serializes
    // to an empty value, which the API treats as a filter/selector on "".
    project_id: projectId ?? undefined,
    name,
    description,
    store_attachments: storeAttachments,
    products: parseConfigId
      ? [{ product_type: 'parse', product_config_id: parseConfigId }]
      : null,
  });

  if (!response.export_config_id) {
    throw new Error(
      'Index was created but has no export config ID yet, so it cannot be queried. Retry getIndexStatus shortly.'
    );
  }
  return toIndexSummary(response);
}

export async function getIndexStatus({
  authToken,
  indexId,
  projectId = null,
}: {
  authToken: string;
  indexId: string;
  projectId?: string | null;
}): Promise<IndexSummary> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  const response = await client.beta.indexes.get(indexId, {
    project_id: projectId ?? undefined,
  });
  return toIndexSummary(response);
}

export async function syncIndex({
  authToken,
  indexId,
  projectId = null,
}: {
  authToken: string;
  indexId: string;
  projectId?: string | null;
}): Promise<{ indexId: string; syncStarted: boolean; message: string }> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  try {
    await client.beta.indexes.sync(indexId, {
      project_id: projectId ?? undefined,
    });
    return {
      indexId,
      syncStarted: true,
      message:
        'Sync started. Poll getIndexStatus until status is ready before querying.',
    };
  } catch (err) {
    // A sync already in flight comes back as 409 (conflict) or 429 (rate
    // limited) — an expected state, not a failure to retry into. Match on the
    // status code rather than the error text, which isn't a stable contract.
    // Surface it as a plain outcome and point the agent at getIndexStatus (its
    // own tool) to see where the running sync stands, rather than retrying.
    if (
      err instanceof LlamaCloud.APIError &&
      (err.status === 409 || err.status === 429)
    ) {
      return {
        indexId,
        syncStarted: false,
        message:
          'A sync is already running for this index. Do not retry syncIndex; call getIndexStatus to check its progress and wait until status is ready.',
      };
    }
    throw err;
  }
}

export async function searchFilesFromIndex({
  authToken,
  indexId,
  projectId = null,
  fileName = null,
  fileNameContains = null,
}: {
  authToken: string;
  indexId: string;
  projectId?: string | null;
  fileName?: string | null;
  fileNameContains?: string | null;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  let pageToken: string | undefined = undefined;
  const files: { name: string; fileId: string }[] = [];
  while (true) {
    const response = await client.beta.retrieval.find({
      project_id: projectId,
      file_name: fileName,
      file_name_contains: fileNameContains,
      index_id: indexId,
      page_token: pageToken,
    });
    const fls = response.items.map((f) => {
      return {
        name: f.file_name,
        fileId: f.file_id,
      };
    });
    files.push(...fls);
    if (response.next_page_token === '') {
      break;
    }
    pageToken = response.next_page_token;
  }
  let s = `Files in Index ${indexId}`;
  for (const fl of files) {
    s += `- ${fl.name} (ID: ${fl.fileId})\n`;
  }
  return s;
}

export async function readFileFromIndex({
  authToken,
  indexId,
  fileId,
  projectId = null,
  offset = null,
  maxLength = null,
}: {
  authToken: string;
  indexId: string;
  fileId: string;
  projectId?: string | null;
  offset?: number | null;
  maxLength?: number | null;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  const response = await client.beta.retrieval.read({
    project_id: projectId,
    file_id: fileId,
    index_id: indexId,
    offset: offset ?? 0,
    max_length: maxLength,
  });
  return response.content;
}

export async function grepFileFromIndex({
  authToken,
  indexId,
  fileId,
  pattern,
  projectId = null,
  contextChars = null,
  limit = null,
}: {
  authToken: string;
  indexId: string;
  fileId: string;
  pattern: string;
  projectId?: string | null;
  contextChars?: number | null;
  limit?: number | null;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  const grepMatches: RetrievalGrepResponse[] = [];
  let pageToken: string | undefined = undefined;
  while (true) {
    const response = await client.beta.retrieval.grep({
      project_id: projectId,
      file_id: fileId,
      index_id: indexId,
      pattern: pattern,
      context_chars: contextChars,
      page_size: limit ?? undefined,
      page_token: pageToken,
    });
    grepMatches.push(...response.items);
    if (response.next_page_token === '') {
      break;
    }
    pageToken = response.next_page_token;
  }
  let s = `Matches for \`${pattern}\` in ${fileId} from index ${indexId} (with ${contextChars ?? 0} context chars)`;
  for (const m of grepMatches) {
    s += `- ${m.content} (start: ${m.start_char}, end: ${m.start_char})\n`;
  }
  return s;
}

export async function retrieveFromIndex({
  authToken,
  indexId,
  query,
  projectId = null,
  topK = null,
  rerankTopN = null,
}: {
  authToken: string;
  indexId: string;
  query: string;
  projectId?: string | null;
  topK?: number | null;
  rerankTopN?: number | null;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: llamaCloudBaseUrl(),
  });
  const response = await client.beta.retrieval.retrieve({
    project_id: projectId,
    index_id: indexId,
    query,
    top_k: topK,
    rerank: rerankTopN
      ? { enabled: true, top_n: rerankTopN }
      : { enabled: false },
  });
  let retrieved = '';
  let i = 0;
  for (const r of response.results) {
    i += 1;
    let content = r.content;
    if (content.length > 500) {
      content = content.slice(0, 500) + '...';
    }
    retrieved += `Match ${i} (retrieval score: ${r.score ?? 'NA'}; reranking score: ${r.rerank_score ?? 'NA'})\n\n${content}`;
    if (r.metadata) {
      retrieved += `\n\nMetadata:\n\n\`\`\`json\n${JSON.stringify(r.metadata, undefined, 2)}\n\`\`\``;
    }
  }
  return retrieved;
}

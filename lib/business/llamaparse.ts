import LlamaCloud from '@llamaindex/llama-cloud';
import {
  CategoryType,
  ClassifyResult,
  ParsingResult,
  SplitCategoryType,
  SplitResult,
} from './types';

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
}: {
  authToken: string;
  fileData: string | Uint8Array<ArrayBuffer>;
  fileName: string;
  purpose?: string | undefined;
  fileType?: string | undefined;
}): Promise<string> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
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
  });
  return fileObj.id;
}

export async function parseFile({
  authToken,
  fileId,
  tier = undefined,
  version = undefined,
  markdown = true,
}: {
  authToken: string;
  fileId: string;
  tier?: undefined | 'cost_effective' | 'agentic' | 'agentic_plus';
  version?: undefined | string;
  markdown?: boolean;
}): Promise<ParsingResult> {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
  });
  const expand = [markdown ? 'markdown_full' : 'text_full'];
  const result = await client.parsing.parse({
    version: version ?? 'latest',
    tier: tier ?? 'cost_effective',
    file_id: fileId,
    expand,
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
}: {
  authToken: string;
  fileId: string;
  categories: CategoryType[];
  mode?: 'FAST' | undefined;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
  });

  const job = await client.classify.create({
    file_input: fileId,
    configuration: {
      mode,
      rules: categories,
    },
  });

  const baseDelay = 0.1;
  const start = Date.now();
  let classRes;
  // max 30 minutes of total wait time
  while (Date.now() - start < MaximumWaitingTime) {
    const result = await client.classify.get(job.id);
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
}: {
  authToken: string;
  fileId: string;
  categories: SplitCategoryType[];
  allowUnacategorized?: 'include' | 'omit' | 'forbid' | undefined;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
  });

  const job = await client.beta.split.create({
    document_input: { type: 'file_id', value: fileId },
    configuration: {
      categories,
      splitting_strategy: {
        allow_uncategorized: allowUnacategorized ?? 'include',
      },
    },
  });

  const result = await client.beta.split.waitForCompletion(job.id);
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

import type { LiteParse as LiteParseType } from '@llamaindex/liteparse';
import LlamaCloud from '@llamaindex/llama-cloud';

// Lazy loader so a native-module load failure doesn't crash the whole SSR bundle
let _LiteParseCtor: typeof LiteParseType | null = null;
async function getLiteParse() {
  if (!_LiteParseCtor) {
    const mod = await import('@llamaindex/liteparse');
    _LiteParseCtor = mod.LiteParse;
  }
  return _LiteParseCtor;
}

const reasonsToTier: Record<
  string,
  'agentic' | 'agentic_plus' | 'cost_effective'
> = {
  'no-text': 'cost_effective',
  scanned: 'agentic',
  'sparse-text': 'agentic',
  'embedded-images': 'agentic',
  garbled: 'agentic_plus',
  'vector-text': 'agentic_plus',
};

// (previous top-level `const lit = new LiteParse(...)` moved to lazy init inside handler)

const tierRank = { cost_effective: 0, agentic: 1, agentic_plus: 2 } as const;

function compareTier(
  current: keyof typeof tierRank,
  requested: keyof typeof tierRank
) {
  return tierRank[current] >= tierRank[requested] ? current : requested;
}

export async function getFile(
  client: LlamaCloud,
  fileId: string
): Promise<Buffer> {
  const presigned_url = await client.files.get(fileId);
  const response = await fetch(presigned_url.url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Could not fetch the file associated with the provided ID. Status code: ${response.status}; Error detail: ${text}`
    );
  }
  const fileBlob = await response.arrayBuffer();
  return Buffer.from(fileBlob);
}

export async function isComplex({
  authToken,
  fileId,
}: {
  authToken: string;
  fileId: string;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
  });
  const Liteparse = await getLiteParse();
  const lit = new Liteparse({ ocrEnabled: false, quiet: true, numWorkers: 1 });
  const buf = await getFile(client, fileId);
  const isComplex = await lit.isComplex(buf);
  const pageComplexity: {
    liteparse: number[];
    costEffective: number[];
    agentic: number[];
    agenticPlus: number[];
  } = {
    liteparse: [],
    costEffective: [],
    agentic: [],
    agenticPlus: [],
  };
  for (const p of isComplex) {
    if (!p.needsOcr) {
      pageComplexity.liteparse.push(p.pageNumber);
    } else {
      let tier: 'agentic' | 'agentic_plus' | 'cost_effective' =
        'cost_effective';
      for (const r of p.reasons) {
        tier = compareTier(tier, reasonsToTier[r]);
      }
      switch (tier) {
        case 'agentic':
          pageComplexity.agentic.push(p.pageNumber);
          break;
        case 'agentic_plus':
          pageComplexity.agenticPlus.push(p.pageNumber);
          break;
        default:
          pageComplexity.costEffective.push(p.pageNumber);
          break;
      }
    }
  }
  return pageComplexity;
}

export async function litParse({
  authToken,
  fileId,
  pages = undefined,
  markdown = true,
  includeJson = false,
}: {
  authToken: string;
  fileId: string;
  pages?: number[] | undefined;
  markdown?: boolean;
  includeJson?: boolean;
}) {
  const client = new LlamaCloud({
    apiKey: authToken,
    baseURL: process.env.LLAMA_CLOUD_BASE_URL,
  });
  const Liteparse = await getLiteParse();
  const lit = new Liteparse({
    ocrEnabled: false,
    quiet: true,
    numWorkers: 1,
    outputFormat: markdown ? 'markdown' : 'text',
    targetPages: pages ? pages.map((p) => p.toString()).join(',') : undefined,
  });
  const buf = await getFile(client, fileId);
  const parsed = await lit.parse(buf);
  if (includeJson) {
    return { pages: parsed.pages, text: parsed.text };
  }
  return { pages: null, text: parsed.text };
}

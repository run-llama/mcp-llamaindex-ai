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

type Tier = 'cost_effective' | 'agentic' | 'agentic_plus';

const tierRank: Record<Tier, number> = {
  cost_effective: 0,
  agentic: 1,
  agentic_plus: 2,
};

function maxTier(a: Tier, b: Tier): Tier {
  return tierRank[a] >= tierRank[b] ? a : b;
}

interface ComplexityReasonInput {
  reasons: string[];
  textLength: number;
  textCoverage: number;
  imageCoverage: number;
  largestImageCoverage: number;
  imageBlockCount: number;
  fullPageImage: boolean;
  uncoveredVectorArea: number | null;
  isGarbled: boolean;
  pageArea: number;
  layout?: {
    columnCount: number;
    ruledTableCount: number;
    ruledTableCoverage: number;
    textTableRunCount: number;
    figureCount: number;
    figureCoverage: number;
    isComplex: boolean;
    reasons: string[];
  } | null;
}

// Thresholds tuned as separate constants so you can move them without
// touching the scoring logic.
const THRESH = {
  // sparse-text: below this text_coverage, treat as "very sparse" (harder)
  verySparseTextCoverage: 0.05,
  // vector-text: uncovered vector area, in pt^2, that indicates "most of
  // the page is vector text" rather than a stray logo/watermark
  heavyVectorAreaPt2: 20000,
  // embedded-images: many small figures interleaved with text is harder to
  // reconstruct than one dominant image
  manyImageBlocks: 3,
  // layout: dense-graphics or multiple layout reasons firing together
  denseGraphicsCoverage: 0.35,
} as const;

/**
 * Base tier a single reason implies on its own, ignoring magnitude.
 * Kept as a floor so an unknown/new reason variant still gets a sane
 * default (agentic) instead of silently mapping to cost_effective.
 */
const reasonFloor: Record<string, Tier> = {
  'no-text': 'cost_effective',
  scanned: 'agentic',
  'sparse-text': 'agentic',
  'embedded-images': 'agentic',
  garbled: 'agentic_plus',
  'vector-text': 'agentic_plus',
};

function tierForReason(reason: string, p: ComplexityReasonInput): Tier {
  const floor = reasonFloor[reason] ?? 'agentic'; // unknown reasons: be conservative, not cheap

  switch (reason) {
    case 'sparse-text':
      // Thin captions on a figure page vs. genuinely almost-empty text:
      // the latter behaves more like a scan and deserves agentic_plus if
      // there's also no full-page image to explain the sparseness (i.e.
      // it's not just "scan with some OCR'd captions").
      if (p.textCoverage < THRESH.verySparseTextCoverage && !p.fullPageImage) {
        return 'agentic_plus';
      }
      return floor;

    case 'embedded-images':
      // One dominant image (e.g. a chart taking up half the page) is
      // "agentic"-shaped. Several smaller images interleaved with text is
      // harder to get reading order right on.
      if (
        p.imageBlockCount >= THRESH.manyImageBlocks &&
        p.imageCoverage > p.largestImageCoverage * 1.5
      ) {
        return 'agentic_plus';
      }
      return floor;

    case 'vector-text':
      if (
        p.uncoveredVectorArea !== null &&
        p.uncoveredVectorArea >= THRESH.heavyVectorAreaPt2
      ) {
        return 'agentic_plus'; // already the floor, but explicit for clarity
      }
      return floor;

    case 'garbled':
      // Garbled text alongside substantial real text coverage suggests a
      // partial cmap failure (some usable structure survives) rather than
      // full corruption — still agentic_plus per your floor, but you could
      // soften this if you find it's over-escalating in practice.
      return floor;

    default:
      return floor;
  }
}

/**
 * Compounding: multiple independent reasons firing at once (even if each
 * individually only implies 'agentic') signals a page that's hard in more
 * than one dimension. Escalate once the reason count crosses a threshold.
 */
function compoundingEscalation(p: ComplexityReasonInput, base: Tier): Tier {
  if (p.reasons.length >= 3 && base === 'agentic') {
    return 'agentic_plus';
  }
  return base;
}

/**
 * Layout signals are orthogonal to needs_ocr but still inform tier choice:
 * a page that needs no OCR at all but has multi-column + table structure
 * can still trip up a cost_effective single-pass extractor.
 */
function layoutEscalation(p: ComplexityReasonInput, base: Tier): Tier {
  if (!p.layout) return base;
  const { columnCount, ruledTableCoverage, figureCoverage, reasons } = p.layout;

  let tier = base;

  // Table structure is one of the harder things to reconstruct faithfully;
  // a lot of ruled-table area pushes towards agentic_plus regardless of
  // OCR reasons.
  if (ruledTableCoverage > 0.3) {
    tier = maxTier(tier, 'agentic_plus');
  } else if (reasons.includes('table-likely')) {
    tier = maxTier(tier, 'agentic');
  }

  if (columnCount >= 3) {
    tier = maxTier(tier, 'agentic_plus');
  } else if (columnCount === 2) {
    tier = maxTier(tier, 'agentic');
  }

  if (figureCoverage >= THRESH.denseGraphicsCoverage) {
    tier = maxTier(tier, 'agentic_plus');
  }

  // Multiple layout reasons compounding, same idea as OCR-reason compounding.
  if (reasons.length >= 2) {
    tier = maxTier(tier, base === 'cost_effective' ? 'agentic' : tier);
  }

  return tier;
}

export function classifyPageTier(
  p: ComplexityReasonInput,
  includeLayout: boolean
): Tier {
  if (p.reasons.length === 0 && !(p.layout?.isComplex ?? false)) {
    return 'cost_effective';
  }

  let tier: Tier = 'cost_effective';
  for (const reason of p.reasons) {
    tier = maxTier(tier, tierForReason(reason, p));
  }
  tier = compoundingEscalation(p, tier);
  if (includeLayout) {
    tier = layoutEscalation(p, tier);
  }
  return tier;
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
  includeLayout = false,
}: {
  authToken: string;
  fileId: string;
  includeLayout?: boolean;
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
  });
  const buf = await getFile(client, fileId);
  const pages = await lit.isComplex(buf);

  const pageComplexity: {
    liteparse: number[];
    costEffective: number[];
    agentic: number[];
    agenticPlus: number[];
  } = { liteparse: [], costEffective: [], agentic: [], agenticPlus: [] };

  for (const p of pages) {
    if (!p.needsOcr && !(p.layout?.isComplex ?? false)) {
      pageComplexity.liteparse.push(p.pageNumber);
      continue;
    }

    const tier = classifyPageTier(
      {
        reasons: p.reasons,
        textLength: p.textLength,
        textCoverage: p.textCoverage,
        imageCoverage: p.imageCoverage,
        largestImageCoverage: p.largestImageCoverage,
        imageBlockCount: p.imageBlockCount,
        fullPageImage: p.fullPageImage,
        uncoveredVectorArea: p.uncoveredVectorArea ?? null,
        isGarbled: p.isGarbled,
        pageArea: p.pageArea,
        layout: p.layout
          ? {
              columnCount: p.layout.columnCount,
              ruledTableCount: p.layout.ruledTableCount,
              ruledTableCoverage: p.layout.ruledTableCoverage,
              textTableRunCount: p.layout.textTableRunCount,
              figureCount: p.layout.figureCount,
              figureCoverage: p.layout.figureCoverage,
              isComplex: p.layout.isComplex,
              reasons: p.layout.reasons,
            }
          : null,
      },
      includeLayout
    );

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

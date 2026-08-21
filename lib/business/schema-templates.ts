/**
 * Starter extraction schemas, vendored from the LlamaCloud playground.
 *
 * `schema-templates.json` is generated in the platform repo from
 * `frontend/src/components/section/extract-v2/schema-designer/templates.ts` and
 * copied here verbatim — see the `$comment` at the top of the JSON. Nothing in
 * this module calls LlamaCloud; it is a local, read-only catalog that lets a CLI
 * agent pick a schema without an LLM round-trip through
 * `generateExtractionConfig`.
 */
import catalog from './schema-templates.json';

export type SchemaTemplateCategory = {
  id: string;
  label: string;
};

export type SchemaTemplate = {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  featured: boolean;
  schema: Record<string, unknown>;
};

/** What a search hit returns — the schema itself is fetched separately. */
export type SchemaTemplateSummary = Omit<SchemaTemplate, 'schema'> & {
  /** Top-level field names, so a caller can judge fit without the full schema. */
  fields: string[];
};

const TEMPLATES = catalog.templates as SchemaTemplate[];
const CATEGORIES = catalog.categories as SchemaTemplateCategory[];

/** Gallery order, used to break scoring ties the way the playground lists them. */
const CATEGORY_RANK = new Map(CATEGORIES.map((c, i) => [c.id, i]));

/**
 * Order-stable hash of the catalog body. Byte-identical to the platform
 * implementation in `templates-export.ts` — the two must agree, which is what
 * proves this vendored copy has not been hand-edited or half-updated.
 */
export function fingerprintCatalog(body: {
  categories: SchemaTemplateCategory[];
  templates: SchemaTemplate[];
}): string {
  const text = JSON.stringify(body);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((code << 5) | (code >>> 3)), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export const CATALOG_VERSION: number = catalog.version;
export const CATALOG_FINGERPRINT: string = catalog.fingerprint;

/** True when the vendored JSON still hashes to the fingerprint it carries. */
export function catalogIsIntact(): boolean {
  return (
    fingerprintCatalog({ categories: CATEGORIES, templates: TEMPLATES }) ===
    CATALOG_FINGERPRINT
  );
}

export function listSchemaTemplateCategories(): SchemaTemplateCategory[] {
  return CATEGORIES.map((c) => ({ ...c }));
}

function topLevelFields(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.keys(properties as Record<string, unknown>);
}

function summarise(template: SchemaTemplate): SchemaTemplateSummary {
  const { schema, ...rest } = template;
  return { ...rest, fields: topLevelFields(schema) };
}

export function getSchemaTemplate(id: string): SchemaTemplate | undefined {
  const wanted = id.trim().toLowerCase();
  return TEMPLATES.find((t) => t.id.toLowerCase() === wanted);
}

/**
 * Relevance for one query term. Weights follow how a caller phrases a request:
 * they name the document ("invoice"), then the domain ("legal"), and only then
 * a field they need ("line_items"). 0 means the term is absent, and every term
 * must hit somewhere for the template to match at all.
 */
function scoreTerm(template: SchemaTemplate, term: string): number {
  const fields = topLevelFields(template.schema).join(' ').toLowerCase();
  if (template.title.toLowerCase().includes(term)) return 8;
  if (template.id.toLowerCase().includes(term)) return 6;
  if (template.categoryLabel.toLowerCase().includes(term)) return 4;
  if (template.description.toLowerCase().includes(term)) return 3;
  if (fields.includes(term)) return 2;
  return 0;
}

export function searchSchemaTemplates({
  query,
  category,
  limit = 10,
}: {
  query?: string;
  category?: string;
  limit?: number;
}): SchemaTemplateSummary[] {
  const wantedCategory = category?.trim().toLowerCase();
  const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);

  const scored: { template: SchemaTemplate; score: number }[] = [];
  for (const template of TEMPLATES) {
    if (
      wantedCategory &&
      template.category.toLowerCase() !== wantedCategory &&
      template.categoryLabel.toLowerCase() !== wantedCategory
    ) {
      continue;
    }
    let score = 0;
    let matchedEveryTerm = true;
    for (const term of terms) {
      const termScore = scoreTerm(template, term);
      if (termScore === 0) {
        matchedEveryTerm = false;
        break;
      }
      score += termScore;
    }
    if (!matchedEveryTerm) continue;
    // Featured templates are the playground's own recommendations; let them win
    // ties but never outrank a genuine term match.
    if (template.featured) score += 1;
    scored.push({ template, score });
  }

  scored.sort(
    (x, y) =>
      y.score - x.score ||
      (CATEGORY_RANK.get(x.template.category) ?? 0) -
        (CATEGORY_RANK.get(y.template.category) ?? 0) ||
      x.template.id.localeCompare(y.template.id)
  );

  return scored.slice(0, Math.max(1, limit)).map((s) => summarise(s.template));
}

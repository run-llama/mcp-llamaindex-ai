import {
  CATALOG_FINGERPRINT,
  CATALOG_VERSION,
  catalogIsIntact,
  getSchemaTemplate,
  listSchemaTemplateCategories,
  searchSchemaTemplates,
} from '../lib/business/schema-templates';

describe('vendored schema template catalog', () => {
  // The catalog is generated in the platform repo and copied here. A mismatch
  // means the copy was hand-edited or only half-updated, so the CLI would serve
  // schemas the playground no longer ships.
  it('hashes to the fingerprint the artifact carries', () => {
    expect(catalogIsIntact()).toBe(true);
  });

  it('is the envelope shape this module was written against', () => {
    expect(CATALOG_VERSION).toBe(1);
    expect(CATALOG_FINGERPRINT).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ships the five playground categories', () => {
    expect(listSchemaTemplateCategories().map((c) => c.id)).toEqual([
      'business',
      'legal',
      'healthcare',
      'finance_research',
      'education',
    ]);
  });

  it('lists every template when no query is given', () => {
    expect(searchSchemaTemplates({ limit: 100 })).toHaveLength(13);
  });

  it('ranks a direct title match first', () => {
    expect(searchSchemaTemplates({ query: 'invoice' })[0]?.id).toBe('invoice');
    expect(searchSchemaTemplates({ query: 'resume' })[0]?.id).toBe('resume');
  });

  it('matches on category name, which no title contains', () => {
    const hits = searchSchemaTemplates({ query: 'healthcare' });
    expect(hits.map((t) => t.id).sort()).toEqual([
      'hospital_list',
      'patient_intake',
    ]);
  });

  it('matches on a schema field name so callers can search by what they need', () => {
    const hits = searchSchemaTemplates({ query: 'line_items' });
    expect(hits.map((t) => t.id)).toContain('purchase_order');
  });

  it("matches a word that only appears in the schema's own summary", () => {
    // "agreement" is in no title, id, category, blurb or field name — only in
    // the Contract schema's description. Before this tier, the AND across
    // terms made "legal agreement" return nothing at all.
    expect(
      searchSchemaTemplates({ query: 'agreement' }).map((t) => t.id)
    ).toContain('contract');
    // Both legal templates say "agreement" in their schema summary, so both
    // are right; Contract leads on the featured tiebreak.
    expect(
      searchSchemaTemplates({ query: 'legal agreement' }).map((t) => t.id)
    ).toEqual(['contract', 'nda']);
  });

  it('still ranks a title match above a schema-summary match', () => {
    // NDA's schema summary says "non-disclosure agreement", so both match;
    // a caller typing "nda" must still get NDA first.
    expect(searchSchemaTemplates({ query: 'nda' })[0]?.id).toBe('nda');
  });

  it('requires every term to match', () => {
    expect(searchSchemaTemplates({ query: 'invoice zzzznotathing' })).toEqual(
      []
    );
  });

  it('filters by category id and by label', () => {
    const byId = searchSchemaTemplates({ category: 'legal', limit: 100 });
    const byLabel = searchSchemaTemplates({ category: 'Legal', limit: 100 });
    expect(byId.map((t) => t.id).sort()).toEqual(['contract', 'nda']);
    expect(byLabel).toEqual(byId);
  });

  it('honours the limit', () => {
    expect(searchSchemaTemplates({ limit: 3 })).toHaveLength(3);
  });

  it('summarises without the full schema but with its field names', () => {
    const [hit] = searchSchemaTemplates({ query: 'invoice' });
    expect(hit).not.toHaveProperty('schema');
    expect(hit!.fields.length).toBeGreaterThan(0);
  });

  it('returns a usable object schema by id, case-insensitively', () => {
    const template = getSchemaTemplate('TEN_K');
    expect(template?.id).toBe('ten_k');
    expect(template?.schema).toMatchObject({ type: 'object' });
    expect(template?.schema.properties).toBeDefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(getSchemaTemplate('not-a-template')).toBeUndefined();
  });
});

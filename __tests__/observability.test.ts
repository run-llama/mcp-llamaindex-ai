import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { fileExtension, redactFileId } from '../lib/observability/logger';

describe('fileExtension', () => {
  it('returns the lowercased extension', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf');
    expect(fileExtension('archive.tar.docx')).toBe('docx');
  });

  it('never returns any part of the name itself', () => {
    expect(fileExtension('2026-acme-merger-terms.docx')).toBe('docx');
  });

  it('returns "none" when there is no usable extension', () => {
    expect(fileExtension('README')).toBe('none');
    expect(fileExtension('trailing.')).toBe('none');
    expect(fileExtension('.env')).toBe('none');
  });

  // The trailing segment of these is part of the name, not an extension.
  // Echoing it back would leak exactly what this helper exists to withhold.
  it.each([
    'acme.merger',
    'Q3.plan draft',
    'project.smith-deposition',
    '2026.acquisition',
    '/tmp/a.b/README',
    `f.${'a'.repeat(200)}`,
  ])('does not echo the trailing segment of %s', (fileName) => {
    expect(fileExtension(fileName)).toBe('other');
  });
});

describe('redactFileId', () => {
  it('hides the middle of an opaque id', () => {
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(redactFileId(id)).toBe('f47ac10b****************0e02b2c3d479');
  });

  // Head 8 + tail 12 means anything <= 20 chars survives intact. This is why
  // the helper is only ever applied to IDs.
  it('is reversible on short strings, which is why free text must not use it', () => {
    expect(redactFileId('salary')).toContain('salary');
    expect(redactFileId('revenue Q3 2025')).toContain('revenue ');
  });
});

describe('span attributes', () => {
  const lib = join(__dirname, '..', 'lib');
  const sources = readdirSync(lib, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(lib, f), 'utf8'))
    .join('\n');

  // These carried user-supplied content to the trace backend. Reintroducing any
  // of them ships document names, prompts or search queries to a third party.
  // The closing quote keeps tool.query from matching tool.query_length.
  it.each(['tool.file_name', 'tool.prompt', 'tool.grep_pattern', 'tool.query'])(
    'does not record %s anywhere under lib/',
    (attribute) => {
      const quoted = new RegExp(`['"\`]${attribute.replace('.', '\\.')}['"\`]`);
      expect(sources).not.toMatch(quoted);
    }
  );
});

import { readFileSync } from 'fs';
import { join } from 'path';

import { fileExtension, redactFileId } from '../lib/observability/logger';

describe('fileExtension', () => {
  it('returns the lowercased extension', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  it('never returns any part of the name itself', () => {
    expect(fileExtension('2026-acme-merger-terms.docx')).toBe('docx');
  });

  it('returns "none" when there is no usable extension', () => {
    expect(fileExtension('README')).toBe('none');
    expect(fileExtension('trailing.')).toBe('none');
    expect(fileExtension('.env')).toBe('none');
  });

  it('refuses an implausibly long extension rather than echoing it', () => {
    expect(fileExtension(`f.${'a'.repeat(200)}`)).toBe('other');
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
  const source = readFileSync(
    join(__dirname, '..', 'lib', 'mcp', 'tools', 'tools.ts'),
    'utf8'
  );

  // These carried user-supplied content to the trace backend. Reintroducing any
  // of them ships document names, prompts or search queries to a third party.
  it.each(['tool.file_name', 'tool.prompt', 'tool.grep_pattern', 'tool.query'])(
    'does not record %s',
    (attribute) => {
      expect(source).not.toContain(`'${attribute}'`);
    }
  );
});

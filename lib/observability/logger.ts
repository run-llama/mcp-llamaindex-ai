import { Logger } from 'tslog';

const logger = new Logger();

export function getLogger() {
  return logger;
}

// Keeps head and tail, so it is only safe for opaque IDs. On free text short
// enough that head + tail overlap, the original is recoverable.
export function redactFileId(fileId: string) {
  return fileId.slice(0, 8) + '*'.repeat(16) + fileId.slice(-12);
}

// Allowlisted rather than parsed: "acme.merger" and "Q3.plan draft" have a
// trailing segment that looks like an extension but is part of the name, so
// echoing whatever follows the last dot would leak the very thing this avoids.
const KNOWN_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'md',
  'markdown',
  'epub',
  'pages',
  'ppt',
  'pptx',
  'odp',
  'key',
  'xls',
  'xlsx',
  'xlsm',
  'ods',
  'csv',
  'tsv',
  'numbers',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'webp',
  'svg',
  'heic',
  'html',
  'htm',
  'xml',
  'json',
  'yaml',
  'yml',
  'eml',
  'msg',
  'zip',
]);

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return 'none';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? ext : 'other';
}

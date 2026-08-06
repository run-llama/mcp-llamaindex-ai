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

const MAX_EXTENSION_LENGTH = 16;

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return 'none';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext.length > MAX_EXTENSION_LENGTH ? 'other' : ext;
}

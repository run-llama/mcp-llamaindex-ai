import { Logger } from 'tslog';

const logger = new Logger();

export function getLogger() {
  return logger;
}

export function redactFileId(fileId: string) {
  return fileId.slice(0, 8) + '*'.repeat(16) + fileId.slice(-12);
}

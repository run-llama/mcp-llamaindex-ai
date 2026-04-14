import { Mutex } from 'async-mutex';

export class FileUploadCache {
  data: Map<string, [number, string][]>;
  private mu: Mutex;

  constructor() {
    this.data = new Map();
    this.mu = new Mutex();
  }

  async addFileChunk(
    filePath: string,
    chunkIndex: number,
    chunkContent: string
  ): Promise<void> {
    await this.mu.runExclusive(() => {
      if (this.data.has(filePath)) {
        this.data.get(filePath)!.push([chunkIndex, chunkContent]);
      } else {
        this.data.set(filePath, [[chunkIndex, chunkContent]]);
      }
    });
  }

  async getCompleteFile(filePath: string): Promise<string | undefined> {
    return this.mu.runExclusive(() => {
      const chunks = this.data.get(filePath);
      if (!chunks) return undefined;

      return (
        [...chunks]
          .sort((a, b) => a[0] - b[0])
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(([_, content]) => content)
          .join('')
      );
    });
  }

  async free(filePath: string): Promise<void> {
    await this.mu.runExclusive(() => {
      this.data.delete(filePath);
    });
  }

  async verifyChunksNumber(
    filePath: string,
    expected: number
  ): Promise<boolean> {
    return this.mu.runExclusive(() => {
      const chunks = this.data.get(filePath);
      return chunks ? chunks.length >= expected : false;
    });
  }
}

const cache = new FileUploadCache();

export function getFileUploadCache(): FileUploadCache {
  return cache;
}

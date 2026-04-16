import { FileUploadCache } from '@/lib/business/file-upload-cache';

describe('FileUploadCache', () => {
  let fileCache: FileUploadCache;

  beforeEach(() => {
    fileCache = new FileUploadCache(); // Fresh instance per test
  });

  it('Test addFileChunk method', async () => {
    await fileCache.addFileChunk('test.pdf', 1, 'first chunk\n');
    expect(fileCache.data.get('test.pdf')).toStrictEqual([
      [1, 'first chunk\n'],
    ]);
    await fileCache.addFileChunk('test.pdf', 2, 'second chunk');
    expect(fileCache.data.get('test.pdf')).toStrictEqual([
      [1, 'first chunk\n'],
      [2, 'second chunk'],
    ]);
  });

  it('Test verifyChunksNumber method', async () => {
    await fileCache.addFileChunk('test.pdf', 1, 'first chunk\n');
    await fileCache.addFileChunk('test.pdf', 2, 'second chunk');
    const tr = await fileCache.verifyChunksNumber('test.pdf', 2);
    expect(tr).toBe(true);
    const tr1 = await fileCache.verifyChunksNumber('test.pdf', 1);
    expect(tr1).toBe(true); // we check for a number of chunk >= the number of expected chunks (accounting for agent understimations)
    const fls = await fileCache.verifyChunksNumber('test.pdf', 3);
    expect(fls).toBe(false);
    const fls1 = await fileCache.verifyChunksNumber('test-1.pdf', 1); // non-existing file, should be false by default
    expect(fls1).toBe(false);
  });

  it('Test getCompleteFile method', async () => {
    await fileCache.addFileChunk('test.pdf', 1, 'first chunk\n');
    await fileCache.addFileChunk('test.pdf', 2, 'second chunk');
    const content = await fileCache.getCompleteFile('test.pdf');
    expect(content).toBeDefined();
    expect(content).toBe('first chunk\nsecond chunk');
    const cont = await fileCache.getCompleteFile('test-1.pdf'); // non-existent file, should yield undefined
    expect(cont).toBeUndefined();
  });

  it('Test free method', async () => {
    await fileCache.addFileChunk('test.pdf', 1, 'first chunk\n');
    await fileCache.addFileChunk('test.pdf', 2, 'second chunk');
    const content = await fileCache.getCompleteFile('test.pdf');
    expect(content).toBeDefined();
    await fileCache.free('test.pdf');
    const cont = await fileCache.getCompleteFile('test.pdf');
    expect(cont).toBeUndefined();
  });
});

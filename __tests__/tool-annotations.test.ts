import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// The LiteParse tools pull in a WASM module that isn't installed in CI.
// Only registration metadata is under test here, so a stub is enough.
jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

import { registerLlamaParseTools } from '../lib/mcp/tools/tools';

// Tools that only read. The LiteParse-backed tools qualify because they run
// in-process and consume no platform credits; the billable processing tools
// (parseFile, classifyFile, splitFile, extractFile, generateExtractionConfig)
// deliberately do not, since a credit deduction is a real and irreversible
// change even though the parsed output expires after 48 hours.
const READ_ONLY = [
  'getUserProjects',
  'parseWithLiteParse',
  'estimateFileComplexity',
  'listIndexes',
  'findFilesInIndex',
  'readFileFromIndex',
  'grepFileFromIndex',
  'retrieveFromIndex',
  'listDirectories',
  'listDirectory',
  'getIndexStatus',
];

// Tools with a side effect: they either persist data or bill the account.
// None of them delete anything, so all are additive (destructiveHint: false).
const WRITES = [
  'getUploadUrl',
  'uploadFileByUrl',
  'parseFile',
  'classifyFile',
  'splitFile',
  'generateExtractionConfig',
  'extractFile',
  'createDirectory',
  'addFilesToDirectory',
  'createIndex',
  'syncIndex',
];

async function listTools() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerLlamaParseTools(server);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe('tool annotations', () => {
  // The Connectors Directory submission portal rejects tools missing a title
  // or a read-only/destructive hint, so these are a submission gate, not
  // cosmetics.
  it('every registered tool declares a title and a readOnlyHint', async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(0);

    const missing = tools.filter(
      (t) =>
        !t.annotations?.title ||
        typeof t.annotations?.readOnlyHint !== 'boolean'
    );
    expect(missing.map((t) => t.name)).toEqual([]);
  });

  it('covers every tool exactly once across the read-only and write sets', async () => {
    const tools = await listTools();
    const registered = tools.map((t) => t.name).sort();
    expect(registered).toEqual([...READ_ONLY, ...WRITES].sort());
  });

  it.each(READ_ONLY)('%s is annotated read-only', async (name) => {
    const tool = (await listTools()).find((t) => t.name === name);
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it.each(WRITES)(
    '%s is annotated as a non-destructive write',
    async (name) => {
      const tool = (await listTools()).find((t) => t.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(false);
      expect(tool?.annotations?.destructiveHint).toBe(false);
    }
  );

  it('reaches an external service on every tool', async () => {
    const tools = await listTools();
    const notOpenWorld = tools.filter(
      (t) => t.annotations?.openWorldHint !== true
    );
    expect(notOpenWorld.map((t) => t.name)).toEqual([]);
  });
});

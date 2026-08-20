import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// The aggregate registration pulls in the LiteParse tools' WASM module, which
// isn't installed in CI. Only registration metadata is under test here.
jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

import {
  registerIndexTools,
  registerLlamaParseTools,
} from '../lib/mcp/tools/tools';

// The tool surface served at /index/mcp: read, write, and the upload helpers
// the write flow needs to mint file ids.
const INDEX_TOOLS = [
  'getUserProjects',
  'getUploadUrl',
  'uploadFileByUrl',
  'listIndexes',
  'findFilesInIndex',
  'readFileFromIndex',
  'grepFileFromIndex',
  'retrieveFromIndex',
  'createDirectory',
  'listDirectories',
  'listDirectory',
  'addFilesToDirectory',
  'createIndex',
  'getIndexStatus',
  'syncIndex',
];

// The four tools that take an indexId, back when it could be pinned by route.
const INDEX_SCOPED_TOOLS = [
  'findFilesInIndex',
  'readFileFromIndex',
  'grepFileFromIndex',
  'retrieveFromIndex',
];

async function listTools(register: (server: McpServer) => void) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  register(server);

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

describe('/index/mcp tool surface', () => {
  it('serves exactly the Index tools', async () => {
    const tools = await listTools(registerIndexTools);
    expect(tools.map((t) => t.name).sort()).toEqual([...INDEX_TOOLS].sort());
  });

  it('is a subset of the aggregate /mcp surface', async () => {
    const [scoped, full] = await Promise.all([
      listTools(registerIndexTools),
      listTools(registerLlamaParseTools),
    ]);
    const fullNames = new Set(full.map((t) => t.name));
    const missing = scoped.map((t) => t.name).filter((n) => !fullNames.has(n));
    expect(missing).toEqual([]);
  });

  // Regression: while /index/[indexId]/mcp existed, registering with a pinned
  // id dropped `indexId` from the schema and flipped `projectId` from optional
  // to required — making the scoped endpoint harder to call than the root one,
  // with no listIndexes on it to resolve the project. Both fields are now
  // uniform wherever the tool is served.
  it.each(INDEX_SCOPED_TOOLS)(
    '%s requires indexId and leaves projectId optional',
    async (name) => {
      const tool = (await listTools(registerIndexTools)).find(
        (t) => t.name === name
      );
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(Object.keys(schema.properties ?? {})).toEqual(
        expect.arrayContaining(['indexId', 'projectId'])
      );
      expect(schema.required ?? []).toContain('indexId');
      expect(schema.required ?? []).not.toContain('projectId');
    }
  );
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

const addFiles = jest.fn();
jest.mock('../lib/business/directories', () => ({
  ...jest.requireActual('../lib/business/directories'),
  addFilesToDirectory: (...args: unknown[]) => addFiles(...args),
}));

import { registerLlamaParseTools } from '../lib/mcp/tools/tools';

const AUTH = {
  token: 'llx-test',
  clientId: 'test',
  scopes: [],
  extra: { user: { id: 'user_1' }, claims: {}, credential: 'oauth' },
};

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
};

async function callAddFiles(fileIds: string[]): Promise<ToolResult> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerLlamaParseTools(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  // The handler reads extra.authInfo, which this transport only carries when
  // the sender supplies it.
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message: unknown, options?: object) =>
    send(message as never, { ...options, authInfo: AUTH } as never);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const result = (await client.callTool({
    name: 'addFilesToDirectory',
    arguments: { directoryId: 'dir-1', fileIds },
  })) as ToolResult;
  await client.close();
  return result;
}

beforeEach(() => addFiles.mockReset());

describe('addFilesToDirectory result', () => {
  it('reports a fully refused write as an error', async () => {
    addFiles.mockResolvedValue({
      directoryId: 'dir-1',
      added: [],
      failed: [
        { fileId: 'f1', error: 'not found' },
        { fileId: 'f2', error: 'not found' },
      ],
    });

    const result = await callAddFiles(['f1', 'f2']);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text.split('\n')[0]).toBe(
      'None of the 2 items were added.'
    );
  });

  it('names the refused count on the first line of a partial write', async () => {
    addFiles.mockResolvedValue({
      directoryId: 'dir-1',
      added: [{ fileId: 'f1', directoryFileId: 'd1', displayName: 'a.pdf' }],
      failed: [{ fileId: 'f2', error: 'not found' }],
    });

    const result = await callAddFiles(['f1', 'f2']);

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text.split('\n')[0]).toBe(
      '1 of 2 items were not added.'
    );
  });

  it('leaves a clean write untouched', async () => {
    addFiles.mockResolvedValue({
      directoryId: 'dir-1',
      added: [{ fileId: 'f1', directoryFileId: 'd1', displayName: 'a.pdf' }],
      failed: [],
    });

    const result = await callAddFiles(['f1']);

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).added).toHaveLength(1);
  });
});

/**
 * @jest-environment node
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

const getProjects = jest.fn();
const uploadFile = jest.fn();
jest.mock('../lib/business/llamaparse', () => ({
  ...jest.requireActual('../lib/business/llamaparse'),
  getProjects: (...args: unknown[]) => getProjects(...args),
  uploadFile: (...args: unknown[]) => uploadFile(...args),
}));

const fetchRemoteFile = jest.fn();
jest.mock('../lib/business/remote-fetch', () => ({
  ...jest.requireActual('../lib/business/remote-fetch'),
  fetchRemoteFile: (...args: unknown[]) => fetchRemoteFile(...args),
}));

import { registerLlamaParseTools } from '../lib/mcp/tools/tools';

const AUTH = {
  token: 'llx-test',
  clientId: 'test',
  scopes: [],
  extra: { user: { id: 'user_1' }, claims: {}, credential: 'oauth' },
};

type ToolResult = { isError?: boolean; content: { text: string }[] };

async function callUpload(args: Record<string, unknown>): Promise<ToolResult> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerLlamaParseTools(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message: unknown, options?: object) =>
    send(message as never, { ...options, authInfo: AUTH } as never);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const result = (await client.callTool({
    name: 'uploadFileByUrl',
    arguments: args,
  })) as ToolResult;
  await client.close();
  return result;
}

beforeEach(() => {
  getProjects.mockReset();
  uploadFile.mockReset();
  fetchRemoteFile.mockReset();
});

describe('uploadFileByUrl authorization ordering', () => {
  it('does not fetch when the named project is not the caller’s', async () => {
    getProjects.mockResolvedValue([{ projectId: 'mine', name: 'a' }]);

    const result = await callUpload({
      url: 'https://example.com/doc.pdf',
      fileName: 'doc.pdf',
      projectId: 'someone-elses',
    });

    expect(result.isError).toBe(true);
    // The point of the change: nothing left the platform.
    expect(fetchRemoteFile).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('fetches once the named project is the caller’s', async () => {
    getProjects.mockResolvedValue([{ projectId: 'mine', name: 'a' }]);
    fetchRemoteFile.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    );
    uploadFile.mockResolvedValue('file-1');

    const result = await callUpload({
      url: 'https://example.com/doc.pdf',
      fileName: 'doc.pdf',
      projectId: 'mine',
    });

    expect(result.isError).toBeFalsy();
    expect(fetchRemoteFile).toHaveBeenCalled();
  });

  it('skips the lookup entirely when no project is named', async () => {
    fetchRemoteFile.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    );
    uploadFile.mockResolvedValue('file-1');

    await callUpload({
      url: 'https://example.com/doc.pdf',
      fileName: 'doc.pdf',
    });

    expect(getProjects).not.toHaveBeenCalled();
    expect(fetchRemoteFile).toHaveBeenCalled();
  });
});

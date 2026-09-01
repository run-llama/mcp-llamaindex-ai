/**
 * @jest-environment node
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

import { registerUploadFileByUrlTool } from '../lib/mcp/tools/tools';

const realFetch = global.fetch;
const mockFetch = jest.fn();

// The tool runs ensureUserAuthenticated first, so a caller has to be present.
async function connect() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerUploadFileByUrlTool(server);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) =>
    send(message, {
      ...options,
      authInfo: {
        token: 'test-token',
        clientId: 'test-client',
        scopes: [],
        extra: {
          user: { id: 'test-user' },
          claims: {},
          rateLimit: undefined,
        },
      },
    });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: { text: string }[] }).content;
  return content.map((c) => c.text).join('\n');
}

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('uploadFileByUrl', () => {
  it('does not return the upstream body when the download fails', async () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE internal-only contents';
    mockFetch.mockResolvedValue(new Response(secret, { status: 403 }));
    const client = await connect();

    const result = await client.callTool({
      name: 'uploadFileByUrl',
      arguments: { url: 'https://example.com/doc.pdf', fileName: 'doc.pdf' },
    });

    // The server fetched this from a URL the caller chose. Handing the body
    // back would give the caller whatever the server could reach.
    const text = textOf(result);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('AKIA');
    // The status is what actually diagnoses a failed download, and is kept.
    expect(text).toContain('403');
  });

  it.each([
    ['file:///etc/passwd'],
    ['gopher://internal/'],
    ['data:text/plain;base64,aGk='],
    ['not a url at all'],
  ])('refuses %s without fetching it', async (url) => {
    const client = await connect();

    const result = await client.callTool({
      name: 'uploadFileByUrl',
      arguments: { url, fileName: 'doc.pdf' },
    });

    expect(textOf(result)).toContain('Only http and https');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still downloads an ordinary https URL', async () => {
    mockFetch.mockResolvedValue(new Response('bytes', { status: 200 }));
    const client = await connect();

    await client.callTool({
      name: 'uploadFileByUrl',
      arguments: { url: 'https://example.com/doc.pdf', fileName: 'doc.pdf' },
    });

    // Asserted by argument rather than by count: past this point the tool goes
    // on to upload what it fetched, and that makes calls of its own.
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/doc.pdf', {
      method: 'GET',
    });
  });
});

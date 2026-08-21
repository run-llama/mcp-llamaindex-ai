import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

import {
  registerGetSchemaTemplateTool,
  registerSearchSchemaTemplatesTool,
} from '../lib/mcp/tools/tools';

// The catalog tools are the only ones that answer without touching LlamaCloud,
// so they can be driven end to end in-process. Auth still has to be present:
// every tool runs ensureUserAuthenticated first.
async function connect() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerSearchSchemaTemplatesTool(server);
  registerGetSchemaTemplateTool(server);

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

async function callTool(name: string, args: Record<string, unknown>) {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result;
}

function payload(result: Awaited<ReturnType<typeof callTool>>) {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]!.text);
}

describe('schema template tools', () => {
  it('searchSchemaTemplates returns ranked hits and the category list', async () => {
    const body = payload(
      await callTool('searchSchemaTemplates', { query: 'invoice' })
    );
    expect(body.templates[0].id).toBe('invoice');
    expect(body.templates[0]).not.toHaveProperty('schema');
    expect(body.categories.map((c: { id: string }) => c.id)).toContain(
      'business'
    );
  });

  it('searchSchemaTemplates lists everything when called with no arguments', async () => {
    const body = payload(await callTool('searchSchemaTemplates', {}));
    expect(body.templates).toHaveLength(10); // default limit
  });

  it('searchSchemaTemplates honours the category filter', async () => {
    const body = payload(
      await callTool('searchSchemaTemplates', { category: 'legal', limit: 50 })
    );
    expect(body.templates.map((t: { id: string }) => t.id).sort()).toEqual([
      'contract',
      'nda',
    ]);
  });

  it('getSchemaTemplate returns the full JSON Schema', async () => {
    const body = payload(
      await callTool('getSchemaTemplate', { templateId: 'invoice' })
    );
    expect(body.id).toBe('invoice');
    expect(body.schema.type).toBe('object');
    expect(Object.keys(body.schema.properties).length).toBeGreaterThan(0);
  });

  it('getSchemaTemplate names the valid ids when given a bad one', async () => {
    const result = await callTool('getSchemaTemplate', {
      templateId: 'nope',
    });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]!.text).toContain('invoice');
  });
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

const create = jest.fn().mockResolvedValue({ id: 'cfg-test' });

jest.mock('../lib/business/client', () => ({
  llamaCloudClient: () => ({ configurations: { create } }),
}));

import { registerCreateExtractionConfigFromSchemaTool } from '../lib/mcp/tools/tools';

async function connect() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCreateExtractionConfigFromSchemaTool(server);

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

const SCHEMA = { properties: { total: { type: 'number' } } };

async function call(args: Record<string, unknown>) {
  const client = await connect();
  const result = await client.callTool({
    name: 'createExtractionConfigFromSchema',
    arguments: { dataSchema: SCHEMA, ...args },
  });
  await client.close();
  return result;
}

function text(result: Awaited<ReturnType<typeof call>>) {
  return (result.content as { type: string; text: string }[])[0]!.text;
}

describe('extraction config tier', () => {
  beforeEach(() => create.mockClear());

  it('advertises exactly the four published tiers', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    const schema = tools.find(
      (t) => t.name === 'createExtractionConfigFromSchema'
    )!.inputSchema as unknown as {
      properties: { tier: { enum: string[] } };
    };
    expect([...schema.properties.tier.enum].sort()).toEqual([
      'agentic',
      'agentic_plus',
      'cost_effective',
      'turbo',
    ]);
  });

  it('forwards turbo to LlamaCloud', async () => {
    await call({ tier: 'turbo' });
    expect(create.mock.calls[0][0].parameters.tier).toBe('turbo');
  });

  // Turbo runs per document; the API rejects the other targets. Refusing here
  // keeps the agent from burning a round-trip to learn that.
  it.each(['per_page', 'per_table_row'])(
    'refuses turbo with extractionTarget %s before calling LlamaCloud',
    async (target) => {
      const result = await call({ tier: 'turbo', extractionTarget: target });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('per_doc');
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('allows turbo with per_doc', async () => {
    await call({ tier: 'turbo', extractionTarget: 'per_doc' });
    expect(create.mock.calls[0][0].parameters.extraction_target).toBe(
      'per_doc'
    );
  });

  it('leaves the other tiers free to use any extraction target', async () => {
    await call({ tier: 'agentic_plus', extractionTarget: 'per_table_row' });
    expect(create.mock.calls[0][0].parameters.tier).toBe('agentic_plus');
  });
});

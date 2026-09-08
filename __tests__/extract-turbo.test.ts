import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

const run = jest.fn().mockResolvedValue({
  id: 'job-test',
  status: 'COMPLETED',
  extract_result: { total: 42 },
  metadata: { usage: { num_pages_billed: 2 } },
});

jest.mock('../lib/business/client', () => ({
  llamaCloudClient: () => ({ extract: { run } }),
}));

import { registerExtractFileTurboTool } from '../lib/mcp/tools/tools';
import { getSchemaTemplate } from '../lib/business/schema-templates';

async function connect() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerExtractFileTurboTool(server);

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
    name: 'extractFileTurbo',
    arguments: { fileId: 'file-test', ...args },
  });
  await client.close();
  return result;
}

function text(result: Awaited<ReturnType<typeof call>>) {
  return (result.content as { type: string; text: string }[])[0]!.text;
}

describe('extractFileTurbo', () => {
  beforeEach(() => run.mockClear());

  it('runs an inline turbo configuration and returns data, job id and pages billed', async () => {
    const result = await call({ dataSchema: SCHEMA });

    const params = run.mock.calls[0][0];
    expect(params.file_input).toBe('file-test');
    expect(params.configuration.tier).toBe('turbo');
    expect(params.configuration.data_schema).toEqual(SCHEMA);
    expect(params.configuration_id).toBeUndefined();

    expect(JSON.parse(text(result))).toEqual({
      data: { total: 42 },
      jobId: 'job-test',
      pagesBilled: 2,
    });
  });

  it('resolves a templateId to its vendored schema', async () => {
    const template = getSchemaTemplate('invoice')!;
    await call({ templateId: 'invoice' });

    expect(run.mock.calls[0][0].configuration.data_schema).toEqual(
      template.schema
    );
  });

  it('forwards maxPages into the inline configuration', async () => {
    await call({ dataSchema: SCHEMA, maxPages: 3 });
    expect(run.mock.calls[0][0].configuration.max_pages).toBe(3);
  });

  it('omits max_pages when maxPages is not given', async () => {
    await call({ dataSchema: SCHEMA });
    expect('max_pages' in run.mock.calls[0][0].configuration).toBe(false);
  });

  it('refuses a call with neither templateId nor dataSchema', async () => {
    const result = await call({});

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('templateId or dataSchema');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a call with both templateId and dataSchema', async () => {
    const result = await call({ templateId: 'invoice', dataSchema: SCHEMA });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('only one of');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses an unknown templateId before calling LlamaCloud', async () => {
    const result = await call({ templateId: 'not-a-template' });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not-a-template');
    expect(run).not.toHaveBeenCalled();
  });

  // Per-doc turbo can still return an array of one from the API; the tool
  // hands back the object either way.
  it('unwraps a single-element array result', async () => {
    run.mockResolvedValueOnce({
      id: 'job-test',
      status: 'COMPLETED',
      extract_result: [{ total: 7 }],
      metadata: null,
    });
    const result = await call({ dataSchema: SCHEMA });

    expect(JSON.parse(text(result))).toEqual({
      data: { total: 7 },
      jobId: 'job-test',
      pagesBilled: null,
    });
  });

  it('surfaces a job failure as a tool error', async () => {
    run.mockRejectedValueOnce(
      new Error('Job job-test failed with status: FAILED | Error: bad input')
    );
    const result = await call({ dataSchema: SCHEMA });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('FAILED');
  });
});

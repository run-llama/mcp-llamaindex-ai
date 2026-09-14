/** @jest-environment node */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

const create = jest.fn();
jest.mock('../lib/business/admin-client', () => ({
  llamaCloudAdminClient: () => ({ apiKeys: { create } }),
}));

import { registerCreateProjectApiKeyTool } from '../lib/mcp/tools/tools';

async function connect() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCreateProjectApiKeyTool(server);

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
        extra: { user: { id: 'test-user' }, claims: {}, rateLimit: undefined },
      },
    });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function payload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    id: 'ak-1',
    name: 'deploy key',
    project_id: 'proj-a',
    redacted_api_key: 'llx-thisisthelivesecret',
    expires_at: '2026-12-01T00:00:00Z',
  });
});

it('scopes the key to the project it was given', async () => {
  const client = await connect();
  const result = (await client.callTool({
    name: 'createProjectApiKey',
    arguments: { projectId: 'proj-a', name: 'deploy key' },
  })) as { content: Array<{ text: string }> };

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ project_id: 'proj-a', key_type: 'user' })
  );
  expect(payload(result).projectId).toBe('proj-a');
});

it('returns the secret, since the API shows it exactly once', async () => {
  const client = await connect();
  const result = (await client.callTool({
    name: 'createProjectApiKey',
    arguments: { projectId: 'proj-a' },
  })) as { content: Array<{ text: string }> };
  expect(payload(result).secret).toBe('llx-thisisthelivesecret');
});

it('always sets an expiry, defaulting to the maximum', async () => {
  const client = await connect();
  await client.callTool({
    name: 'createProjectApiKey',
    arguments: { projectId: 'proj-a' },
  });
  const sent = create.mock.calls[0][0].expires_at as string;
  const days = (Date.parse(sent) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(89);
  expect(days).toBeLessThanOrEqual(90);
});

// The schema rejects these before the handler runs, so the call rejects rather
// than resolving with isError.
it('refuses an expiry beyond the cap rather than minting a longer-lived key', async () => {
  const client = await connect();
  await expect(
    client.callTool({
      name: 'createProjectApiKey',
      arguments: { projectId: 'proj-a', expiryDays: 365 },
    })
  ).rejects.toThrow(/expiryDays|less than or equal to 90/);
  expect(create).not.toHaveBeenCalled();
});

it('cannot be called without a project', async () => {
  const client = await connect();
  await expect(
    client.callTool({ name: 'createProjectApiKey', arguments: {} })
  ).rejects.toThrow(/projectId/);
  expect(create).not.toHaveBeenCalled();
});

// The schema above is the only thing enforcing the cap on the tool path, so the
// business guard would otherwise never be exercised.
it('caps expiry in the business layer too, independently of the tool schema', async () => {
  const { createProjectApiKey, MAX_EXPIRY_DAYS } =
    await import('../lib/business/api-keys');
  await expect(
    createProjectApiKey({
      authToken: 't',
      projectId: 'proj-a',
      expiryDays: MAX_EXPIRY_DAYS + 1,
    })
  ).rejects.toThrow(/at most 90/);
  await expect(
    createProjectApiKey({ authToken: 't', projectId: 'proj-a', expiryDays: 0 })
  ).rejects.toThrow(/at least 1/);
  expect(create).not.toHaveBeenCalled();
});

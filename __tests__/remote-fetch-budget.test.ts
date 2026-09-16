/**
 * @jest-environment node
 */

// A real socket, not a mocked fetch: whether the request signal also aborts a
// stalled body read is undici behaviour a mock cannot reproduce.
export {};

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { fetchRemoteFile } from '../lib/business/remote-fetch';

const BUDGET_MS = 700;

let server: Server;
let port: number;
const optInBeforeThisFile = process.env.ALLOW_PRIVATE_UPLOAD_HOSTS;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_UPLOAD_HOSTS = 'true';
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.write('partial');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

// Jest reuses worker processes across files, so leaving the opt-in set would
// quietly let a sibling file's blocked-host cases through.
afterAll(async () => {
  if (optInBeforeThisFile === undefined) {
    delete process.env.ALLOW_PRIVATE_UPLOAD_HOSTS;
  } else {
    process.env.ALLOW_PRIVATE_UPLOAD_HOSTS = optInBeforeThisFile;
  }
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

it('ends a stalled body read on the request budget', async () => {
  const started = Date.now();
  const response = await fetchRemoteFile(
    `http://127.0.0.1:${port}/doc.pdf`,
    BUDGET_MS
  );

  expect(response.status).toBe(200);
  await expect(response.arrayBuffer()).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(BUDGET_MS * 4);
}, 15000);

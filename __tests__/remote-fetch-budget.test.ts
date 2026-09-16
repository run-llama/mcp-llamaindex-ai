/**
 * @jest-environment node
 */

// Real sockets, not a mocked fetch: whether a deadline reaches the body stream
// is runtime behaviour a mock cannot reproduce.
export {};

import { createServer, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { fetchRemoteFile } from '../lib/business/remote-fetch';

const HEADERS_MS = 400;
const IDLE_MS = 400;

let server: Server;
let port: number;
const optInBeforeThisFile = process.env.ALLOW_PRIVATE_UPLOAD_HOSTS;
const open = new Set<ServerResponse>();

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_UPLOAD_HOSTS = 'true';
  server = createServer((req, res) => {
    open.add(res);
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    if (req.url === '/stalls') {
      res.write('partial');
      return;
    }
    // Slower overall than the headers deadline, but never idle for long.
    let sent = 0;
    const tick = setInterval(() => {
      if (sent++ >= 8) {
        clearInterval(tick);
        res.end();
        return;
      }
      res.write('chunk');
    }, HEADERS_MS / 4);
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
  open.forEach((res) => res.destroy());
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

it('ends a body that stops arriving', async () => {
  const started = Date.now();
  const response = await fetchRemoteFile(
    `http://127.0.0.1:${port}/stalls`,
    HEADERS_MS,
    IDLE_MS
  );

  expect(response.status).toBe(200);
  await expect(response.arrayBuffer()).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(IDLE_MS * 5);
}, 15000);

// The reason the deadline is not one clock over the whole call: this transfer
// runs well past the headers budget and must not be cut.
it('lets a slow but progressing download finish', async () => {
  const started = Date.now();
  const response = await fetchRemoteFile(
    `http://127.0.0.1:${port}/slow`,
    HEADERS_MS,
    IDLE_MS
  );
  const body = await response.arrayBuffer();
  const elapsed = Date.now() - started;

  expect(body.byteLength).toBe(8 * 'chunk'.length);
  expect(elapsed).toBeGreaterThan(HEADERS_MS);
}, 15000);

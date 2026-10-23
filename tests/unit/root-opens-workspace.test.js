const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

let dir;
let server;
let root;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'root-entry-')));
  await fs.writeFile(path.join(dir, 'A.html'), '<html><body>A</body></html>');
  root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  jest.restoreAllMocks();
});

test('GET / hands the browser to the workspace when an entry is available', async () => {
  server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null,
    workspaceEntry: async () => 'http://127.0.0.1:9/enter?ticket=abc' }));
  const res = await request(server).get('/');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://127.0.0.1:9/enter?ticket=abc');
  expect(res.headers['cache-control']).toBe('no-store');
});

test('GET / falls back to the directory listing when no entry is available', async () => {
  server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null,
    workspaceEntry: async () => null }));
  const res = await request(server).get('/');
  expect(res.status).toBe(200);
  expect(res.text).toContain('href="/A.html"');
});

test('only a top-level GET opens the workspace; HEAD and framed loads get the listing', async () => {
  const workspaceEntry = jest.fn(async () => 'http://localhost:9/enter?ticket=abc');
  server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null, workspaceEntry }));
  expect((await request(server).head('/')).status).toBe(200);
  const framed = await request(server).get('/').set('Sec-Fetch-Dest', 'iframe');
  expect(framed.status).toBe(200);
  expect(framed.text).toContain('href="/A.html"');
  expect(workspaceEntry).not.toHaveBeenCalled();
  expect((await request(server).get('/').set('Sec-Fetch-Dest', 'document')).status).toBe(302);
});

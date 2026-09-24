// C5.3: the SharedWorker script of spec §10 and the `sync-worker` extension that
// announces it. Ports of htmlclay's sync_worker_test.go by name.

const { spawnSync } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKER = path.join(REPO_ROOT, 'src', 'main', 'assets', 'sync-worker.js');
const HARNESS = path.join(REPO_ROOT, 'tests', 'fixtures', 'sync-worker', 'harness.mjs');

let dir;
let server;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sync-worker-')));
  await fs.writeFile(path.join(dir, 'index.html'), '<!DOCTYPE html>\n<html><body>hi</body></html>');
  server = await listenLoopback(createApp(dir));
});

afterEach(async () => {
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('C5.3: the shared sync worker', () => {
  test('TestSyncWorkerIsServed', async () => {
    const res = await request(server).get('/_/sync/worker.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-cache');
    for (const marker of ['/_/sync?', '"subscribe"', '"gone"', 'v: 1']) {
      expect(res.text).toContain(marker);
    }
  });

  test('a bare /sync/worker.js (no marker) falls through to the static handler', async () => {
    await fs.mkdir(path.join(dir, 'sync'));
    await fs.writeFile(path.join(dir, 'sync', 'worker.js'), '/* the user folder own file */\n');

    const res = await request(server).get('/sync/worker.js');

    expect(res.status).toBe(200);
    expect(res.text).toBe('/* the user folder own file */\n');
  });

  test('TestSyncWorkerScript: the worker passes the htmlclay harness', () => {
    const run = spawnSync(process.execPath, [HARNESS, WORKER], { encoding: 'utf8' });

    expect(`${run.status}\n${run.stderr}`).toBe('0\n');
    expect(run.stdout).toContain('sync-worker harness: ok');
  }, 20000);

  test('/_/meta announces sync-worker', async () => {
    const res = await request(server).get('/_/meta');

    expect(res.status).toBe(200);
    expect(res.body.extensions).toContain('sync');
    expect(res.body.extensions).toContain('sync-worker');
    // clayjs only takes the worker when `presence` is absent (spec §10).
    expect(res.body.extensions).not.toContain('presence');
  });
});

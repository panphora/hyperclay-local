// A1: derived-file generation must happen inside the write queue, in the same
// critical section as the write that causes it.
//
// The race these pin: a cache-miss GET starts compiling H0, a concurrent /save
// publishes H1 and its H1-derived artifact inside the queue, then the GET
// finishes and overwrites the newer artifact with H0-derived output. For a
// sidecar the fresh mtime then makes the stale data read as current forever.
//
// And the mirror of it: the two REMOTE writers serialize and atomically publish
// the HTML but used to end their critical section without refreshing anything
// derived, so a remote H1 left an H0 sidecar and an H0 stylesheet serving.

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

// The real extractor reaches hyper-html-api through a dynamic ESM import, which
// needs --experimental-vm-modules. Every other suite stubs it; this one only
// needs "did the api rules tag survive into the sidecar", so read the tag body.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  parseExtractionRules: jest.fn(),
  extractViaTag: jest.fn(async (html) => {
    const match = /data-rules-name="api">([\s\S]*?)<\/script>/.exec(html || '');
    return match ? JSON.parse(match[1]) : null;
  })
}));

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    notify: jest.fn(),
    broadcast: jest.fn(),
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastFileSaved: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn().mockResolvedValue(undefined),
  getGuardEvent: jest.fn().mockResolvedValue(null),
  resolveGuard: jest.fn(),
  provenanceForLocalSave: jest.fn(() => 'ui-gestured')
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackup: jest.fn().mockResolvedValue(null),
  createBackupIfExists: jest.fn().mockResolvedValue(null),
  createBinaryBackupIfExists: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { serveSiteApiLocal } = require('../../src/main/utils/data-api');
const { withFileLock } = require('../../src/main/utils/write-queue');
const { getConsentRegistry, resolveWritePath } = require('../../src/main/utils/path-resolver');

const HOST = '127.0.0.1';
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup(dir) {
  await settle(50);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('A1: the lazy Tailwind GET compiles inside the source file queue slot', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tw-queue-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(
      path.join(dir, 'page.html'),
      '<html><head><link href="https://hyperclay.com/tailwindcss/page.css"></head><body class="p-4">hi</body></html>'
    );
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('a cache-miss compile waits for, and does not clobber, a concurrent publish', async () => {
    const registry = getConsentRegistry(dir);
    const htmlPath = await resolveWritePath(registry, 'page.html');
    const cssPath = path.join(dir, 'tailwindcss', 'page.css');

    // Stand in for a /save: hold the source file's queue slot, publish a fresh
    // stylesheet inside it, then release. This is exactly the ordering the race
    // needs — the GET starts first and finishes last.
    let release;
    const held = withFileLock(htmlPath, async () => {
      await new Promise((r) => { release = r; });
      await fs.mkdir(path.dirname(cssPath), { recursive: true });
      await fs.writeFile(cssPath, '/* published by the concurrent save */');
    });

    // No stylesheet on disk yet, so this is a genuine cache miss. The `.then`
    // matters: a supertest request is lazy and does not leave the gate until
    // something subscribes to it, so without this the GET would not even start
    // until after the lock was released.
    const pending = request(app).get('/tailwindcss/page.css').set('Host', HOST).then((r) => r);

    await settle(100);
    release();
    await held;

    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.text).toBe('/* published by the concurrent save */');
    expect(await fs.readFile(cssPath, 'utf8')).toBe('/* published by the concurrent save */');
  });

  test('an uncontended cache miss still generates and serves the stylesheet', async () => {
    const response = await request(app).get('/tailwindcss/page.css').set('Host', HOST);

    expect(response.status).toBe(200);
    expect(response.text).toContain('.p-4');
    const onDisk = await fs.readFile(path.join(dir, 'tailwindcss', 'page.css'), 'utf8');
    expect(onDisk).toContain('.p-4');
  });
});

describe('A1: the data API refreshes its sidecar inside the source file queue slot', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'api-queue-')));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('a cache-miss extraction does not run while a save holds the slot', async () => {
    const sourcePath = path.join(dir, 'index.html');
    await fs.writeFile(sourcePath, '<html><body>no api tag</body></html>');

    let release;
    const held = withFileLock(sourcePath, async () => {
      await new Promise((r) => { release = r; });
    });

    let served = false;
    const pending = serveSiteApiLocal(dir, 'index.html', { sourcePath })
      .then((result) => { served = true; return result; });

    await settle(100);
    // Unqueued, the read-extract-refresh region has already run to completion
    // against a file the "save" still holds.
    expect(served).toBe(false);

    release();
    await held;
    await pending;

    expect(served).toBe(true);
  });
});

describe('A1: the remote writers refresh derived artifacts inside their critical section', () => {
  let dir;
  let engine;
  let apiClient;

  const HTML_H1 = '<html><head><script type="text/plain" data-rules-name="api">{"title":"h1"}</script></head><body><h1>H1</h1></body></html>';

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'remote-derived-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    jest.isolateModules(() => {
      engine = require('../../src/sync-engine/index');
      apiClient = require('../../src/sync-engine/api-client');
    });

    engine.syncFolder = dir;
    engine.serverUrl = 'http://test';
    engine.apiKey = 'test-key';
    engine.deviceId = 'test-device';
    engine.isRunning = true;
    engine.repo.seed([]);
    engine.repo.set = jest.fn().mockResolvedValue(undefined);
    engine.emit = jest.fn();
    engine.logger = null;
    engine.stats = { filesDownloaded: 0, errors: [] };
    engine.echoWindow = { mark: jest.fn(), has: jest.fn(() => false) };

    require('../../src/sync-engine/node-map').getInode = jest.fn().mockResolvedValue(null);
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  // The stale H0 sidecar the remote write must replace. Its mtime is set into
  // the FUTURE on purpose: the sync writers stamp the remote modifiedAt onto the
  // HTML, so an unrefreshed H0 sidecar outranks H1 by mtime and readFreshSidecar
  // reports it current forever. Only an actual refresh clears this.
  async function plantStaleSidecar(name) {
    const sidecar = path.join(dir, '.hyperclay/api', name.replace(/\.html$/, '') + '.json');
    await fs.mkdir(path.dirname(sidecar), { recursive: true });
    await fs.writeFile(sidecar, '{"title":"h0"}');
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await fs.utimes(sidecar, future, future);
    return sidecar;
  }

  test('the SSE apply refreshes the sidecar', async () => {
    const sidecar = await plantStaleSidecar('page.html');
    await fs.writeFile(path.join(dir, 'page.html'), '<html><body>H0</body></html>');

    await engine._applyNodeSavedSite({
      nodeId: 1,
      nodeType: 'site',
      path: 'page.html',
      content: HTML_H1,
      checksum: 'remote-checksum',
      modifiedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });

    expect(await fs.readFile(path.join(dir, 'page.html'), 'utf8')).toBe(HTML_H1);
    expect(JSON.parse(await fs.readFile(sidecar, 'utf8'))).toEqual({ title: 'h1' });
  });

  test('the sync download refreshes the sidecar', async () => {
    const sidecar = await plantStaleSidecar('page.html');
    await fs.writeFile(path.join(dir, 'page.html'), '<html><body>H0</body></html>');

    apiClient.getNodeContent.mockResolvedValue({
      content: HTML_H1,
      modifiedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });

    await engine.downloadFile(1, 'page.html');

    expect(await fs.readFile(path.join(dir, 'page.html'), 'utf8')).toBe(HTML_H1);
    expect(JSON.parse(await fs.readFile(sidecar, 'utf8'))).toEqual({ title: 'h1' });
  });
});

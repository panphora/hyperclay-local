/**
 * A page's merge state crosses devices beside its content, never in it.
 *
 * On an upload the record reaches the server before the bytes do; on a download
 * it lands in the sidecar before the file is written, and a legacy copy that
 * still carries its own tag leaves the clean file on disk. A record the server
 * cannot answer (404, or no answer at all) never fails the content sync, and a
 * remote rename takes the sidecar with it.
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('eventsource', () => ({
  EventSource: jest.fn()
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

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn(async () => ({}))
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn(async () => ({}))
}));

// Every page write and every sidecar write publishes through atomicWriteFile, so
// the order of its calls is the order the two land on disk.
jest.mock('../../src/main/utils/write-queue', () => {
  const actual = jest.requireActual('../../src/main/utils/write-queue');
  return {
    ...actual,
    atomicWriteFile: jest.fn((filePath, content, encoding, beforeRename) =>
      actual.atomicWriteFile(filePath, content, encoding, beforeRename))
  };
});

jest.mock('../../src/sync-engine/api-client');

const fsSync = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const nodePath = require('path');
const upath = require('upath');
const { splitPage } = require('@panphora/clayjs/server/rooms');

const apiClient = require('../../src/sync-engine/api-client');
const { SyncEngine } = require('../../src/sync-engine/index');
const { executeDecision } = require('../../src/sync-engine/reconcile/execute');
const writeQueue = require('../../src/main/utils/write-queue');
const {
  storePageState, readPageState, writePageState, pageStatePath
} = require('../../src/main/page-state-store');
const { sendPageState } = require('../../src/sync-engine/page-state');

const TEMPLATE = fsSync.readFileSync(nodePath.join(__dirname, '../../src/main/document-templates/page.html'), 'utf8');
const { state: TEMPLATE_STATE } = splitPage(TEMPLATE);
const TAG = 'merge="page"';

let root;
let engine;

const full = (rel) => nodePath.join(root, rel);
const onDisk = (rel) => fsSync.readFileSync(full(rel), 'utf8');
const writesOf = () => writeQueue.atomicWriteFile.mock.calls.map(([filePath]) => filePath);
const indexOfWrite = (filePath) => writesOf().indexOf(filePath);

// A page document as this device stores it: the clean file, its state in the sidecar.
async function writePage(rel) {
  await fsp.mkdir(nodePath.dirname(full(rel)), { recursive: true });
  await fsp.writeFile(full(rel), await storePageState(root, rel, TEMPLATE));
}

beforeEach(async () => {
  jest.clearAllMocks();

  root = await fsp.realpath(await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'page-state-sync-')));
  const metaDir = nodePath.join(root, '.meta');
  await fsp.mkdir(metaDir);

  engine = new SyncEngine();
  engine.syncFolder = root;
  engine.metaDir = metaDir;
  engine.serverUrl = 'http://test';
  engine.apiKey = 'test-key';
  engine.deviceId = 'test-device';
  engine.isRunning = true;
  engine.repo.seed([]);

  apiClient.listNodes.mockResolvedValue(Object.assign([], { complete: true }));
  apiClient.getPageState.mockResolvedValue(null);
  apiClient.putPageState.mockResolvedValue(true);
});

afterEach(async () => {
  engine.syncQueue.clear();
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe('an upload sends the page state before the content', () => {
  test('the legacy uploader records the sidecar, then the bytes', async () => {
    await writePage('page.html');
    engine.repo.seed([['7', { type: 'site', path: 'page.html', checksum: null }]]);
    apiClient.putNodeContent.mockResolvedValue({ nodeId: 7, checksum: 'cs-7' });

    await engine.uploadFile('page.html');

    expect(apiClient.putPageState).toHaveBeenCalledWith(expect.anything(), 7, TEMPLATE_STATE);
    expect(apiClient.putPageState.mock.invocationCallOrder[0])
      .toBeLessThan(apiClient.putNodeContent.mock.invocationCallOrder[0]);
    expect(apiClient.putNodeContent).toHaveBeenCalledTimes(1);
  });

  test('a new node records the sidecar right after its create', async () => {
    await writePage('page.html');
    apiClient.createNode.mockResolvedValue({ id: 91, etag: 'cs-91' });

    await engine.uploadFile('page.html');

    expect(apiClient.createNode).toHaveBeenCalledTimes(1);
    expect(apiClient.putPageState).toHaveBeenCalledWith(expect.anything(), 91, TEMPLATE_STATE);
    expect(apiClient.createNode.mock.invocationCallOrder[0])
      .toBeLessThan(apiClient.putPageState.mock.invocationCallOrder[0]);
  });

  test('the reconcile upload records the sidecar, then the bytes', async () => {
    await writePage('page.html');
    engine.repo.seed([['7', { type: 'site', path: 'page.html', remoteEtag: 'old', localChecksum: 'old' }]]);
    apiClient.putNodeContent.mockResolvedValue({ nodeId: 7, checksum: 'cs-7', etag: 'cs-7' });

    await executeDecision(engine, '7', { action: 'upload' }, { path: 'page.html', type: 'site' });

    expect(apiClient.putPageState).toHaveBeenCalledWith(expect.anything(), 7, TEMPLATE_STATE);
    expect(apiClient.putPageState.mock.invocationCallOrder[0])
      .toBeLessThan(apiClient.putNodeContent.mock.invocationCallOrder[0]);
  });

  // A write whose file never landed leaves a newer record in the sidecar; the file is still its own page.
  test('the record sent is the one for the file on disk, not a newer one that never landed', async () => {
    await writePage('page.html');
    await writePageState(root, 'page.html', { rev: 'never-landed', tag: TEMPLATE_STATE.tag });

    expect(await sendPageState(engine, 7, 'page.html')).toBe(true);

    expect(apiClient.putPageState).toHaveBeenCalledWith(expect.anything(), 7, TEMPLATE_STATE);
  });

  test('a document that is not a page sends no record', async () => {
    await fsp.writeFile(full('plain.html'), '<html><body>plain</body></html>');
    engine.repo.seed([['7', { type: 'site', path: 'plain.html', checksum: null }]]);
    apiClient.putNodeContent.mockResolvedValue({ nodeId: 7, checksum: 'cs-7' });

    await engine.uploadFile('plain.html');

    expect(apiClient.putNodeContent).toHaveBeenCalledTimes(1);
    expect(apiClient.putPageState).not.toHaveBeenCalled();
  });
});

describe('a download writes the page state before the file', () => {
  const serverContent = () => ({
    content: TEMPLATE,
    nodeType: 'site',
    modifiedAt: '2026-04-08T12:00:00Z',
    checksum: 'cs-server'
  });

  test('the legacy downloader stores the clean file and the server record', async () => {
    apiClient.getNodeContent.mockResolvedValue(serverContent());
    apiClient.getPageState.mockResolvedValue(TEMPLATE_STATE);

    await engine.downloadFile(13, 'page.html');

    expect(apiClient.getPageState).toHaveBeenCalledWith(expect.anything(), 13);
    expect(indexOfWrite(pageStatePath(root, 'page.html'))).toBeGreaterThanOrEqual(0);
    expect(indexOfWrite(pageStatePath(root, 'page.html'))).toBeLessThan(indexOfWrite(full('page.html')));
    expect(onDisk('page.html')).not.toContain(TAG);
    expect(await readPageState(root, 'page.html')).toEqual(TEMPLATE_STATE);
  });

  test('the reconcile download stores the clean file and the server record', async () => {
    apiClient.getNodeContent.mockResolvedValue({ ...serverContent(), etag: 'cs-server' });
    apiClient.getPageState.mockResolvedValue(TEMPLATE_STATE);

    await executeDecision(engine, '13', { action: 'download' }, { path: 'page.html', type: 'site' });

    expect(indexOfWrite(pageStatePath(root, 'page.html'))).toBeGreaterThanOrEqual(0);
    expect(indexOfWrite(pageStatePath(root, 'page.html'))).toBeLessThan(indexOfWrite(full('page.html')));
    expect(onDisk('page.html')).not.toContain(TAG);
    expect(await readPageState(root, 'page.html')).toEqual(TEMPLATE_STATE);
  });

  test('an SSE node-saved stores the clean file and the server record', async () => {
    apiClient.getPageState.mockResolvedValue(TEMPLATE_STATE);

    await engine.handleNodeSaved({
      nodeId: 13,
      nodeType: 'site',
      name: 'page.html',
      path: 'page.html',
      content: TEMPLATE,
      checksum: 'cs-server',
      modifiedAt: '2026-04-08T12:00:00Z'
    });

    expect(indexOfWrite(pageStatePath(root, 'page.html'))).toBeGreaterThanOrEqual(0);
    expect(indexOfWrite(pageStatePath(root, 'page.html'))).toBeLessThan(indexOfWrite(full('page.html')));
    expect(onDisk('page.html')).not.toContain(TAG);
    expect(await readPageState(root, 'page.html')).toEqual(TEMPLATE_STATE);
  });

  test('a legacy download whose content carries the tag keeps that state in the sidecar', async () => {
    apiClient.getNodeContent.mockResolvedValue(serverContent());

    await engine.downloadFile(13, 'page.html');

    expect(onDisk('page.html')).not.toContain(TAG);
    expect(await readPageState(root, 'page.html')).toEqual(TEMPLATE_STATE);
  });

  test('a server with no record leaves the file and no sidecar behind', async () => {
    apiClient.getNodeContent.mockResolvedValue({ ...serverContent(), content: '<html><body>plain</body></html>' });

    await engine.downloadFile(13, 'plain.html');

    expect(onDisk('plain.html')).toBe('<html><body>plain</body></html>');
    expect(await readPageState(root, 'plain.html')).toBeNull();
  });
});

describe('a record the server cannot answer never fails the download', () => {
  const notFound = () => Object.assign(new Error('Not found'), { statusCode: 404 });

  const PLAIN = '<html><body><p>plain</p></body></html>';

  test('a 404 still writes the file and no sidecar', async () => {
    apiClient.getNodeContent.mockResolvedValue({
      content: PLAIN, nodeType: 'site', modifiedAt: '2026-04-08T12:00:00Z', checksum: 'cs-server'
    });
    apiClient.getPageState.mockRejectedValue(notFound());

    await engine.downloadFile(13, 'page.html');

    expect(onDisk('page.html')).toBe(PLAIN);
    expect(await readPageState(root, 'page.html')).toBeNull();
  });

  test('a network failure still writes the file and no sidecar', async () => {
    apiClient.getNodeContent.mockResolvedValue({
      content: PLAIN, nodeType: 'site', modifiedAt: '2026-04-08T12:00:00Z', checksum: 'cs-server'
    });
    apiClient.getPageState.mockRejectedValue(new TypeError('fetch failed'));

    await engine.downloadFile(13, 'page.html');

    expect(onDisk('page.html')).toBe(PLAIN);
    expect(await readPageState(root, 'page.html')).toBeNull();
  });

  test('a record call that never answers is abandoned, not waited on', async () => {
    const real = jest.requireActual('../../src/sync-engine/api-client');
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
    }));
    try {
      const pending = real.getPageState({ serverUrl: 'http://test', apiKey: 'k' }, 1);
      await Promise.resolve();
      jest.advanceTimersByTime(4000);
      await expect(pending).resolves.toBeNull();
    } finally {
      fetchSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  test('the api client answers null for a 404 and for a dead network', async () => {
    const real = jest.requireActual('../../src/sync-engine/api-client');
    const conn = { serverUrl: 'http://test', apiKey: 'k' };
    const notFoundResponse = () => ({
      ok: false, status: 404,
      clone: () => ({ json: async () => ({ message: 'Node not found' }) }),
      text: async () => 'Node not found',
      headers: { get: () => null }
    });

    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      fetchSpy.mockResolvedValueOnce(notFoundResponse());
      await expect(real.getPageState(conn, 1)).resolves.toBeNull();

      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(real.getPageState(conn, 1)).resolves.toBeNull();

      fetchSpy.mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ success: true, nodeId: 1, record: TEMPLATE_STATE })
      });
      await expect(real.getPageState(conn, 1)).resolves.toEqual(TEMPLATE_STATE);

      fetchSpy.mockResolvedValueOnce(notFoundResponse());
      await expect(real.putPageState(conn, 1, TEMPLATE_STATE)).resolves.toBe(false);

      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(real.putPageState(conn, 1, TEMPLATE_STATE)).resolves.toBe(false);

      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
      await expect(real.putPageState(conn, 1, TEMPLATE_STATE)).resolves.toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('a remote rename takes the page state with it', () => {
  test('a renamed document keeps its merge state at the new path', async () => {
    await writePage('A.html');
    engine.repo.seed([['7', { type: 'site', path: 'A.html', inode: null }]]);

    await engine.handleNodeRenamed({ nodeId: 7, nodeType: 'site', oldPath: 'A.html', newPath: 'B.html' });

    expect(fsSync.existsSync(full('B.html'))).toBe(true);
    expect(await readPageState(root, 'A.html')).toBeNull();
    expect(await readPageState(root, 'B.html')).toEqual(TEMPLATE_STATE);
    expect(onDisk('B.html')).not.toContain(TAG);
  });

  test('a renamed folder keeps its documents’ merge state', async () => {
    await writePage('Notes/A.html');
    engine.repo.seed([
      ['8', { type: 'folder', path: 'Notes', inode: null }],
      ['7', { type: 'site', path: 'Notes/A.html', inode: null }]
    ]);

    await engine.handleNodeRenamed({ nodeId: 8, nodeType: 'folder', oldPath: 'Notes', newPath: 'Archive' });

    expect(await readPageState(root, 'Notes/A.html')).toBeNull();
    expect(await readPageState(root, 'Archive/A.html')).toEqual(TEMPLATE_STATE);
  });
});

describe('a remote delete takes the page state with it', () => {
  test('a deleted document drops its sidecar', async () => {
    await writePage('page.html');
    engine.repo.seed([[7, { type: 'site', path: 'page.html', inode: null }]]);

    await engine.handleNodeDeleted({ nodeId: 7, nodeType: 'site', path: 'page.html' });

    expect(fsSync.existsSync(full('.trash/page.html'))).toBe(true);
    expect(await readPageState(root, 'page.html')).toBeNull();
  });

  test('a deleted folder drops its documents\u2019 sidecars', async () => {
    await writePage('Notes/A.html');
    engine.repo.seed([
      [8, { type: 'folder', path: 'Notes', inode: null }],
      [7, { type: 'site', path: 'Notes/A.html', inode: null }]
    ]);

    await engine.handleNodeDeleted({ nodeId: 8, nodeType: 'folder', path: 'Notes' });

    expect(fsSync.existsSync(full('.trash/Notes/A.html'))).toBe(true);
    expect(await readPageState(root, 'Notes/A.html')).toBeNull();
  });
});

describe('an upload sends a record only for the file it was written from', () => {
  test('a sidecar whose rev does not match the file is not sent', async () => {
    await writePage('page.html');
    await fsp.writeFile(full('page.html'), onDisk('page.html').replace(/data-rev="[^"]*"/, 'data-rev="moved-on"'));

    await expect(sendPageState(engine, 7, 'page.html')).resolves.toBe(false);

    expect(apiClient.putPageState).not.toHaveBeenCalled();
  });

  test('a sidecar whose rev matches the file is sent', async () => {
    await writePage('page.html');

    await expect(sendPageState(engine, 7, 'page.html')).resolves.toBe(true);

    expect(apiClient.putPageState).toHaveBeenCalledWith(expect.anything(), 7, TEMPLATE_STATE);
  });

  test('a document with no sidecar, and one whose file is gone, send nothing', async () => {
    await fsp.writeFile(full('plain.html'), '<html><body>plain</body></html>');
    await writePage('gone.html');
    await fsp.rm(full('gone.html'));

    await expect(sendPageState(engine, 7, 'plain.html')).resolves.toBe(false);
    await expect(sendPageState(engine, 7, 'gone.html')).resolves.toBe(false);

    expect(apiClient.putPageState).not.toHaveBeenCalled();
  });
});

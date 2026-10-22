jest.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false, encryptString: value => value } }));
jest.mock('eventsource', () => ({ EventSource: jest.fn() }));
jest.mock('livesync-hyperclay', () => ({ liveSync: {
  markBrowserSave: jest.fn(), wasBrowserSave: jest.fn(() => false), notify: jest.fn(), broadcast: jest.fn(),
  subscribeUser: jest.fn(), unsubscribeUser: jest.fn(), broadcastFileSaved: jest.fn(), broadcastToUser: jest.fn(),
} }));
jest.mock('../../src/main/utils/backup', () => ({ createBackupIfExists: jest.fn(), createBinaryBackupIfExists: jest.fn() }));
jest.mock('../../src/main/utils/utils', () => ({ getServerBaseUrl: url => url || 'http://localhyperclay.com' }));
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/file-operations', () => jest.requireActual('../../src/sync-engine/file-operations'));
jest.mock('../../src/sync-engine/node-map', () => jest.requireActual('../../src/sync-engine/node-map'));

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { fixture } = require('./workspace-fixture');
const { splitPage } = require('@panphora/clayjs/server/rooms');
const { storePageState, readPageState, logicalDocument } = require('../../src/main/page-state-store');
const api = require('../../src/sync-engine/api-client');
const fsScenario = require('../helpers/fs-scenario');
const { FakeServer, install } = require('../helpers/sync-fake-server');

let h;
let engineMetaDir;
afterEach(async () => {
  if (h) await h.close();
  if (engineMetaDir) await fs.rm(engineMetaDir, { recursive: true, force: true });
  h = null;
  engineMetaDir = null;
});

async function command(request, body) {
  const response = await request('/api/roots/root-a/commands', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('folder, rename, move, duplicate, Trash, restore, and empty Trash change only this root', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html>A</html>');
  const other = await fs.mkdtemp(path.join(h.dir, 'other-root-'));
  await fs.mkdir(path.join(other, '.trash'));
  await fs.writeFile(path.join(other, '.trash', 'keep.html'), 'keep');
  const request = await h.start();
  expect(await command(request, { command: 'folder', parent: null, name: 'Notes' })).toEqual({ status: 200, body: { path: 'Notes' } });
  expect(await command(request, { command: 'rename', path: 'A.html', name: 'B.html' })).toEqual({ status: 200, body: { path: 'B.html' } });
  expect(await command(request, { command: 'move', path: 'B.html', parent: 'Notes' })).toEqual({ status: 200, body: { path: 'Notes/B.html' } });
  expect(await command(request, { command: 'duplicate', path: 'Notes/B.html', name: 'Copy.html' })).toEqual({ status: 200, body: { path: 'Notes/Copy.html' } });
  expect(await fs.readFile(path.join(h.dir, 'Notes/Copy.html'), 'utf8')).toBe('<html>A</html>');
  expect(await command(request, { command: 'trash', path: 'Notes/B.html' })).toEqual({ status: 200, body: { path: '.trash/Notes/B.html' } });
  await fs.writeFile(path.join(h.dir, 'Notes/B.html'), '<html>occupant</html>');
  expect(await command(request, { command: 'restore-trash', trashPath: '.trash/Notes/B.html' })).toEqual({ status: 200, body: { path: 'Notes/B (restored).html' } });
  expect(await fs.readFile(path.join(h.dir, 'Notes/B (restored).html'), 'utf8')).toBe('<html>A</html>');
  expect(await command(request, { command: 'trash', path: 'Notes/Copy.html' })).toEqual({ status: 200, body: { path: '.trash/Notes/Copy.html' } });
  expect(await command(request, { command: 'empty-trash' })).toEqual({ status: 200, body: { path: null } });
  expect(await fs.readdir(path.join(h.dir, '.trash'))).toEqual([]);
  expect(await fs.readFile(path.join(other, '.trash/keep.html'), 'utf8')).toBe('keep');
});

test('renaming a page moves its merge state beside it and it composes at the new path', async () => {
  h = await fixture();
  const template = await fs.readFile(path.join(__dirname, '../../src/main/document-templates/page.html'), 'utf8');
  const { state } = splitPage(template);
  await fs.writeFile(path.join(h.dir, 'A.html'), await storePageState(h.dir, 'A.html', template));
  const request = await h.start();

  expect(await command(request, { command: 'rename', path: 'A.html', name: 'B.html' }))
    .toEqual({ status: 200, body: { path: 'B.html' } });

  expect(await readPageState(h.dir, 'A.html')).toBeNull();
  expect(await readPageState(h.dir, 'B.html')).toEqual(state);
  const stored = await fs.readFile(path.join(h.dir, 'B.html'), 'utf8');
  expect(stored).not.toContain('merge="page"');
  expect(await logicalDocument(h.dir, 'B.html', stored)).toContain('merge="page"');
});

test('occupied destinations, cross-root paths, unsafe paths, and unknown templates are refused', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html>A</html>');
  await fs.writeFile(path.join(h.dir, 'B.html'), '<html>B</html>');
  const request = await h.start();
  expect(await command(request, { command: 'rename', path: 'A.html', name: 'B.html' })).toMatchObject({ status: 409, body: { reason: 'conflict' } });
  expect(await command(request, { command: 'move', path: 'A.html', parent: '../other' })).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  expect(await command(request, { command: 'trash', path: '.hyperclay/private.html' })).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  expect(await command(request, { command: 'create', parent: null, name: 'C.html', template: 'unknown' })).toMatchObject({ status: 501, body: { reason: 'unsupported' } });
  expect(await fs.readFile(path.join(h.dir, 'A.html'), 'utf8')).toBe('<html>A</html>');
});

test('Empty Trash refuses a symlink rather than following it outside the root', async () => {
  h = await fixture();
  const outside = await fs.mkdtemp(path.join(h.dir, 'outside-'));
  await fs.writeFile(path.join(outside, 'keep.html'), 'keep');
  await fs.symlink(outside, path.join(h.dir, '.trash'));
  const request = await h.start();
  expect(await command(request, { command: 'empty-trash' })).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  expect(await fs.readFile(path.join(outside, 'keep.html'), 'utf8')).toBe('keep');
});

test('renaming a document keeps the authority identity and emits one moved event through the engine lane', async () => {
  const serial = jest.fn(fn => fn());
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  h = await fixture({ authority, engine: { serial } });
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html>A</html>');
  const canonicalRoot = await fs.realpath(h.dir);
  await withStructureChange(() => authority.registerRoot({ ...h.root, canonicalPath: canonicalRoot }));
  const oldPath = path.join(canonicalRoot, 'A.html');
  authority.bindTarget({ rootId: h.root.id, logicalPath: 'A.html', canonicalPath: oldPath, origin: null, live: null });
  const identity = authority.identityAt(oldPath);
  const request = await h.start();
  const response = await request('/api/events');
  const reader = response.body.getReader();
  await command(request, { command: 'rename', path: 'A.html', name: 'B.html' });
  h.observer.emit('raw', { event: 'unlink', rel: 'A.html' });
  h.observer.emit('raw', { event: 'add', rel: 'B.html' });
  let stream = '';
  while (!stream.includes('"type":"moved"')) stream += new TextDecoder().decode((await reader.read()).value);
  expect(stream.split('\n').filter(line => line.includes('"type":"moved"'))).toHaveLength(1);
  expect(stream).not.toContain('"type":"changed"');
  expect(serial).toHaveBeenCalledTimes(1);
  expect(authority.identityAt(path.join(canonicalRoot, 'B.html'))).toBe(identity);
  expect(authority.identityAt(oldPath)).toBeNull();
  await reader.cancel();
});

test('create admits and confirms a new document through the authority writer', async () => {
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  h = await fixture({ authority });
  const canonicalRoot = await fs.realpath(h.dir);
  await withStructureChange(() => authority.registerRoot({ ...h.root, canonicalPath: canonicalRoot }));
  const request = await h.start();
  expect(await command(request, { command: 'create', parent: null, name: 'New.html', template: 'blank' }))
    .toEqual({ status: 200, body: { path: 'New.html' } });
  const file = path.join(canonicalRoot, 'New.html');
  expect(authority.identityAt(file)).not.toBeNull();
  expect(authority.confirmedStamp(file)).not.toBeNull();
  expect(await fs.stat(path.join(h.dir, '.hyperclay')).catch(() => null)).toBeNull();
});

test('the existing sync engine sees a workspace command as one rename by inode', async () => {
  h = await fixture();
  await fs.mkdir(path.join(h.dir, 'work'));
  await fs.writeFile(path.join(h.dir, 'work/page.html'), '<html>page</html>');
  const ids = { 20: 'work', 21: 'work/page.html' };
  const ledger = fsScenario.ledgerFor(h.dir, ids);
  const server = new FakeServer(fsScenario.serverNodesFor(h.dir, ids));
  install(api, server);
  const { SyncEngine } = require('../../src/sync-engine/index');
  const engine = new SyncEngine();
  engine.isRunning = true;
  engine.serverUrl = 'http://test';
  engine.apiKey = 'test-key';
  engine.syncFolder = h.dir;
  engineMetaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-meta-'));
  engine.metaDir = engineMetaDir;
  engine.lastSyncedAt = Date.now();
  engine.repo.seed(ledger);
  engine.runner = { start: jest.fn(), state: 'live' };
  h.rootServer.deps.syncEngineFor = () => engine;
  const request = await h.start();
  expect(await command(request, { command: 'rename', path: 'work/page.html', name: 'index.html' }))
    .toEqual({ status: 200, body: { path: 'work/index.html' } });
  await engine.reconcileAll(server.inventory(), { generation: 1 });
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
  const mutations = server.calls.filter(call => ['renameNode', 'moveNode', 'deleteNode', 'createNode'].includes(call.name));
  expect(mutations.map(call => call.name)).toEqual(['renameNode']);
  expect(mutations[0].nodeId).toBe(21);
  expect(engine.repo.get('21').path).toBe('work/index.html');
});

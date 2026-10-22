const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// A download of a page whose open room holds unsaved edits replaces the page the way any other
// outside write does: the downloaded file stays, the edits go to a recovered copy, and the room
// starts over on the new page, so its next checkpoint cannot render the old edits back over it.
let mockRemote;
let mockRemoteRecord;
jest.mock('../../src/sync-engine/api-client', () => ({
  ...jest.requireActual('../../src/sync-engine/api-client'),
  getNodeContent: async () => mockRemote,
  getPageState: async () => mockRemoteRecord,
}));
jest.mock('../../src/main/utils/derived-artifacts', () => ({ refreshDerivedArtifacts: async () => {} }));
jest.mock('../../src/main/data-loss-guard', () => ({ runDataLossGuard: async () => {} }));
const { createRooms, splitPage } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { storePageState, readPageState } = require('../../src/main/page-state-store');
const { validateSegments } = require('../../src/main/utils/path-resolver');
const { documentEtag } = require('../../src/main/spec-wire');
const { renderRecovered } = require('../../src/main/external-recovery');
const { pageFixture } = require('../../tests/helpers/page-fixture');
const sse = require('../../src/sync-engine/engine-sse');
const uploader = require('../../src/sync-engine/engine-uploader');
const { executeDecision } = require('../../src/sync-engine/reconcile/execute');
const NodeRepository = require('../../src/sync-engine/state/node-repository');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

const listHtml = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const name = path.join(dir, e.name);
  return e.isDirectory() ? listHtml(name) : e.name.endsWith('.html') ? [name] : [];
}) : [];

async function run(mode, withRecord) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `${mode}-${withRecord ? 'record' : 'missing'}-`));
  const file = path.join(dir, 'article.html');
  const fixture = pageFixture('abc');
  const next = pageFixture('xyz');
  const clean = await storePageState(dir, 'article.html', fixture.html);
  fs.writeFileSync(file, clean);
  const rooms = createRooms({});
  const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
  authority.registerRoot({ id: 'root', path: dir, canonicalPath: dir }, { owner: 'server' });
  const target = authority.bindTarget({ rootId: 'root', logicalPath: 'article.html', canonicalPath: file });
  const room = await authority.roomFor(target, async () => ({ ...target }));
  const accepted = rooms.apply(room, 'client', {
    name: 'page', n: 1, epoch: room.epoch, pageGeneration: room.pageTransition?.id ?? null,
    ops: [{ op: 'set', path: ['y', 'edit-1'], value: fixture.update }],
  }, { connected: ['client'] });
  assert.equal(accepted.error, undefined);
  assert.equal(authority.roomIsDirty(room), true);
  assert.match(renderRecovered(fixture.html, room), /<p data-id="p">ac<\/p>/);

  const split = splitPage(next.html);
  mockRemote = { content: split.file, checksum: documentEtag(split.file), etag: documentEtag(split.file), modifiedAt: new Date().toISOString(), nodeType: 'site' };
  mockRemoteRecord = withRecord ? split.state : null;
  const engine = Object.assign(new EventEmitter(), sse, uploader, {
    syncFolder: dir, metaDir: path.join(dir, '.meta'), rootId: 'root', generation: 1,
    localAuthority: authority, resolveContainedPath: validateSegments,
    live: { broadcast() {}, markBrowserSave() {}, notify() {} },
    conn: {}, cascade: new CascadeSuppression(),
    stats: { filesDownloaded: 0, errors: [] },
    repo: new NodeRepository(),
  });
  fs.mkdirSync(engine.metaDir);
  engine.repo.attach(engine.metaDir);
  engine.repo.seed([[7, { path: 'article.html', type: 'site', checksum: documentEtag(clean) }]]);
  if (mode === 'download') await engine.downloadFile(7, 'article.html');
  else if (mode === 'sse') await engine._applyNodeSavedSite({ ...mockRemote, path: 'article.html', name: 'article.html', nodeId: 7 });
  else await executeDecision(engine, 7, { action: 'download' }, { path: 'article.html', type: 'site' });
  assert.deepEqual(engine.stats.errors, []);
  assert.equal(fs.readFileSync(file, 'utf8'), split.file);
  const savedAfterDownload = listHtml(dir).map(f => fs.readFileSync(f, 'utf8'));
  expect(fs.readFileSync(file, 'utf8')).toBe(split.file);
  const recovered = listHtml(path.join(dir, '.hyperclay', 'recovered')).map(f => fs.readFileSync(f, 'utf8'));
  expect(recovered.some(html => html.includes('<p data-id="p">ac</p>'))).toBe(true);
  expect(rooms.get(file)).not.toBe(room);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('a page downloaded over a room with unsaved edits', () => {
  for (const mode of ['download', 'sse', 'reconcile']) {
    test(`${mode}, with the page's record`, () => run(mode, true));
    test(`${mode}, without a record`, () => run(mode, false));
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { splitPage, createRooms } = require('@panphora/clayjs/server/rooms');
const { createApp } = require('../../src/main/server.js');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { createRootLive } = require('../../src/main/utils/root-live');
const { storePageState } = require('../../src/main/page-state-store');
const { listenLoopback, closeLoopback } = require('./loopback');
const { pageFixture } = require('./page-fixture');
const dataGuard = require('../../src/main/data-loss-guard');

const NAME = 'article.html';

async function run() {
  dataGuard.runDataLossGuard = async () => null;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'save-page-replacement-')));
  const file = path.join(dir, NAME);
  const fixture = pageFixture('abc');
  fs.writeFileSync(file, await storePageState(dir, NAME, fixture.html));

  const authority = createLocalAuthority({ rooms: createRooms({}), withDocument: withDocumentWrite });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite, logError: () => {} });
  authority.setCheckpointService(checkpoint);
  authority.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir }, { owner: 'server' });
  const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  const live = createRootLive(root);
  const target = authority.bindTarget({ rootId: 'root-a', logicalPath: NAME, canonicalPath: file, live });
  const room = await authority.roomFor(target, async () => ({
    rootId: 'root-a', logicalPath: NAME, canonicalPath: file, identity: target.identity,
  }));
  const edited = authority.rooms.apply(room, 'client', {
    name: 'page', n: 1, epoch: room.epoch, pageGeneration: room.pageTransition?.id ?? null,
    ops: [{ op: 'set', path: ['y', 'edit-1'], value: fixture.update }],
  }, { connected: ['client'] });
  console.log('edit', edited.error ?? 'ok');
  console.log('dirty', authority.roomIsDirty(room));

  const server = await listenLoopback(createApp({
    root, live, localAuthority: authority, localCheckpoint: checkpoint, devHooks: null, isKnownPath: null,
  }));
  try {
    const replacement = splitPage(fixture.html).file.replace(/data-rev="[^"]*"/, 'data-rev="replaced"');
    const res = await request(server)
      .post('/save')
      .set('Document-URL', `http://127.0.0.1:${server.address().port}/${NAME}`)
      .set('Content-Type', 'text/plain')
      .send(replacement);
    console.log('status', res.status, res.body.code ?? '');
    const versionsDir = path.join(dir, '.hyperclay', 'versions', 'article');
    const versions = fs.readdirSync(versionsDir).sort()
      .map((name) => fs.readFileSync(path.join(versionsDir, name), 'utf8'));
    console.log('kept unsaved edit',
      versions.some((text) => text.includes('<p data-id="p">ac</p>') && !text.includes('merge="page"')));
    console.log('room page store', authority.rooms.get(file)?.stores.has('page'));
    const disk = fs.readFileSync(file, 'utf8');
    console.log('disk has page tag', disk.includes('merge="page"'));
    console.log('disk replaced', disk.includes('data-rev="replaced"'));
  } finally {
    await closeLoopback();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

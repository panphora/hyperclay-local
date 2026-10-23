const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('upath');
const { splitPage } = require('@panphora/clayjs/server/rooms');
const { createBackup } = require('../../src/main/utils/backup');
const { documentEtag } = require('../../src/main/spec-wire');
const { RootServer } = require('../../src/main/root-servers');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { storePageState, readPageState, logicalBytes } = require('../../src/main/page-state-store');
const { pageFixture } = require('./page-fixture');

async function run() {
  const dir = path.resolve(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-restore-page-room-'))));
  const file = path.join(dir, 'A.html');
  const older = pageFixture('abc');
  const stored = pageFixture('xyz');
  await fs.writeFile(file, await storePageState(dir, 'A.html', older.html));
  const olderVersion = path.basename(await createBackup(dir, 'A', splitPage(older.html).file));
  await fs.writeFile(file, await storePageState(dir, 'A.html', stored.html));
  await createBackup(dir, 'A', splitPage(stored.html).file);
  const rev = (await readPageState(dir, 'A.html')).rev;
  assert.notEqual(rev, splitPage(older.html).state.rev);

  const published = [];
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite });
  authority.setCheckpointService(checkpoint);
  const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  const server = new RootServer(root, {
    localAuthority: authority, localCheckpoint: checkpoint,
    observer: { publishExternal: (...args) => published.push(args) },
  });
  try {
    assert.equal((await server.start()).ok, true);
    const origin = `http://127.0.0.1:${server.server.address().port}`;
    const target = authority.bindTarget({ rootId: root.id, logicalPath: 'A.html', canonicalPath: file, origin });
    const room = await authority.roomFor(target, () => ({
      rootId: root.id, logicalPath: 'A.html', canonicalPath: file, identity: target.identity,
    }));
    const edited = authority.rooms.apply(room, 'editor', { name: 'page', n: 1, epoch: room.epoch,
      pageGeneration: room.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-1'], value: stored.update }] });
    assert.equal(edited.error, undefined);
    assert.equal(authority.roomIsDirty(room), true);
    const current = await logicalBytes(dir, 'A.html', await fs.readFile(file));

    const restored = await fetch(`${origin}/_/restore/A.html/${olderVersion}`, {
      method: 'POST', headers: { Origin: origin, 'If-Match': documentEtag(current) },
    });
    assert.equal(restored.status, 200, await restored.text());

    assert.equal(authority.rooms.get(file), room);
    assert.equal(room.stores.has('page'), true);
    assert.equal(authority.roomIsDirty(room), true);
    // The room keeps its unsaved edits through the restore, so they are in a
    // recovered copy as well as in memory.
    const copies = await fs.readdir(path.join(dir, '.hyperclay', 'recovered', 'A'));
    assert.equal(copies.length, 1, JSON.stringify(copies));
    const recovered = await fs.readFile(path.join(dir, '.hyperclay', 'recovered', 'A', copies[0]), 'utf8');
    assert.ok(recovered.includes('<p data-id="p">xz</p>'), recovered);
    assert.ok(!recovered.includes('>xyz<'), recovered);
    const versions = await fs.readdir(path.join(dir, '.hyperclay', 'versions', 'A'));
    assert.equal(versions.some((name) => name.startsWith('recovered-')), false);

    const disk = await fs.readFile(file, 'utf8');
    assert.ok(disk.includes('<p data-id="p">abc</p>'), disk);
    assert.ok(disk.includes(`data-rev="${rev}"`), disk);
    assert.ok(!disk.includes('merge="page"'), disk);
    assert.equal((await readPageState(dir, 'A.html')).rev, rev);

    assert.equal(published.length, 1);
    assert.ok(published[0][1].toString('utf8').includes('merge="page"'));
    console.log('restore of a page version kept the room');
    console.log('restore page room proof passed');
  } finally {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

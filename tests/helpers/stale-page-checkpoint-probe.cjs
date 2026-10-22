const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRooms, splitPage } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { createBackup } = require('../../src/main/utils/backup');
const { storePageState } = require('../../src/main/page-state-store');
const { RootObserver } = require('../../src/main/root-observer');
const { pageFixture } = require('./page-fixture');

const blocks = (first) => [
  { id: 'a', t: 'paragraph', text: first },
  { id: 'b', t: 'paragraph', text: 'two' },
  { id: 'c', t: 'paragraph', text: 'three' },
];
const article = (html) => /<article[^>]*>([\s\S]*)<\/article>/.exec(html)[1].trim();

// One room over two versions of a page, made dirty, with an older copy of the
// page written to disk underneath it. `edit` puts the hand edit in that copy.
async function scenario(older, stored, edit) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'stale-page-checkpoint-')));
  const file = path.join(dir, 'article.html');
  await fsp.writeFile(file, await storePageState(dir, 'article.html', older.html));
  await createBackup(dir, 'article', splitPage(older.html).file);
  await fsp.writeFile(file, await storePageState(dir, 'article.html', stored.html));
  await createBackup(dir, 'article', splitPage(stored.html).file);

  const rooms = createRooms({});
  const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite, logError: () => {} });
  authority.setCheckpointService(checkpoint);
  checkpoint.registerWriter('root-a', async (write) => {
    await fsp.writeFile(write.filePath, await storePageState(dir, 'article.html', write.content));
    await authority.confirmKnownWrite(write.target, write.content, write.token);
    return write.content;
  });
  authority.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir }, { owner: 'server' });
  const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'article.html', canonicalPath: file });
  const room = await authority.roomFor(target, () => ({
    rootId: 'root-a', logicalPath: 'article.html', canonicalPath: file, identity: target.identity,
  }));
  const edited = rooms.apply(room, 'editor', {
    name: 'page', n: 1, epoch: room.epoch, pageGeneration: room.pageTransition?.id ?? null,
    ops: [{ op: 'set', path: ['y', 'edit-1'], value: stored.update }],
  }, { connected: ['editor'] });
  assert.equal(edited.error, undefined);

  const observer = new RootObserver({ id: 'root-a', path: dir }, {
    localAuthority: authority,
    live: { notify: () => {}, broadcast: () => {} },
  });
  observer._runDataGuard = () => {};
  const stale = splitPage(older.html).file;
  await fsp.writeFile(file, edit ? stale.replace('<p data-id="b">two</p>', '<p data-id="b">two!</p>') : stale);
  await observer._raw('change', 'article.html');
  assert.equal(rooms.get(file), room);

  // The rebased page is on disk, not only in the authority's stamp.
  const written = await fsp.readFile(file, 'utf8');
  assert.ok(written.includes('<p data-id="a">one!</p>'), written);
  assert.ok(written.includes(edit ? '<p data-id="b">two!</p>' : '<p data-id="a">one!</p>'), written);
  assert.ok(written.includes(`data-rev="${splitPage(stored.html).state.rev}"`), written);
  assert.ok(!written.includes('merge="page"'), written);

  // The room the rebase kept is dirty, so its unsaved edits are in a recovered
  // copy as well as in memory.
  const copies = await fsp.readdir(path.join(dir, '.hyperclay', 'recovered', 'article'));
  assert.equal(copies.length, 1, JSON.stringify(copies));
  const recovered = await fsp.readFile(path.join(dir, '.hyperclay', 'recovered', 'article', copies[0]), 'utf8');
  assert.ok(recovered.includes('<p data-id="a">oe!</p>'), recovered);
  assert.ok(!recovered.includes('>one!<'), recovered);

  const result = await checkpoint.attempt(file);
  assert.equal(rooms.get(file), room);
  const disk = await fsp.readFile(file, 'utf8');
  await fsp.rm(dir, { recursive: true, force: true });
  return { result, disk };
}

async function run() {
  const older = pageFixture('', blocks('one'));
  const stored = pageFixture('', blocks('one!'));

  const untouched = await scenario(older, stored, false);
  assert.equal(untouched.result.kind, 'ok', JSON.stringify(untouched.result));
  assert.equal(article(untouched.disk), article(untouched.result.written));
  assert.notEqual(article(untouched.disk), article(splitPage(stored.html).file));
  console.log('untouched older copy checkpoint ok');

  const handEdited = await scenario(older, stored, true);
  assert.equal(handEdited.result.kind, 'refused');
  console.log('hand-edited older copy kept the room, refused', handEdited.result.reason);
  console.log('stale page checkpoint proof passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

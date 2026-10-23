const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('upath');
const { publishRecoveredCopy } = require('../../src/main/utils/backup');
const { documentEtag } = require('../../src/main/spec-wire');
const { RootServer } = require('../../src/main/root-servers');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');

const current = '<!doctype html><html><head><script type="application/json" clay="live" merge="todos">{"items":["a"]}</script></head><body><ul></ul></body></html>';
const recovered = '<!doctype html><html><head><script type="application/json" clay="live" merge="todos">{"items":["z"]}</script></head><body><ul></ul></body></html>';

async function run() {
  const dir = path.resolve(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'restore-nonpage-'))));
  const file = path.join(dir, 'todo.html');
  await fs.writeFile(file, current);
  const copy = await publishRecoveredCopy(dir, 'todo.html', recovered);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite });
  authority.setCheckpointService(checkpoint);
  const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  const server = new RootServer(root, { localAuthority: authority, localCheckpoint: checkpoint });
  try {
    assert.equal((await server.start()).ok, true);
    const origin = `http://127.0.0.1:${server.server.address().port}`;
    const target = authority.bindTarget({ rootId: root.id, logicalPath: 'todo.html', canonicalPath: file, origin });
    const room = await authority.roomFor(target, () => ({ canonicalPath: file, identity: target.identity }));
    authority.rooms.apply(room, 'editor', { name: 'todos', n: 1, epoch: room.epoch,
      ops: [{ op: 'set', path: ['items', 1], value: 'b' }] });
    assert.equal(authority.roomIsDirty(room), true);
    const restored = await fetch(`${origin}/_/restore/todo.html/recovered-${copy.filename}`, {
      method: 'POST', headers: { Origin: origin, 'If-Match': documentEtag(current) },
    });
    assert.equal(restored.status, 200, await restored.text());
    assert.equal(await fs.readFile(file, 'utf8'), recovered);
    const backups = await fs.readdir(path.join(dir, '.hyperclay', 'versions', 'todo'));
    const contents = await Promise.all(backups.map(name => fs.readFile(path.join(dir, '.hyperclay', 'versions', 'todo', name), 'utf8')));
    assert.deepEqual(contents.sort(), [current, recovered].sort());
    console.log('restore non-page proof passed');
  } finally {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { publishRecoveredCopy } = require('../../src/main/utils/backup');
const { documentEtag } = require('../../src/main/spec-wire');
const { RootServer } = require('../../src/main/root-servers');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { pageFixture } = require('./page-fixture');

async function run() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-restore-room-')));
  const file = path.join(dir, 'A.html');
  const page = pageFixture();
  await fs.writeFile(file, page.html);
  const recovered = await publishRecoveredCopy(dir, 'A.html', page.html);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite });
  authority.setCheckpointService(checkpoint);
  const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  const server = new RootServer(root, { localAuthority: authority, localCheckpoint: checkpoint });
  try {
    assert.equal((await server.start()).ok, true);
    const origin = `http://127.0.0.1:${server.server.address().port}`;
    const target = authority.bindTarget({ rootId: root.id, logicalPath: 'A.html', canonicalPath: file, origin });
    const room = await authority.roomFor(target, () => ({ canonicalPath: file, identity: target.identity }));
    authority.rooms.apply(room, 'editor', { name: 'page', n: 1, epoch: room.epoch,
      pageGeneration: room.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-1'], value: page.update }] });
    assert.equal(authority.roomIsDirty(room), true);
    const safetyBackup = checkpoint.safetyBackup.bind(checkpoint);
    checkpoint.safetyBackup = async (...args) => {
      const concurrent = authority.rooms.apply(room, 'editor', { name: 'page', n: 2, epoch: room.epoch,
        pageGeneration: room.pageTransition?.id ?? null,
        ops: [{ op: 'set', path: ['y', 'edit-2'], value: page.update }] });
      assert.equal(concurrent.error, 'page-converting');
      return safetyBackup(...args);
    };
    const restored = await fetch(`${origin}/_/restore/A.html/recovered-${recovered.filename}`, {
      method: 'POST', headers: { Origin: origin, 'If-Match': documentEtag(page.html) },
    });
    assert.equal(restored.status, 200, await restored.text());
    const versions = path.join(dir, '.hyperclay', 'versions', 'A');
    const backups = await fs.readdir(versions);
    const contents = await Promise.all(backups.map(name => fs.readFile(path.join(versions, name), 'utf8')));
    assert.ok(contents.some(html => /<p data-id="p">ac<\/p>/.test(html)));
    console.log('restore room proof passed');
  } finally {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

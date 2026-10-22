const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { pageFixture } = require('./page-fixture');
const { storePageState, readPageState } = require('../../src/main/page-state-store');

async function run() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'l3-probe4-')));
  const file = path.join(dir, 'doc.html');
  const fixture = pageFixture('abc');
  fs.writeFileSync(file, await storePageState(dir, 'doc.html', fixture.html));
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  authority.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite, logError: () => {} });
  authority.setCheckpointService(checkpoint);
  checkpoint.registerWriter('root-a', async (write) => {
    const stored = await storePageState(dir, 'doc.html', write.content);
    fs.writeFileSync(write.filePath, stored);
    await authority.confirmKnownWrite(write.target, write.content, write.token);
    return write.content;
  });
  const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: file });
  const room = await authority.roomFor(target, () => ({
    rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: file, identity: target.identity,
  }));
  console.log('stores', [...room.stores.keys()]);
  const edit = (n) => authority.rooms.apply(room, 'c', { name: 'page', n, epoch: room.epoch,
    pageGeneration: room.pageTransition?.id ?? null, ops: [{ op: 'set', path: ['y', `edit-${n}`], value: fixture.update }] });
  console.log('edit1', edit(1).error ?? 'ok');
  console.log('checkpoint1', (await checkpoint.attempt(file)).kind);
  console.log('edit2', edit(2).error ?? 'ok');
  const second = await checkpoint.attempt(file);
  console.log('checkpoint2', JSON.stringify(second));
  console.log('same room?', authority.rooms.get(file) === room);
  console.log('recovered dir?', fs.existsSync(path.join(dir, '.hyperclay', 'recovered')));
  console.log('file has page tag?', fs.readFileSync(file, 'utf8').includes('merge="page"'));
  fs.rmSync(dir, { recursive: true, force: true });
}
run().catch(e => { console.error(e); process.exitCode = 1; });

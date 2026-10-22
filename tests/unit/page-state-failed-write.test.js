const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { splitPage, createRooms } = require('@panphora/clayjs/server/rooms');
const { storePageState, logicalDocument } = require('../../src/main/page-state-store');
const { atomicWriteFile, withDocumentWrite } = require('../../src/main/utils/write-queue');
const { createBackup } = require('../../src/main/utils/backup');
const { RootObserver } = require('../../src/main/root-observer');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { pageFixture } = require('../helpers/page-fixture');

// The sidecar is written before the file, so its newest record can belong to a write
// that never landed. The file on disk keeps its own record, and nothing rebases onto
// the page that never landed.
describe('a page write whose file never lands', () => {
  const saved = pageFixture('SAVED OLD CONTENT');
  const aborted = pageFixture('ABORTED NEW CONTENT');
  const second = pageFixture('SECOND ABORTED CONTENT');
  let dir;
  let file;
  let onDisk;

  const failWrite = async (html) => {
    await createBackup(dir, 'note', splitPage(html).file);
    const next = await storePageState(dir, 'note.html', html);
    await expect(atomicWriteFile(file, next, 'utf8', () => {
      throw Object.assign(new Error('Checkpoint target changed since it was read'), { code: 'moved-or-deleted' });
    })).rejects.toMatchObject({ code: 'moved-or-deleted' });
    expect(await fs.readFile(file, 'utf8')).toBe(onDisk);
  };

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'page-failed-write-')));
    file = path.join(dir, 'note.html');
    await atomicWriteFile(file, await storePageState(dir, 'note.html', saved.html));
    await createBackup(dir, 'note', splitPage(saved.html).file);
    onDisk = await fs.readFile(file, 'utf8');
  });

  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  test('two failed writes leave the file on disk with its own state', async () => {
    await failWrite(aborted.html);
    await failWrite(second.html);
    expect(await logicalDocument(dir, 'note.html', onDisk)).toMatch(/merge="page"/);
  });

  test('an outside change to the surviving file is never rebased onto the write that failed', async () => {
    await failWrite(aborted.html);
    const authority = createLocalAuthority({ rooms: createRooms(), withDocument: withDocumentWrite });
    authority.registerRoot({ id: 'root', path: dir, canonicalPath: dir }, { owner: 'server' });
    const target = authority.bindTarget({ rootId: 'root', logicalPath: 'note.html', canonicalPath: file });
    await authority.roomFor(target, async () => ({ ...target }));
    const observer = new RootObserver({ id: 'root', path: dir }, {
      localAuthority: authority,
      live: { notify: () => {}, broadcast: () => {} },
    });
    observer._runDataGuard = () => {};
    await observer._raw('change', 'note.html');
    const after = await fs.readFile(file, 'utf8');
    expect(after).toMatch(/SAVED OLD CONTENT/);
    expect(after).not.toMatch(/ABORTED NEW CONTENT/);
    await observer.stop?.();
  });
});

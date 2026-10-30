jest.mock('../../src/main/data-loss-guard', () => ({
  ...jest.requireActual('../../src/main/data-loss-guard'),
  runDataLossGuard: jest.fn().mockResolvedValue(null)
}));

const fs = require('fs').promises;
const path = require('upath');
const os = require('os');
const request = require('supertest');

const writeQueue = require('../../src/main/utils/write-queue');
const { atomicWriteFile, withDocumentWrite } = writeQueue;
const { createApp } = require('../../src/main/server.js');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { RootObserver } = require('../../src/main/root-observer');
const { createRootLive } = require('../../src/main/utils/root-live');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { storePageState, pageStatePath } = require('../../src/main/page-state-store');
const { pageFixture } = require('../helpers/page-fixture');

const FIXTURE = pageFixture('abc');

describe('atomicWriteFile syncs the directory the rename landed in', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-durable-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('atomicWriteFile syncs the directory after the rename', async () => {
    const target = path.join(dir, 'doc.html');
    const sync = jest.spyOn(writeQueue, 'syncDirectory');

    await atomicWriteFile(target, 'x');

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(path.dirname(target));
    expect(await fs.readFile(target, 'utf8')).toBe('x');
  });

  test('an ordinary write tolerates a failing directory sync', async () => {
    const target = path.join(dir, 'doc.html');
    jest.spyOn(writeQueue, 'syncDirectory').mockRejectedValue(Object.assign(new Error('disk gone'), { code: 'EIO' }));

    await expect(atomicWriteFile(target, 'y')).resolves.toBeUndefined();

    expect(await fs.readFile(target, 'utf8')).toBe('y');
  });

  test('a durable write rejects a failing directory sync', async () => {
    const target = path.join(dir, 'doc.html');
    const failure = Object.assign(new Error('disk gone'), { code: 'EIO' });
    jest.spyOn(writeQueue, 'syncDirectory').mockRejectedValue(failure);

    await expect(atomicWriteFile(target, 'z', 'utf8', undefined, { durable: true })).rejects.toBe(failure);
  });

  test('a durable write accepts a platform that cannot sync directories', async () => {
    const target = path.join(dir, 'doc.html');
    jest.spyOn(writeQueue, 'syncDirectory').mockRejectedValue(Object.assign(new Error('is a directory'), { code: 'EISDIR' }));

    await expect(atomicWriteFile(target, 'z', 'utf8', undefined, { durable: true })).resolves.toBeUndefined();

    expect(await fs.readFile(target, 'utf8')).toBe('z');
  });
});

describe('a live-room checkpoint is only reported done once its bytes are durable', () => {
  const NAME = 'page.html';
  let dir;
  let authority;
  let checkpoint;
  let observer;
  let server;

  const filePath = () => path.join(dir, NAME);

  beforeEach(async () => {
    dir = path.resolve(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-durable-room-'))));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
    authority = createLocalAuthority({ withDocument: withDocumentWrite, pageCompaction: false });
    authority.registerRoot({ id: root.id, path: dir, canonicalPath: dir });
    checkpoint = createLocalCheckpoint({
      authority, withDocument: withDocumentWrite, logError: () => {},
      // The default loader is a dynamic import, which jest's runtime refuses.
      loadCore: async () => require('@panphora/clayjs/server/checkpoint'),
      setTimer: () => ({ unref: () => {} }), clearTimer: () => {},
    });
    authority.setCheckpointService(checkpoint);
    const live = createRootLive(root);
    observer = new RootObserver(root, { live, localAuthority: authority });
    server = await listenLoopback(createApp({
      root, live, observer, localAuthority: authority, localCheckpoint: checkpoint,
      devHooks: null, isKnownPath: null
    }));
    await fs.writeFile(filePath(), await storePageState(dir, NAME, FIXTURE.html));
  });

  afterEach(async () => {
    await closeLoopback();
    await observer.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10 });
    jest.restoreAllMocks();
  });

  test('a checkpoint whose directory sync fails is not reported done', async () => {
    const sync = jest.spyOn(writeQueue, 'syncDirectory')
      .mockRejectedValue(Object.assign(new Error('disk gone'), { code: 'EIO' }));

    const saved = await request(server)
      .post('/_/save')
      .set('Page-URL', `http://127.0.0.1:${server.address().port}/${NAME}`)
      .set('Content-Type', 'text/plain')
      .send(FIXTURE.html);
    expect(saved.status).toBe(200);

    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: NAME, canonicalPath: filePath() });
    const room = await authority.roomFor(target, () => ({
      rootId: 'root-a', logicalPath: NAME, canonicalPath: filePath(), identity: target.identity,
    }));
    const edited = authority.rooms.apply(room, 'editor', {
      name: 'page', n: 1, epoch: room.epoch, pageGeneration: room.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-1'], value: FIXTURE.update }],
    });
    expect(edited.error).toBeUndefined();
    expect(authority.roomIsDirty(room)).toBe(true);

    const before = await fs.readFile(filePath(), 'utf8');

    const result = await checkpoint.attempt(filePath());

    expect(result).toMatchObject({ kind: 'transient', reason: 'operation-failed' });
    expect(await fs.readFile(filePath(), 'utf8')).toBe(before);

    // The same write lands as soon as the directory can be synced, so the failure
    // above is the durability check and nothing else.
    sync.mockRestore();
    expect((await checkpoint.attempt(filePath())).kind).toBe('ok');
    expect(await fs.readFile(pageStatePath(dir, NAME), 'utf8')).toContain('edit-1');
  });
});

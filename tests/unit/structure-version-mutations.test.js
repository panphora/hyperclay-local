/**
 * R-L1: every structural change sends a current expectedVersion.
 *
 * On a team session the server refuses a rename, move or delete without the
 * node's `structureVersion` (428). One method answers for all three: a file
 * whose baseline carries a version sends it without a network call, a folder
 * (or a file whose baseline has none) reads the fresh inventory, and a fresh
 * etag that disagrees with the baseline means the server holds content this
 * desktop has not seen — a 409 `node-changed` instead of a write.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/sync-engine/api-client', () => ({
  renameNode: jest.fn(),
  moveNode: jest.fn(),
  deleteNode: jest.fn()
}));

const { renameNode, moveNode, deleteNode } = require('../../src/sync-engine/api-client');
const NodeRepository = require('../../src/sync-engine/state/node-repository');
const mutations = require('../../src/sync-engine/engine-mutations');

const SV_OLD = 'sv-old';
const ETAG = 'etag-1';

let metaDir;

function fileEntry(overrides = {}) {
  return {
    type: 'site',
    path: 'board.html',
    inode: 11,
    remoteEtag: ETAG,
    localChecksum: 'sum-1',
    checksum: 'sum-1',
    syncedAt: 1,
    ...overrides
  };
}

function folderEntry(overrides = {}) {
  return {
    type: 'folder',
    path: 'proj',
    parentId: 0,
    inode: 12,
    syncedAt: 1,
    ...overrides
  };
}

function makeEngine({ protocol = 2, entries = [], nodes = [] } = {}) {
  const repo = new NodeRepository();
  repo.attach(metaDir);
  repo.seed(entries);

  return Object.assign({}, mutations, {
    protocol,
    generation: 1,
    conn: {},
    outbox: { markInFlight: jest.fn() },
    invalidateServerNodesCache: jest.fn(),
    fetchAndCacheServerNodes: jest.fn(async () => nodes),
    repo
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  metaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structure-version-'));
  renameNode.mockResolvedValue({ nodeId: 901, oldName: 'a.html', newName: 'b.html' });
  moveNode.mockResolvedValue({ nodeId: 901, fromPath: 'a.html', toPath: 'b.html' });
  deleteNode.mockResolvedValue({ success: true });
});

afterEach(() => {
  fs.rmSync(metaDir, { recursive: true, force: true });
});

describe('_expectedVersion — one read per structural change', () => {
  test('a file whose baseline carries a version sends it with no network call', async () => {
    const engine = makeEngine({
      entries: [['901', fileEntry({ structureVersion: SV_OLD })]],
      nodes: [{ id: 901, type: 'site', etag: ETAG, structureVersion: 'sv-fresh' }]
    });

    await engine._apiRenameNode('901', 'b.html');

    expect(renameNode).toHaveBeenCalledWith(engine.conn, 901, 'b.html', { expectedVersion: SV_OLD });
    expect(engine.fetchAndCacheServerNodes).not.toHaveBeenCalled();
    expect(engine.outbox.markInFlight).toHaveBeenCalledWith('rename', 901);
  });

  test('a file with no baseline version sends the version the fresh inventory lists', async () => {
    const engine = makeEngine({
      entries: [['901', fileEntry({ structureVersion: null })]],
      nodes: [{ id: 901, type: 'site', etag: ETAG, structureVersion: 'sv-fresh' }]
    });

    await engine._apiRenameNode('901', 'b.html');

    expect(engine.fetchAndCacheServerNodes).toHaveBeenCalledWith(0);
    expect(renameNode).toHaveBeenCalledWith(engine.conn, 901, 'b.html', { expectedVersion: 'sv-fresh' });
  });

  test('a fresh etag the baseline has never seen rejects instead of overwriting it', async () => {
    const engine = makeEngine({
      entries: [['901', fileEntry({ structureVersion: null })]],
      nodes: [{ id: 901, type: 'site', etag: 'etag-2', structureVersion: 'sv-fresh' }]
    });

    await expect(engine._apiRenameNode('901', 'b.html')).rejects.toMatchObject({
      statusCode: 409,
      code: 'node-changed'
    });

    expect(renameNode).not.toHaveBeenCalled();
    expect(engine.outbox.markInFlight).not.toHaveBeenCalled();
  });

  test('a folder delete reads the fresh version and keeps cascade', async () => {
    const engine = makeEngine({
      entries: [['55', folderEntry({ structureVersion: 'old' })]],
      nodes: [{ id: 55, type: 'folder', structureVersion: 'sv-fresh' }]
    });

    await engine._apiDeleteNode('55', { cascade: true });

    expect(engine.fetchAndCacheServerNodes).toHaveBeenCalledWith(0);
    expect(deleteNode).toHaveBeenCalledWith(engine.conn, 55, { cascade: true, expectedVersion: 'sv-fresh' });
  });

  test('protocol 1 reads nothing and sends no precondition', async () => {
    const engine = makeEngine({
      protocol: 1,
      entries: [['901', fileEntry({ structureVersion: SV_OLD })]],
      nodes: [{ id: 901, type: 'site', etag: ETAG, structureVersion: 'sv-fresh' }]
    });

    await engine._apiRenameNode('901', 'b.html');
    await engine._apiMoveNode('901', 0);
    await engine._apiDeleteNode('901');

    expect(engine.fetchAndCacheServerNodes).not.toHaveBeenCalled();
    expect(renameNode.mock.calls[0][3]).toBeUndefined();
    expect(moveNode.mock.calls[0][3]).toBeUndefined();
    expect(deleteNode.mock.calls[0][2].expectedVersion).toBeUndefined();
  });

  test('a rename and a move both drop the baseline version they just spent', async () => {
    const engine = makeEngine({
      entries: [['901', fileEntry({ structureVersion: SV_OLD })]],
      nodes: []
    });

    await engine._apiRenameNode('901', 'b.html');
    expect(engine.repo.getBaseline('901').structureVersion).toBeNull();

    await engine._apiMoveNode('901', 0);
    expect(engine.repo.getBaseline('901').structureVersion).toBeNull();
  });
});

/**
 * End-to-end chokidar burst tests for the sync engine watcher.
 *
 * Purpose: lock in correctness of folder/file rename/move/move+rename/delete
 * across every nesting depth, especially folders with deeply-nested subtrees.
 *
 * These tests simulate the actual chokidar event sequence (`unlink`/`unlinkDir`
 * followed by `add`/`addDir`), advance fake timers past the grace + identity
 * windows, and assert server-facing outcomes via the mocked api-client.
 *
 * The key invariant every test enforces: a rename/move of a folder must NEVER
 * result in `deleteNode` calls for its descendants — the server cascades the
 * folder op to descendants by itself. Prior to the accompanying engine-watcher
 * fix, descendant `unlink` events armed `_registerPendingUnlink` timers that
 * were never cancelled (the corresponding `add` events at new paths were
 * cascade-suppressed), so every descendant was silently deleted on the server
 * 3 seconds after a folder rename.
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('eventsource', () => ({
  EventSource: jest.fn()
}));

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    notify: jest.fn(),
    broadcast: jest.fn(),
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastFileSaved: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const fileOps = require('../../src/sync-engine/file-operations');
const nodeMapModule = require('../../src/sync-engine/node-map');
const { renameNode, moveNode, deleteNode } = require('../../src/sync-engine/api-client');
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

let syncEngine;

// Matches the constant inside engine-watcher.js `_registerPendingUnlink`.
const UNLINK_GRACE_PERIOD = 3000;
// Budget for settling all microtasks + timers after a burst. The old
// event-timed folder-identity wait is gone, but keep a buffer for the
// content scan + API roundtrip + any chained microtasks.
const SETTLE_BUDGET = UNLINK_GRACE_PERIOD + 3500;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.isRunning = true;
  syncEngine.repo.seed([]);
  syncEngine.pendingUnlinks = new Map();
  syncEngine.outbox = new Outbox();
  syncEngine.cascade = new CascadeSuppression();
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  syncEngine.invalidateServerNodesCache = jest.fn();

  // The watcher's fs-side handlers call these without needing a real watcher.
  fileOps.readFile = jest.fn().mockResolvedValue('');
  fileOps.readFileBuffer = jest.fn().mockResolvedValue(Buffer.alloc(0));
  fileOps.calculateBufferChecksum = jest.fn(() => 'buffer-chk');
  fileOps.moveFile = jest.fn().mockResolvedValue();
  fileOps.ensureDirectory = jest.fn().mockResolvedValue();
  fileOps.fileExists = jest.fn().mockResolvedValue(true);

  nodeMapModule.getInode = jest.fn().mockResolvedValue(999);
  nodeMapModule.save = jest.fn().mockResolvedValue();
  nodeMapModule.load = jest.fn().mockResolvedValue(new Map());
  nodeMapModule.loadState = jest.fn().mockResolvedValue({});
  nodeMapModule.saveState = jest.fn().mockResolvedValue();

  // Use the real walkDescendants (prefix scan on the repo's internal Map) so
  // the fix under test actually walks the seeded repo contents.
  const realWalk = jest.requireActual('../../src/sync-engine/node-map').walkDescendants;
  nodeMapModule.walkDescendants = jest.fn(realWalk);

  // Queue / uploader side-effects — stub to no-op so a stray `add` event
  // can't silently succeed by triggering a real upload path.
  syncEngine.queueSync = jest.fn();
  syncEngine._handleSiteAdd = jest.fn();
  syncEngine._handleUploadAdd = jest.fn();
  syncEngine._handleFolderAdd = jest.fn();
  syncEngine._handleSiteChange = jest.fn();
  syncEngine._handleUploadChange = jest.fn();

  renameNode.mockResolvedValue({ success: true });
  moveNode.mockResolvedValue({ success: true });
  deleteNode.mockResolvedValue({ success: true });
});

afterEach(() => {
  for (const { timerId } of syncEngine.pendingUnlinks.values()) clearTimeout(timerId);
  syncEngine.pendingUnlinks.clear();
  jest.useRealTimers();
});

// ===========================================================================
// Test helpers
// ===========================================================================

/**
 * Seed the repo with a folder tree. `tree` is an array of nodes where each
 * node is either:
 *   { id, type: 'folder', path, parentId?, inode? }
 *   { id, type: 'site' | 'upload', path, parentId?, checksum?, inode? }
 *
 * Returns the same array for call-site convenience.
 */
function seedRepo(tree) {
  for (const node of tree) {
    const entry = { type: node.type, path: node.path };
    if (node.parentId !== undefined) entry.parentId = node.parentId;
    if (node.checksum !== undefined) entry.checksum = node.checksum;
    entry.inode = node.inode !== undefined ? node.inode : 999;
    syncEngine.repo._map.set(String(node.id), entry);
  }
  return tree;
}

/**
 * Fire a sequence of chokidar-like events through the engine's event shims.
 * `events` is an array of [eventType, relativePath] pairs.
 */
function fireEvents(events) {
  for (const [type, p] of events) {
    switch (type) {
      case 'add':       syncEngine._onAdd(p); break;
      case 'addDir':    syncEngine._onAddDir(p); break;
      case 'change':    syncEngine._onChange(p); break;
      case 'unlink':    syncEngine._onUnlink(p); break;
      case 'unlinkDir': syncEngine._onUnlinkDir(p); break;
      default: throw new Error(`Unknown event type: ${type}`);
    }
  }
}

/**
 * Advance fake timers and flush microtasks enough to settle any pending
 * correlation (grace period + identity wait + API promise resolution).
 */
async function settle(ms = SETTLE_BUDGET) {
  await jest.advanceTimersByTimeAsync(ms);
  // Extra microtask flush for any chained then/catch that settled on the
  // last tick of the timer advance.
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Build the list of chokidar events for a folder rename/move/move+rename.
 * `descendants` is the flat list of entries under `oldPath`:
 *   [{ type: 'folder'|'site'|'upload', relPath: 'sub/leaf.html' }, ...]
 *
 * Event order: parent unlinkDir → children unlinks (depth-first, deepest
 * first for folders) → new parent addDir → children adds (shallowest first).
 * Real chokidar ordering varies by OS; the engine must be correct under any
 * order, but we pick a consistent one here to keep tests deterministic.
 */
function folderOpEvents(oldPath, newPath, descendants) {
  const events = [];
  events.push(['unlinkDir', oldPath]);

  // Emit descendant unlinks deepest-first (children before their folder) so
  // the engine's pending-unlink tracking is tested against a realistic stream.
  const sortedForUnlink = [...descendants].sort(
    (a, b) => depth(b.relPath) - depth(a.relPath)
  );
  for (const d of sortedForUnlink) {
    const p = `${oldPath}/${d.relPath}`;
    events.push([d.type === 'folder' ? 'unlinkDir' : 'unlink', p]);
  }

  events.push(['addDir', newPath]);

  // Emit descendant adds shallowest-first (folder before its children).
  const sortedForAdd = [...descendants].sort(
    (a, b) => depth(a.relPath) - depth(b.relPath)
  );
  for (const d of sortedForAdd) {
    const p = `${newPath}/${d.relPath}`;
    events.push([d.type === 'folder' ? 'addDir' : 'add', p]);
  }

  return events;
}

/**
 * Build a folder rename/move/move+rename event burst where descendant unlinks
 * at the OLD path arrive AFTER `addDir new` (and even after descendant adds).
 *
 * Real chokidar can deliver descendant events after a folder-level event in
 * this order — especially for large subtrees, slow disks, or network mounts.
 * The engine must stay correct under this ordering: the correlation runs on
 * the first `addDir new`, clears the folder's pending-unlink, and must also
 * suppress late descendant unlinks at old paths so they don't arm spurious
 * delete timers against nodes we just moved on the server.
 *
 * Order produced:
 *   unlinkDir old → addDir new → descendant adds (new paths) → LATE descendant
 *   unlinks (old paths, deepest first)
 */
function folderOpEventsLateDescendantUnlinks(oldPath, newPath, descendants) {
  const events = [];
  events.push(['unlinkDir', oldPath]);
  events.push(['addDir', newPath]);

  const sortedForAdd = [...descendants].sort(
    (a, b) => depth(a.relPath) - depth(b.relPath)
  );
  for (const d of sortedForAdd) {
    const p = `${newPath}/${d.relPath}`;
    events.push([d.type === 'folder' ? 'addDir' : 'add', p]);
  }

  const sortedForUnlink = [...descendants].sort(
    (a, b) => depth(b.relPath) - depth(a.relPath)
  );
  for (const d of sortedForUnlink) {
    const p = `${oldPath}/${d.relPath}`;
    events.push([d.type === 'folder' ? 'unlinkDir' : 'unlink', p]);
  }

  return events;
}

function folderDeleteEvents(folderPath, descendants) {
  const events = [];
  const sortedForUnlink = [...descendants].sort(
    (a, b) => depth(b.relPath) - depth(a.relPath)
  );
  for (const d of sortedForUnlink) {
    const p = `${folderPath}/${d.relPath}`;
    events.push([d.type === 'folder' ? 'unlinkDir' : 'unlink', p]);
  }
  events.push(['unlinkDir', folderPath]);
  return events;
}

function depth(relPath) {
  return relPath.split('/').filter(Boolean).length;
}

// A representative deep subtree: 3 levels of folders, files at multiple depths.
// When placed under a parent at depth D, leaves end up at absolute depth D+4.
function deepSubtree() {
  return [
    { type: 'site',   relPath: 'top.html' },
    { type: 'folder', relPath: 'sub' },
    { type: 'site',   relPath: 'sub/mid.html' },
    { type: 'folder', relPath: 'sub/inner' },
    { type: 'upload', relPath: 'sub/inner/data.png' },
    { type: 'folder', relPath: 'sub/inner/deeper' },
    { type: 'site',   relPath: 'sub/inner/deeper/leaf.html' }
  ];
}

/**
 * Seed an anchor folder at `anchorPath` plus each descendant under it.
 * Returns the folder nodeId for convenience.
 */
function seedFolderWithSubtree(anchorPath, subtree, startId = 100) {
  const tree = [{ id: startId, type: 'folder', path: anchorPath }];
  let nextId = startId + 1;
  for (const d of subtree) {
    tree.push({ id: nextId++, type: d.type, path: `${anchorPath}/${d.relPath}` });
  }
  seedRepo(tree);
  return startId;
}

/**
 * Seed intermediate folders along a path so `resolveParentIdByPath` can
 * find them. e.g. ancestors('a/b/c') seeds folders 'a', 'a/b', 'a/b/c'.
 * Returns the map of pathString → nodeId for the new folders.
 */
function seedAncestors(anchorPath, startId = 500) {
  const parts = anchorPath.split('/').filter(Boolean);
  const result = new Map();
  let cumulative = '';
  let id = startId;
  for (const part of parts) {
    cumulative = cumulative ? `${cumulative}/${part}` : part;
    seedRepo([{ id: id, type: 'folder', path: cumulative }]);
    result.set(cumulative, id);
    id += 1;
  }
  return result;
}

/**
 * Assert that the engine issued NO `deleteNode` API call at all.
 * This is the single most important assertion across the folder suite —
 * rename/move/move+rename should cascade on the server and never trigger
 * client-side delete calls for descendants.
 */
function expectNoDeleteCalls() {
  expect(deleteNode).not.toHaveBeenCalled();
}

// ===========================================================================
// File burst tests — rename / move / move+rename / delete at every depth
// ===========================================================================

describe('chokidar burst: file rename', () => {
  const cases = [
    { label: 'root',     oldPath: 'foo.html',           newPath: 'bar.html' },
    { label: 'depth 1',  oldPath: 'd1/foo.html',        newPath: 'd1/bar.html' },
    { label: 'depth 2',  oldPath: 'd1/d2/foo.html',     newPath: 'd1/d2/bar.html' },
    { label: 'depth 3',  oldPath: 'd1/d2/d3/foo.html',  newPath: 'd1/d2/d3/bar.html' },
    { label: 'depth 4',  oldPath: 'd1/d2/d3/d4/foo.html', newPath: 'd1/d2/d3/d4/bar.html' }
  ];

  for (const { label, oldPath, newPath } of cases) {
    it(`${label}: ${oldPath} → ${newPath}`, async () => {
      const ancestor = oldPath.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      seedRepo([{ id: 42, type: 'site', path: oldPath, checksum: 'chk', inode: 100 }]);

      nodeMapModule.getInode.mockResolvedValue(100); // inode match → same-file

      fireEvents([['unlink', oldPath], ['add', newPath]]);
      await settle();

      expect(renameNode).toHaveBeenCalledTimes(1);
      expect(renameNode).toHaveBeenCalledWith('http://test', 'test-key', 42, 'bar.html');
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);
      expect(syncEngine.repo.get('42').path).toBe(newPath);
    });
  }
});

describe('chokidar burst: file move', () => {
  const cases = [
    { label: 'root → depth 1',  oldPath: 'foo.html',             newPath: 'd1/foo.html' },
    { label: 'depth 1 → root',  oldPath: 'd1/foo.html',          newPath: 'foo.html' },
    { label: 'depth 1 → depth 3', oldPath: 'd1/foo.html',        newPath: 'd1/d2/d3/foo.html' },
    { label: 'depth 3 → depth 1', oldPath: 'd1/d2/d3/foo.html',  newPath: 'd1/foo.html' }
  ];

  for (const { label, oldPath, newPath } of cases) {
    it(`${label}: ${oldPath} → ${newPath}`, async () => {
      const newAncestor = newPath.split('/').slice(0, -1).join('/');
      const oldAncestor = oldPath.split('/').slice(0, -1).join('/');
      if (newAncestor) seedAncestors(newAncestor, 500);
      if (oldAncestor && oldAncestor !== newAncestor) seedAncestors(oldAncestor, 700);

      seedRepo([{ id: 42, type: 'site', path: oldPath, checksum: 'chk', inode: 100 }]);
      nodeMapModule.getInode.mockResolvedValue(100);

      fireEvents([['unlink', oldPath], ['add', newPath]]);
      await settle();

      expect(moveNode).toHaveBeenCalledTimes(1);
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);
      expect(syncEngine.repo.get('42').path).toBe(newPath);
    });
  }
});

describe('chokidar burst: file move+rename', () => {
  const cases = [
    { label: 'root → depth 1', oldPath: 'foo.html',          newPath: 'd1/bar.html' },
    { label: 'depth 2 → depth 1', oldPath: 'd1/d2/foo.html', newPath: 'd1/bar.html' },
    { label: 'depth 3 → depth 3 (cross)', oldPath: 'a/b/c/foo.html', newPath: 'x/y/z/bar.html' }
  ];

  for (const { label, oldPath, newPath } of cases) {
    it(`${label}: ${oldPath} → ${newPath}`, async () => {
      const newAncestor = newPath.split('/').slice(0, -1).join('/');
      const oldAncestor = oldPath.split('/').slice(0, -1).join('/');
      if (newAncestor) seedAncestors(newAncestor, 500);
      if (oldAncestor) seedAncestors(oldAncestor, 700);

      seedRepo([{ id: 42, type: 'site', path: oldPath, checksum: 'chk', inode: 100 }]);
      nodeMapModule.getInode.mockResolvedValue(100);

      fireEvents([['unlink', oldPath], ['add', newPath]]);
      await settle();

      expect(moveNode).toHaveBeenCalledTimes(1);
      const callArgs = moveNode.mock.calls[0];
      expect(callArgs[2]).toBe(42);
      expect(callArgs[4]).toBe('bar.html');
      expect(renameNode).not.toHaveBeenCalled();
      expectNoDeleteCalls();
    });
  }
});

describe('chokidar burst: file delete', () => {
  const cases = [
    { label: 'root',    path: 'foo.html' },
    { label: 'depth 1', path: 'd1/foo.html' },
    { label: 'depth 3', path: 'd1/d2/d3/foo.html' },
    { label: 'depth 4', path: 'd1/d2/d3/d4/foo.html' }
  ];

  for (const { label, path: p } of cases) {
    it(`${label}: ${p}`, async () => {
      const ancestor = p.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      seedRepo([{ id: 42, type: 'site', path: p, checksum: 'chk', inode: 100 }]);

      fireEvents([['unlink', p]]);
      await settle();

      expect(deleteNode).toHaveBeenCalledTimes(1);
      expect(deleteNode).toHaveBeenCalledWith('http://test', 'test-key', 42);
      expect(syncEngine.pendingUnlinks.size).toBe(0);
      expect(syncEngine.repo.has('42')).toBe(false);
    });
  }
});

// ===========================================================================
// Folder burst tests — the regression suite for the descendant-cancel fix
// ===========================================================================

describe('chokidar burst: empty folder rename', () => {
  const cases = [
    { label: 'root',     oldPath: 'proj',        newPath: 'proj-x' },
    { label: 'depth 1',  oldPath: 'a/proj',      newPath: 'a/proj-x' },
    { label: 'depth 3',  oldPath: 'a/b/c/proj',  newPath: 'a/b/c/proj-x' },
    { label: 'depth 4',  oldPath: 'a/b/c/d/proj', newPath: 'a/b/c/d/proj-x' }
  ];

  for (const { label, oldPath, newPath } of cases) {
    it(`${label}: ${oldPath} → ${newPath}`, async () => {
      const ancestor = oldPath.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      seedRepo([{ id: 100, type: 'folder', path: oldPath, inode: 777 }]);
      nodeMapModule.getInode.mockResolvedValue(777);

      fireEvents(folderOpEvents(oldPath, newPath, []));
      await settle();

      expect(renameNode).toHaveBeenCalledTimes(1);
      expect(renameNode).toHaveBeenCalledWith(
        'http://test', 'test-key', 100, newPath.split('/').pop()
      );
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);
      expect(syncEngine.repo.get('100').path).toBe(newPath);
    });
  }
});

describe('chokidar burst: folder with one direct child — rename', () => {
  const cases = [
    { label: 'root',     oldPath: 'proj',       newPath: 'proj-x' },
    { label: 'depth 3',  oldPath: 'a/b/c/proj', newPath: 'a/b/c/proj-x' }
  ];

  for (const { label, oldPath, newPath } of cases) {
    it(`${label}: renaming ${oldPath} → ${newPath} must NOT delete child`, async () => {
      const ancestor = oldPath.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      seedRepo([
        { id: 100, type: 'folder', path: oldPath, inode: 777 },
        { id: 101, type: 'site', path: `${oldPath}/leaf.html`, checksum: 'lc', inode: 101 }
      ]);
      nodeMapModule.getInode.mockResolvedValue(777);

      fireEvents(folderOpEvents(oldPath, newPath, [{ type: 'site', relPath: 'leaf.html' }]));
      await settle();

      expect(renameNode).toHaveBeenCalledTimes(1);
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);
      expect(syncEngine.repo.get('100').path).toBe(newPath);
      expect(syncEngine.repo.get('101').path).toBe(`${newPath}/leaf.html`);
    });
  }
});

describe('chokidar burst: folder with deep subtree — rename', () => {
  const cases = [
    { label: 'root',     anchor: 'proj',         newAnchor: 'proj-x' },
    { label: 'depth 1',  anchor: 'a/proj',       newAnchor: 'a/proj-x' },
    { label: 'depth 3',  anchor: 'a/b/c/proj',   newAnchor: 'a/b/c/proj-x' },
    { label: 'depth 4',  anchor: 'a/b/c/d/proj', newAnchor: 'a/b/c/d/proj-x' }
  ];

  for (const { label, anchor, newAnchor } of cases) {
    it(`${label}: ${anchor} → ${newAnchor} preserves every descendant`, async () => {
      const ancestor = anchor.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      const subtree = deepSubtree();
      seedFolderWithSubtree(anchor, subtree);
      nodeMapModule.getInode.mockResolvedValue(999);

      fireEvents(folderOpEvents(anchor, newAnchor, subtree));
      await settle();

      expect(renameNode).toHaveBeenCalledTimes(1);
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      expect(syncEngine.repo.get('100').path).toBe(newAnchor);
      for (let i = 0; i < subtree.length; i++) {
        const nodeId = String(100 + 1 + i);
        const expected = `${newAnchor}/${subtree[i].relPath}`;
        expect(syncEngine.repo.get(nodeId).path).toBe(expected);
      }
    });
  }
});

describe('chokidar burst: folder with deep subtree — move', () => {
  const cases = [
    { label: 'root → depth 1', anchor: 'proj',     newAnchor: 'archive/proj' },
    { label: 'depth 2 → root', anchor: 'a/b/proj', newAnchor: 'proj' },
    { label: 'depth 1 → depth 3', anchor: 'a/proj', newAnchor: 'x/y/z/proj' }
  ];

  for (const { label, anchor, newAnchor } of cases) {
    it(`${label}: ${anchor} → ${newAnchor}`, async () => {
      const oldAncestor = anchor.split('/').slice(0, -1).join('/');
      const newAncestor = newAnchor.split('/').slice(0, -1).join('/');
      if (oldAncestor) seedAncestors(oldAncestor, 500);
      if (newAncestor && newAncestor !== oldAncestor) seedAncestors(newAncestor, 700);

      const subtree = deepSubtree();
      seedFolderWithSubtree(anchor, subtree);
      nodeMapModule.getInode.mockResolvedValue(999);

      fireEvents(folderOpEvents(anchor, newAnchor, subtree));
      await settle();

      expect(moveNode).toHaveBeenCalledTimes(1);
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      expect(syncEngine.repo.get('100').path).toBe(newAnchor);
      for (let i = 0; i < subtree.length; i++) {
        const nodeId = String(100 + 1 + i);
        expect(syncEngine.repo.get(nodeId).path).toBe(`${newAnchor}/${subtree[i].relPath}`);
      }
    });
  }
});

describe('chokidar burst: folder with deep subtree — move+rename', () => {
  const cases = [
    { label: 'root → depth 1 + rename',   anchor: 'proj',     newAnchor: 'archive/proj-x' },
    { label: 'depth 1 → depth 3 + rename', anchor: 'a/proj',  newAnchor: 'x/y/z/proj-x' }
  ];

  for (const { label, anchor, newAnchor } of cases) {
    it(`${label}: ${anchor} → ${newAnchor}`, async () => {
      const oldAncestor = anchor.split('/').slice(0, -1).join('/');
      const newAncestor = newAnchor.split('/').slice(0, -1).join('/');
      if (oldAncestor) seedAncestors(oldAncestor, 500);
      if (newAncestor && newAncestor !== oldAncestor) seedAncestors(newAncestor, 700);

      const subtree = deepSubtree();
      seedFolderWithSubtree(anchor, subtree);
      nodeMapModule.getInode.mockResolvedValue(999);

      fireEvents(folderOpEvents(anchor, newAnchor, subtree));
      await settle();

      expect(moveNode).toHaveBeenCalledTimes(1);
      // move+rename passes the new basename as the 5th arg.
      expect(moveNode.mock.calls[0][4]).toBe(newAnchor.split('/').pop());
      expect(renameNode).not.toHaveBeenCalled();
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      expect(syncEngine.repo.get('100').path).toBe(newAnchor);
      for (let i = 0; i < subtree.length; i++) {
        const nodeId = String(100 + 1 + i);
        expect(syncEngine.repo.get(nodeId).path).toBe(`${newAnchor}/${subtree[i].relPath}`);
      }
    });
  }
});

// ===========================================================================
// Late-unlink ordering — the real-world chokidar order this suite previously
// missed. Descendant unlinks at OLD paths arrive AFTER `addDir new` and after
// descendant adds at new paths. The engine must not arm fresh pending-unlinks
// that later fire against nodes we've already moved on the server.
// ===========================================================================

describe('chokidar burst: folder with deep subtree — rename (late descendant unlinks)', () => {
  const cases = [
    { label: 'root',     anchor: 'proj',         newAnchor: 'proj-x' },
    { label: 'depth 1',  anchor: 'a/proj',       newAnchor: 'a/proj-x' },
    { label: 'depth 3',  anchor: 'a/b/c/proj',   newAnchor: 'a/b/c/proj-x' },
    { label: 'depth 4',  anchor: 'a/b/c/d/proj', newAnchor: 'a/b/c/d/proj-x' }
  ];

  for (const { label, anchor, newAnchor } of cases) {
    it(`${label}: ${anchor} → ${newAnchor} survives late descendant unlinks`, async () => {
      const ancestor = anchor.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      const subtree = deepSubtree();
      seedFolderWithSubtree(anchor, subtree);
      nodeMapModule.getInode.mockResolvedValue(999);

      fireEvents(folderOpEventsLateDescendantUnlinks(anchor, newAnchor, subtree));
      await settle();

      expect(renameNode).toHaveBeenCalledTimes(1);
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      expect(syncEngine.repo.get('100').path).toBe(newAnchor);
      for (let i = 0; i < subtree.length; i++) {
        const nodeId = String(100 + 1 + i);
        expect(syncEngine.repo.get(nodeId).path).toBe(`${newAnchor}/${subtree[i].relPath}`);
      }
    });
  }
});

describe('chokidar burst: folder with deep subtree — move (late descendant unlinks)', () => {
  const cases = [
    { label: 'root → depth 1', anchor: 'proj',     newAnchor: 'archive/proj' },
    { label: 'depth 2 → root', anchor: 'a/b/proj', newAnchor: 'proj' },
    { label: 'depth 1 → depth 3', anchor: 'a/proj', newAnchor: 'x/y/z/proj' }
  ];

  for (const { label, anchor, newAnchor } of cases) {
    it(`${label}: ${anchor} → ${newAnchor} survives late descendant unlinks`, async () => {
      const oldAncestor = anchor.split('/').slice(0, -1).join('/');
      const newAncestor = newAnchor.split('/').slice(0, -1).join('/');
      if (oldAncestor) seedAncestors(oldAncestor, 500);
      if (newAncestor && newAncestor !== oldAncestor) seedAncestors(newAncestor, 700);

      const subtree = deepSubtree();
      seedFolderWithSubtree(anchor, subtree);
      nodeMapModule.getInode.mockResolvedValue(999);

      fireEvents(folderOpEventsLateDescendantUnlinks(anchor, newAnchor, subtree));
      await settle();

      expect(moveNode).toHaveBeenCalledTimes(1);
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      expect(syncEngine.repo.get('100').path).toBe(newAnchor);
      for (let i = 0; i < subtree.length; i++) {
        const nodeId = String(100 + 1 + i);
        expect(syncEngine.repo.get(nodeId).path).toBe(`${newAnchor}/${subtree[i].relPath}`);
      }
    });
  }
});

describe('chokidar burst: folder with deep subtree — move+rename (late descendant unlinks)', () => {
  const cases = [
    { label: 'root → depth 1 + rename',    anchor: 'proj',    newAnchor: 'archive/proj-x' },
    { label: 'depth 1 → depth 3 + rename', anchor: 'a/proj',  newAnchor: 'x/y/z/proj-x' }
  ];

  for (const { label, anchor, newAnchor } of cases) {
    it(`${label}: ${anchor} → ${newAnchor} survives late descendant unlinks`, async () => {
      const oldAncestor = anchor.split('/').slice(0, -1).join('/');
      const newAncestor = newAnchor.split('/').slice(0, -1).join('/');
      if (oldAncestor) seedAncestors(oldAncestor, 500);
      if (newAncestor && newAncestor !== oldAncestor) seedAncestors(newAncestor, 700);

      const subtree = deepSubtree();
      seedFolderWithSubtree(anchor, subtree);
      nodeMapModule.getInode.mockResolvedValue(999);

      fireEvents(folderOpEventsLateDescendantUnlinks(anchor, newAnchor, subtree));
      await settle();

      expect(moveNode).toHaveBeenCalledTimes(1);
      expect(moveNode.mock.calls[0][4]).toBe(newAnchor.split('/').pop());
      expect(renameNode).not.toHaveBeenCalled();
      expectNoDeleteCalls();
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      expect(syncEngine.repo.get('100').path).toBe(newAnchor);
      for (let i = 0; i < subtree.length; i++) {
        const nodeId = String(100 + 1 + i);
        expect(syncEngine.repo.get(nodeId).path).toBe(`${newAnchor}/${subtree[i].relPath}`);
      }
    });
  }
});

describe('chokidar burst: folder delete', () => {
  // Folder delete via the watcher is fundamentally different from rename/move:
  // there is no matching addDir, so `_correlateFolderUnlinkAdd` never runs.
  // The folder's own pending-unlink timer fires, issues deleteNode for the
  // folder, and the server cascades the delete to every descendant.
  //
  // Descendant pending-unlinks are cancelled when the folder's timer fires
  // (see engine-watcher.js `_registerPendingUnlink`), so the client issues
  // exactly ONE deleteNode call — for the folder itself. Without this, each
  // descendant's independent timer would fire against an already-cascaded
  // node, producing spurious 404s per folder-with-N-descendants deleted.

  const cases = [
    { label: 'empty, root',           anchor: 'proj',      descendants: [] },
    { label: 'empty, depth 3',        anchor: 'a/b/c/proj', descendants: [] },
    { label: 'with subtree, root',    anchor: 'proj',      descendants: deepSubtree() },
    { label: 'with subtree, depth 3', anchor: 'a/b/c/proj', descendants: deepSubtree() }
  ];

  for (const { label, anchor, descendants } of cases) {
    it(label, async () => {
      const ancestor = anchor.split('/').slice(0, -1).join('/');
      if (ancestor) seedAncestors(ancestor);
      seedFolderWithSubtree(anchor, descendants);

      fireEvents(folderDeleteEvents(anchor, descendants));
      await settle();

      // Exactly one deleteNode call — the folder itself. Server cascades the
      // delete to all descendants on its side.
      expect(deleteNode).toHaveBeenCalledTimes(1);
      expect(deleteNode).toHaveBeenCalledWith('http://test', 'test-key', 100);

      // All pending-unlink timers must have drained.
      expect(syncEngine.pendingUnlinks.size).toBe(0);

      // Repo reflects the delete — folder and every descendant removed.
      expect(syncEngine.repo.has('100')).toBe(false);
      for (let i = 0; i < descendants.length; i++) {
        expect(syncEngine.repo.has(String(101 + i))).toBe(false);
      }
    });
  }
});

// ===========================================================================
// Direct-correlator regression: the exact case that caused data loss in QA.
// This test would have failed before the engine-watcher fix; keep it pinned.
// ===========================================================================

describe('_correlateFolderUnlinkAdd: descendant pending-unlinks are cancelled', () => {
  it('a folder rename with a descendant pending-unlink does not call deleteNode', async () => {
    seedRepo([
      { id: 100, type: 'folder', path: 'test-rename', inode: 777 },
      { id: 101, type: 'site', path: 'test-rename/new-hours-test.html', checksum: 'h', inode: 101 }
    ]);
    nodeMapModule.getInode.mockResolvedValue(777);

    // Arm a pending unlink for the descendant, as the watcher would when
    // chokidar reports `unlink test-rename/new-hours-test.html` during a
    // folder rename.
    syncEngine._registerPendingUnlink('test-rename/new-hours-test.html', 'site');
    expect(syncEngine.pendingUnlinks.has('test-rename/new-hours-test.html')).toBe(true);

    const pending = {
      nodeId: '100',
      type: 'folder',
      entry: { type: 'folder', path: 'test-rename', inode: 777 }
    };

    await syncEngine._correlateFolderUnlinkAdd(
      'test-rename',
      'test-rename-1',
      pending,
      'rename'
    );

    await settle();

    // Descendant's pending timer must have been cancelled — NOT expired
    // into a delete API call.
    expect(deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.pendingUnlinks.has('test-rename/new-hours-test.html')).toBe(false);
    expect(renameNode).toHaveBeenCalledTimes(1);
  });

  it('nested subtree: pending-unlinks at every depth are cancelled', async () => {
    seedRepo([
      { id: 100, type: 'folder', path: 'proj', inode: 777 },
      { id: 101, type: 'folder', path: 'proj/sub' },
      { id: 102, type: 'folder', path: 'proj/sub/deep' },
      { id: 103, type: 'site',   path: 'proj/sub/deep/leaf.html', checksum: 'l', inode: 103 },
      { id: 104, type: 'upload', path: 'proj/sub/deep/data.png', checksum: 'd', inode: 104 }
    ]);
    nodeMapModule.getInode.mockResolvedValue(777);

    // Register in real chokidar event order (leaves first, folders bottom-up).
    // Each registration after the first is cancelled by the register-time
    // folder-descendant cascade: as soon as a folder unlink is registered, any
    // earlier descendant pendings are cancelled.
    syncEngine._registerPendingUnlink('proj/sub/deep/leaf.html', 'site');
    syncEngine._registerPendingUnlink('proj/sub/deep/data.png', 'upload');
    syncEngine._registerPendingUnlink('proj/sub/deep', 'folder');
    syncEngine._registerPendingUnlink('proj/sub', 'folder');
    // Final state: only `proj/sub` remains pending (its own descendants cancelled).
    expect(syncEngine.pendingUnlinks.size).toBe(1);
    expect(syncEngine.pendingUnlinks.has('proj/sub')).toBe(true);

    const pending = {
      nodeId: '100',
      type: 'folder',
      entry: { type: 'folder', path: 'proj', inode: 777 }
    };

    // `_correlateFolderUnlinkAdd` also cancels descendants found in the repo —
    // belt-and-suspenders alongside the register-time cascade.
    await syncEngine._correlateFolderUnlinkAdd('proj', 'proj-x', pending, 'rename');
    await settle();

    expect(deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.pendingUnlinks.size).toBe(0);
    expect(renameNode).toHaveBeenCalledTimes(1);
  });
});

describe('folder delete: descendant pending-unlinks are cancelled (no 404 spam)', () => {
  it('deleting a folder with N descendants issues exactly 1 deleteNode call', async () => {
    seedRepo([
      { id: 100, type: 'folder', path: 'proj', inode: 777 },
      { id: 101, type: 'folder', path: 'proj/sub' },
      { id: 102, type: 'folder', path: 'proj/sub/deep' },
      { id: 103, type: 'site',   path: 'proj/sub/deep/leaf.html', checksum: 'l', inode: 103 },
      { id: 104, type: 'upload', path: 'proj/sub/deep/data.png', checksum: 'd', inode: 104 },
      { id: 105, type: 'site',   path: 'proj/top.html', checksum: 't', inode: 105 }
    ]);

    // Fire the full delete burst: children deepest-first, folder last.
    fireEvents([
      ['unlink',    'proj/sub/deep/leaf.html'],
      ['unlink',    'proj/sub/deep/data.png'],
      ['unlinkDir', 'proj/sub/deep'],
      ['unlinkDir', 'proj/sub'],
      ['unlink',    'proj/top.html'],
      ['unlinkDir', 'proj']
    ]);

    // Register-time cascade collapses all descendants into the top-most folder
    // pending-unlink. By the time `unlinkDir proj` is processed, every
    // descendant pending is cancelled, leaving just one entry.
    expect(syncEngine.pendingUnlinks.size).toBe(1);
    expect(syncEngine.pendingUnlinks.has('proj')).toBe(true);

    await settle();

    // Exactly one server-side delete — the folder. Descendants were cancelled
    // before their timers could fire.
    expect(deleteNode).toHaveBeenCalledTimes(1);
    expect(deleteNode).toHaveBeenCalledWith('http://test', 'test-key', 100);

    // Repo fully cleaned up.
    expect(syncEngine.pendingUnlinks.size).toBe(0);
    expect(syncEngine.repo.size).toBe(0);
  });

  it('deleting nested sibling folders: each folder gets one delete, descendants cancelled', async () => {
    // Two sibling folders at different depths, both deleted together.
    seedRepo([
      { id: 100, type: 'folder', path: 'a' },
      { id: 101, type: 'site',   path: 'a/one.html',   checksum: '1' },
      { id: 200, type: 'folder', path: 'b' },
      { id: 201, type: 'folder', path: 'b/inner' },
      { id: 202, type: 'site',   path: 'b/inner/two.html', checksum: '2' }
    ]);

    fireEvents([
      ['unlink',    'a/one.html'],
      ['unlinkDir', 'a'],
      ['unlink',    'b/inner/two.html'],
      ['unlinkDir', 'b/inner'],
      ['unlinkDir', 'b']
    ]);

    await settle();

    // One delete per top-level folder, no descendant deletes.
    expect(deleteNode).toHaveBeenCalledTimes(2);
    const deletedIds = deleteNode.mock.calls.map(c => c[2]).sort();
    expect(deletedIds).toEqual([100, 200]);
  });
});

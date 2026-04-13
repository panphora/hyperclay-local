/**
 * NodeRepository — the single owner of the nodeId → local file entry map.
 *
 * Wraps the persistence helpers in src/sync-engine/node-map.js (pure-function
 * load/save/walkDescendants/etc) behind a stateful class so that:
 *   - the engine doesn't have to call `nodeMap.save(metaDir, this.nodeMap)`
 *     after every mutation (the repo saves automatically);
 *   - batch mutations that need one persist at the end use repo.apply();
 *   - tests have a single seeding primitive (seed()) that does not need the
 *     caller to know about the private map layout;
 *   - future invariant checks and audit hooks live in one class, not sprinkled
 *     across the engine.
 *
 * Attachment lifecycle:
 *   - The engine creates the repo eagerly in its constructor with no metaDir.
 *   - init() calls attach(metaDir) before the first load/save.
 *   - Before attach(), read-only and in-memory mutations still work (useful for
 *     test seeding); persistence calls go through node-map with a null metaDir,
 *     which in production never happens and in tests is mocked out anyway.
 */

const nodeMapPersistence = require('../node-map');

class NodeRepository {
  constructor() {
    this._metaDir = null;
    this._map = new Map();
    this._logger = null;
  }

  /**
   * Bind this repository to a metadata directory. Must be called once in
   * the engine's init() before any persistence operations.
   */
  attach(metaDir) {
    this._metaDir = metaDir;
  }

  /**
   * Attach a logger so that persistence errors surface in the sync log.
   */
  attachLogger(logger) {
    this._logger = logger;
  }

  /**
   * Load the persisted node map from disk into memory. Replaces the current
   * in-memory map entirely.
   */
  async load() {
    this._map = await nodeMapPersistence.load(this._metaDir, this._logger);
  }

  /**
   * Load the sync state (last-synced timestamp, etc) from disk.
   * Separate from the node map itself.
   */
  async loadState() {
    return nodeMapPersistence.loadState(this._metaDir);
  }

  async saveState(state) {
    return nodeMapPersistence.saveState(this._metaDir, state);
  }

  // --- Read API ---

  get(nodeId) {
    return this._map.get(String(nodeId));
  }

  has(nodeId) {
    return this._map.has(String(nodeId));
  }

  get size() {
    return this._map.size;
  }

  entries() {
    return this._map.entries();
  }

  [Symbol.iterator]() {
    return this._map[Symbol.iterator]();
  }

  /**
   * Walk all descendants of a folder path using the node-map helper.
   * Returns an array of { nodeId, entry } for entries whose path starts
   * with parentPath + '/'.
   */
  walkDescendants(parentPath) {
    return nodeMapPersistence.walkDescendants(this._map, parentPath);
  }

  /**
   * Linear scan to find an entry by its local path. Returns { nodeId, entry }
   * or null. Prefer this over walking all entries in callers.
   */
  getByPath(relPath) {
    for (const [nid, entry] of this._map) {
      if (entry.path === relPath) return { nodeId: nid, entry };
    }
    return null;
  }

  // --- Write API — persistence runs after every mutation ---

  async set(nodeId, entry) {
    this._map.set(String(nodeId), entry);
    await this._save();
  }

  /**
   * In-memory only update — no disk write. Use when you need the value
   * visible immediately to synchronous code on the same tick, and a
   * full persist will happen shortly after via set() or apply().
   */
  setProvisional(nodeId, entry) {
    this._map.set(String(nodeId), entry);
  }

  async delete(nodeId) {
    this._map.delete(String(nodeId));
    await this._save();
  }

  /**
   * Batch mutation. The callback receives the raw Map and can perform any
   * number of set/delete operations; a single persist runs at the end.
   * Use this for folder relocate, cascade delete, and initial-sync loops
   * to avoid N back-to-back disk writes.
   */
  async apply(fn) {
    await fn(this._map);
    await this._save();
  }

  /**
   * Test-only bulk seed. Replaces the in-memory map contents without
   * persisting — tests should not touch disk. Accepts an iterable of
   * [nodeId, entry] pairs or another Map.
   */
  seed(entries) {
    this._map = new Map();
    if (!entries) return;
    for (const [nid, entry] of entries) {
      this._map.set(String(nid), entry);
    }
  }

  clear() {
    this._map.clear();
  }

  async _save() {
    await nodeMapPersistence.save(this._metaDir, this._map, this._logger);
  }
}

module.exports = NodeRepository;

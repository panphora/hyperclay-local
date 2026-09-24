/**
 * Mutation helpers — API calls that mutate server node state.
 *
 * Each method bundles the three-step outbox+API+cache-invalidation sequence
 * that every watcher-initiated mutation requires. Callers issue one method
 * call and get correct echo suppression and cache invalidation automatically.
 * Methods are installed onto SyncEngine.prototype.
 */

const {
  renameNode,
  moveNode,
  deleteNode
} = require('./api-client');

module.exports = {
  // CONTRACTS §4-5: a file's baseline version is kept current by downloads, uploads and noop
  // passes; a folder's changes whenever anything under it does, so it is always read fresh, as
  // is a file whose baseline has none.
  async _expectedVersion(nodeId) {
    if (this.protocol !== 2) return undefined;
    const entry = this.repo.get(nodeId);
    const baseline = this.repo.getBaseline(nodeId);
    const isFolder = entry ? entry.type === 'folder' : false;
    if (!isFolder && baseline && baseline.structureVersion) return baseline.structureVersion;
    const nodes = await this.fetchAndCacheServerNodes(0);
    const node = (nodes || []).find(n => String(n.id) === String(nodeId));
    if (!node) return undefined;
    if (!isFolder && baseline && baseline.remoteEtag && node.etag && node.etag !== baseline.remoteEtag) {
      const error = new Error(`Node ${nodeId} changed on the server since it was last synced`);
      error.statusCode = 409;
      error.code = 'node-changed';
      throw error;
    }
    return node.structureVersion;
  },

  async _apiRenameNode(nodeId, newName) {
    const gen = this.generation;
    const expectedVersion = await this._expectedVersion(nodeId);
    if (gen !== this.generation) return;
    this.outbox.markInFlight('rename', parseInt(nodeId));
    const options = expectedVersion ? [{ expectedVersion }] : [];
    await renameNode(this.conn, parseInt(nodeId), newName, ...options);
    if (gen !== this.generation) return;
    this.invalidateServerNodesCache();
    await this.repo.updateBaseline(nodeId, { structureVersion: null });
  },

  async _apiMoveNode(nodeId, parentId, newName) {
    const gen = this.generation;
    const expectedVersion = await this._expectedVersion(nodeId);
    if (gen !== this.generation) return;
    this.outbox.markInFlight('move', parseInt(nodeId));
    const args = expectedVersion
      ? [newName === undefined ? null : newName, { expectedVersion }]
      : (newName === undefined ? [] : [newName]);
    await moveNode(this.conn, parseInt(nodeId), parentId, ...args);
    if (gen !== this.generation) return;
    this.invalidateServerNodesCache();
    await this.repo.updateBaseline(nodeId, { structureVersion: null });
  },

  async _apiDeleteNode(nodeId, { cascade = false } = {}) {
    this.assertRootPresent();
    const gen = this.generation;
    const expectedVersion = await this._expectedVersion(nodeId);
    if (gen !== this.generation) return;
    this.outbox.markInFlight('delete', parseInt(nodeId));
    await deleteNode(this.conn, parseInt(nodeId), { cascade, expectedVersion });
    if (gen !== this.generation) return;
    this.invalidateServerNodesCache();
  }
};

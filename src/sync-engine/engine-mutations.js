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
const { isLockedFolder, isUnderLockedFolder, lockedFolderError } = require('./locked-folder');

module.exports = {
  /**
   * The root's `uploads` folder is never sent a rename, move or delete, and
   * nothing under it is, except by the live structure job after its hold: a
   * catch-up pass restores what is missing there instead. Refused before
   * anything is marked in flight, so no request leaves and no outbox entry is
   * left behind.
   */
  refuseLockedFolder(nodeId) {
    const entry = this.repo.get(nodeId);
    if (!entry) return;
    if (isLockedFolder(entry.path)) throw lockedFolderError();
    if (isUnderLockedFolder(entry.path) && !this._structureLive) throw lockedFolderError();
  },

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
    this.refuseLockedFolder(nodeId);
    const gen = this.generation;
    const expectedVersion = await this._expectedVersion(nodeId);
    if (gen !== this.generation) return false;
    this.outbox.markInFlight('rename', parseInt(nodeId));
    const options = expectedVersion ? [{ expectedVersion }] : [];
    await renameNode(this.conn, parseInt(nodeId), newName, ...options);
    this._mutationSeq = (this._mutationSeq || 0) + 1;
    if (gen !== this.generation) return true;
    this.invalidateServerNodesCache();
    await this.repo.updateBaseline(nodeId, { structureVersion: null });
    return true;
  },

  async _apiMoveNode(nodeId, parentId, newName) {
    this.refuseLockedFolder(nodeId);
    const gen = this.generation;
    const expectedVersion = await this._expectedVersion(nodeId);
    if (gen !== this.generation) return false;
    this.outbox.markInFlight('move', parseInt(nodeId));
    const args = expectedVersion
      ? [newName === undefined ? null : newName, { expectedVersion }]
      : (newName === undefined ? [] : [newName]);
    await moveNode(this.conn, parseInt(nodeId), parentId, ...args);
    this._mutationSeq = (this._mutationSeq || 0) + 1;
    if (gen !== this.generation) return true;
    this.invalidateServerNodesCache();
    await this.repo.updateBaseline(nodeId, { structureVersion: null });
    return true;
  },

  async _apiDeleteNode(nodeId, { cascade = false } = {}) {
    this.refuseLockedFolder(nodeId);
    this.assertRootPresent();
    const gen = this.generation;
    const expectedVersion = await this._expectedVersion(nodeId);
    if (gen !== this.generation) return false;
    this.outbox.markInFlight('delete', parseInt(nodeId));
    await deleteNode(this.conn, parseInt(nodeId), { cascade, expectedVersion });
    this._mutationSeq = (this._mutationSeq || 0) + 1;
    if (gen !== this.generation) return true;
    this.invalidateServerNodesCache();
    return true;
  }
};

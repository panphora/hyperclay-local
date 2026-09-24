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
  async _apiRenameNode(nodeId, newName) {
    const gen = this.generation;
    this.outbox.markInFlight('rename', parseInt(nodeId));
    await renameNode(this.conn, parseInt(nodeId), newName);
    if (gen !== this.generation) return;
    this.invalidateServerNodesCache();
  },

  async _apiMoveNode(nodeId, parentId, newName) {
    const gen = this.generation;
    this.outbox.markInFlight('move', parseInt(nodeId));
    const extraArgs = newName !== undefined ? [newName] : [];
    await moveNode(this.conn, parseInt(nodeId), parentId, ...extraArgs);
    if (gen !== this.generation) return;
    this.invalidateServerNodesCache();
  },

  async _apiDeleteNode(nodeId, { cascade = false } = {}) {
    const gen = this.generation;
    this.outbox.markInFlight('delete', parseInt(nodeId));
    await deleteNode(this.conn, parseInt(nodeId), { cascade });
    if (gen !== this.generation) return;
    this.invalidateServerNodesCache();
  }
};

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
    this.outbox.markInFlight('rename', parseInt(nodeId));
    await renameNode(this.serverUrl, this.apiKey, parseInt(nodeId), newName);
    this.invalidateServerNodesCache();
  },

  async _apiMoveNode(nodeId, parentId, newName) {
    this.outbox.markInFlight('move', parseInt(nodeId));
    const extraArgs = newName !== undefined ? [newName] : [];
    await moveNode(this.serverUrl, this.apiKey, parseInt(nodeId), parentId, ...extraArgs);
    this.invalidateServerNodesCache();
  },

  async _apiDeleteNode(nodeId) {
    this.outbox.markInFlight('delete', parseInt(nodeId));
    await deleteNode(this.serverUrl, this.apiKey, parseInt(nodeId));
    this.invalidateServerNodesCache();
  }
};

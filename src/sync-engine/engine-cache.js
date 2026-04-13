/**
 * Server listing caches.
 *
 * Thin wrappers around api-client.listNodes that memoize the server's view
 * of the world for short windows so we don't re-hit the network on every
 * sync-engine decision. Methods here are installed onto SyncEngine.prototype.
 */

const { listNodes } = require('./api-client');

module.exports = {
  async fetchAndCacheServerFiles(maxAgeMs = 0) {
    const allNodes = await this.fetchAndCacheServerNodes(maxAgeMs);
    this.serverFilesCache = allNodes
      .filter(n => n.type === 'site')
      .map(n => ({
        nodeId: n.id,
        filename: n.path ? `${n.path}/${n.name}` : n.name,
        path: n.path ? `${n.path}/${n.name}` : n.name,
        size: n.size,
        modifiedAt: n.modifiedAt,
        checksum: n.checksum
      }));
    return this.serverFilesCache;
  },

  invalidateServerFilesCache() {
    this.invalidateServerNodesCache();
  },

  async fetchAndCacheServerUploads(maxAgeMs = 0) {
    const allNodes = await this.fetchAndCacheServerNodes(maxAgeMs);
    return allNodes
      .filter(n => n.type === 'upload')
      .map(n => ({
        nodeId: n.id,
        path: n.path ? `${n.path}/${n.name}` : n.name,
        size: n.size,
        modifiedAt: n.modifiedAt,
        checksum: n.checksum
      }));
  },

  invalidateServerUploadsCache() {
    this.invalidateServerNodesCache();
  },

  async fetchAndCacheServerNodes(maxAgeMs = 0) {
    if (this.serverNodesCache && this.serverNodesCacheTime) {
      if (Date.now() - this.serverNodesCacheTime <= maxAgeMs) return this.serverNodesCache;
    }
    this.serverNodesCache = await listNodes(this.serverUrl, this.apiKey);
    this.serverNodesCacheTime = Date.now();
    return this.serverNodesCache;
  },

  invalidateServerNodesCache() {
    this.serverNodesCache = null;
    this.serverNodesCacheTime = null;
    this.serverFilesCache = null;
  }
};

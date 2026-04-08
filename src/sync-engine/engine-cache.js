/**
 * Server listing caches.
 *
 * Thin wrappers around api-client.listNodes that memoize the server's view
 * of the world for short windows so we don't re-hit the network on every
 * sync-engine decision. Methods here are installed onto SyncEngine.prototype.
 */

const { listNodes } = require('./api-client');

module.exports = {
  /**
   * Fetch server files and cache them
   * @param {boolean} forceRefresh - Force refresh even if cache is valid
   */
  async fetchAndCacheServerFiles(forceRefresh = false) {
    // Use cache if it's fresh (less than 30 seconds old) and not forcing refresh
    if (!forceRefresh && this.serverFilesCache && this.serverFilesCacheTime) {
      const cacheAge = Date.now() - this.serverFilesCacheTime;
      if (cacheAge < 30000) {
        console.log(`[SYNC] Using cached server files (age: ${cacheAge}ms)`);
        return this.serverFilesCache;
      }
    }

    // Fetch fresh data
    console.log(`[SYNC] Fetching fresh server files list...`);
    const allNodes = await listNodes(this.serverUrl, this.apiKey);
    this.serverNodesCache = allNodes;
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
    this.serverFilesCacheTime = Date.now();
    return this.serverFilesCache;
  },

  /**
   * Invalidate the server files cache
   */
  invalidateServerFilesCache() {
    this.serverFilesCache = null;
    this.serverFilesCacheTime = null;
  },

  /**
   * Fetch server uploads and cache them
   */
  async fetchAndCacheServerUploads(forceRefresh = false) {
    if (!forceRefresh && this.serverUploadsCache && this.serverUploadsCacheTime) {
      const cacheAge = Date.now() - this.serverUploadsCacheTime;
      if (cacheAge < 30000) {
        console.log(`[SYNC] Using cached server uploads (age: ${cacheAge}ms)`);
        return this.serverUploadsCache;
      }
    }

    console.log(`[SYNC] Fetching fresh server uploads list...`);
    const allNodes = await listNodes(this.serverUrl, this.apiKey);
    this.serverNodesCache = allNodes;
    this.serverUploadsCache = allNodes
      .filter(n => n.type === 'upload')
      .map(n => ({
        nodeId: n.id,
        path: n.path ? `${n.path}/${n.name}` : n.name,
        size: n.size,
        modifiedAt: n.modifiedAt,
        checksum: n.checksum
      }));
    this.serverUploadsCacheTime = Date.now();
    return this.serverUploadsCache;
  },

  /**
   * Invalidate the server uploads cache
   */
  invalidateServerUploadsCache() {
    this.serverUploadsCache = null;
    this.serverUploadsCacheTime = null;
  },

  async fetchAndCacheServerNodes(force = false) {
    if (!force && this.serverNodesCache) return this.serverNodesCache;
    this.serverNodesCache = await listNodes(this.serverUrl, this.apiKey);
    return this.serverNodesCache;
  },

  invalidateServerNodesCache() {
    this.serverNodesCache = null;
  }
};

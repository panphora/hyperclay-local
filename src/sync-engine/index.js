/**
 * Sync Engine for Hyperclay Local
 * Main module that orchestrates bidirectional sync
 */

const EventEmitter = require('events').EventEmitter;
const path = require('upath'); // Use upath for cross-platform compatibility
const { safeStorage } = require('electron');
const { getServerBaseUrl } = require('../main/utils/utils');

// Orchestrator-only imports. Everything else (API client, file ops, livesync,
// error handling, validation, etc.) lives inside the mixin modules that are
// composed onto SyncEngine.prototype at the bottom of this file.
const { calibrateClock } = require('./utils');
const { ensureDirectory } = require('./file-operations');
const SyncQueue = require('./sync-queue');
const nodeMap = require('./node-map');
const { classifyPath } = require('./path-helpers');
const Outbox = require('./state/outbox');
const CascadeSuppression = require('./state/cascade-suppression');

class SyncEngine extends EventEmitter {
  constructor() {
    super();
    this.apiKey = null;
    this.apiKeyEncrypted = null;
    this.username = null;
    this.serverUrl = null;
    this.syncFolder = null;
    this.watcher = null;  // Unified chokidar instance (sites + uploads + folders)
    this.isRunning = false;
    this.clockOffset = 0;
    this.pollTimer = null;
    this.sseConnection = null;
    this.sseReconnectTimer = null;
    this.sseWatchdog = null; // Watchdog timer for SSE heartbeat
    this.lastSseActivity = null; // Last SSE message timestamp
    this.deviceId = null; // Per-device identifier for multi-device sync
    this.syncQueue = new SyncQueue();
    this.metaDir = null; // Path to sync metadata directory (in userData)
    this.nodeMap = new Map(); // nodeId → { type, path, checksum?, inode?, parentId? }
    this.outbox = new Outbox(); // SSE echo suppression: tracks in-flight mutations
    this.pendingUnlinks = new Map(); // watcher rename/move detection: relativePath → { timerId, nodeId, type, entry }
    this.recentSseNodeSaves = new Map(); // `${nodeType}:${nodeId}` → expiresAt ms, tracks recent SSE node-saved events for toast suppression
    // Cascade suppression (S5-Q1, extended in Step 6): when a folder operation
    // (rename, move, or delete) is detected locally OR applied via SSE, we
    // pre-mark the chokidar paths that will fire as a result so they get
    // silently consumed (no duplicate API calls, no nodeMap churn, no echo loops).
    this.cascade = new CascadeSuppression();
    this.folderIdentityWaiters = new Map();
    this.FOLDER_IDENTITY_WAIT_MS = 300;
    this.lastSyncedAt = null; // Timestamp of last successful sync
    this.serverFilesCache = null; // Cache for server files list
    this.serverFilesCacheTime = null; // When cache was last updated
    this.serverUploadsCache = null; // Cache for server uploads list
    this.serverUploadsCacheTime = null; // When uploads cache was last updated
    this.serverNodesCache = null; // Cache for unified node listing
    this.logger = null; // Logger instance
    this.stats = {
      filesProtected: 0,
      filesDownloaded: 0,
      filesUploaded: 0,
      filesDownloadedSkipped: 0,
      filesUploadedSkipped: 0,
      // Upload stats
      uploadsDownloaded: 0,
      uploadsUploaded: 0,
      uploadsProtected: 0,
      uploadsSkipped: 0,
      lastSync: null,
      errors: []
    };
  }

  /**
   * Set the logger instance
   */
  setLogger(logger) {
    this.logger = logger;
  }

  resolveContainedPath(relativePath) {
    const resolved = path.resolve(path.join(this.syncFolder, relativePath));
    const base = path.resolve(this.syncFolder);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error(`Path traversal blocked: ${relativePath}`);
    }
    return resolved;
  }

  /**
   * Initialize sync with API key and folder
   */
  async init(apiKey, username, syncFolder, serverUrl, deviceId, metaDir) {
    console.log(`[SYNC] Init called with:`, {
      username,
      syncFolder,
      serverUrl,
      apiKeyLength: apiKey?.length,
      apiKeyPrefix: apiKey?.substring(0, 12),
      deviceId
    });

    if (this.isRunning) {
      throw new Error('Sync is already running');
    }

    // Reset stats for fresh session
    this.stats = {
      filesProtected: 0,
      filesDownloaded: 0,
      filesUploaded: 0,
      filesDownloadedSkipped: 0,
      filesUploadedSkipped: 0,
      // Upload stats
      uploadsDownloaded: 0,
      uploadsUploaded: 0,
      uploadsProtected: 0,
      uploadsSkipped: 0,
      lastSync: null,
      errors: []
    };

    // Clear any pending operations
    this.syncQueue.clear();

    this.apiKey = apiKey;
    this.username = username;
    this.syncFolder = syncFolder;
    this.deviceId = deviceId || 'hyperclay-local'; // Fallback for backwards compatibility
    this.metaDir = metaDir;

    // Set server URL with fallback to environment-based default
    this.serverUrl = getServerBaseUrl(serverUrl);

    console.log(`[SYNC] Initializing for ${username} at ${syncFolder}`);
    console.log(`[SYNC] Server: ${this.serverUrl}`);

    // Log sync initialization
    if (this.logger) {
      this.logger.info('SYNC', 'Sync initialized', {
        username,
        syncFolder: this.logger.sanitizePath(syncFolder),
        serverUrl: this.serverUrl
      });
    }

    // Encrypt and store API key
    if (safeStorage.isEncryptionAvailable()) {
      this.apiKeyEncrypted = safeStorage.encryptString(apiKey);
    }

    try {
      // Ensure sync folder exists
      console.log(`[SYNC] Ensuring sync folder exists: ${syncFolder}`);
      await ensureDirectory(syncFolder);

      // Calibrate clock with server
      console.log(`[SYNC] Calibrating clock with server...`);
      this.clockOffset = await calibrateClock(this.serverUrl, this.apiKey);
      console.log(`[SYNC] Clock offset: ${this.clockOffset}ms`);

      // Load node map (nodeId ↔ local path) and sync state
      this.nodeMap = await nodeMap.load(this.metaDir);
      const syncState = await nodeMap.loadState(this.metaDir);
      this.lastSyncedAt = syncState.lastSyncedAt || null;
      console.log(`[SYNC] Loaded node map: ${this.nodeMap.size} entries, lastSyncedAt: ${this.lastSyncedAt || 'never'}`);

      // Perform initial sync for sites
      console.log(`[SYNC] Starting initial site sync...`);
      await this.performInitialSync();
      console.log(`[SYNC] Initial site sync completed`);

      // Perform initial sync for uploads
      console.log(`[SYNC] Starting initial upload sync...`);
      await this.performInitialUploadSync();
      console.log(`[SYNC] Initial upload sync completed`);

      await this.populateFolderNodeMap();

      console.log(`[SYNC] Starting unified watcher...`);
      this.startUnifiedWatcher();

      // Connect to SSE stream for real-time sync (handles both live-sync and disk sync)
      console.log(`[SYNC] Connecting to SSE stream...`);
      this.connectToStream();

      // No polling - SSE handles real-time sync for both live-sync and disk writes

      // Periodic cleanup of stale outbox entries + folder rename suppression entries
      this.pendingActionsCleanupTimer = setInterval(() => {
        this.outbox.sweep();
        this.cascade.sweep();
      }, 10000);

      this.isRunning = true;

      console.log(`[SYNC] Initialization complete!`);
      return {
        success: true,
        stats: this.stats
      };
    } catch (error) {
      console.error(`[SYNC] Initialization failed:`, error);
      console.error(`[SYNC] Error type: ${error.name}`);
      console.error(`[SYNC] Error message: ${error.message}`);
      console.error(`[SYNC] Stack trace:`, error.stack);

      // Log initialization error
      if (this.logger) {
        this.logger.error('SYNC', 'Sync initialization failed', { error });
      }

      throw error;
    }
  }

  /**
   * Resolve a folder path string (e.g., "projects/assets") to its Node id.
   * Returns 0 for root. Throws if the folder doesn't exist on the server.
   * Uses the cached node listing.
   *
   * NOTE: this helper exists because Step 4 callers still think in terms of paths.
   * Step 5 replaces it with direct nodeMap lookups once folders are tracked there.
   */
  resolveParentIdByPath(folderPath) {
    if (!folderPath || folderPath === '' || folderPath === '.' || folderPath === '/') {
      return 0;  // root
    }

    for (const [nodeId, entry] of this.nodeMap) {
      if (entry.type === 'folder' && entry.path === folderPath) {
        return parseInt(nodeId, 10);
      }
    }

    throw new Error(`Target folder not tracked in nodeMap: ${folderPath}`);
  }

  /**
   * Stop sync
   */
  async stop() {
    if (!this.isRunning) return;

    console.log('[SYNC] Stopping sync engine...');

    // Mark as not running immediately (this will abort any ongoing polls)
    this.isRunning = false;

    // Stop polling FIRST (before watcher, to prevent new polls from starting)
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[SYNC] Polling timer cleared');
    }

    // Disconnect SSE stream
    this.disconnectStream();

    // Stop unified watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log('[SYNC] Watcher closed');
    }

    // Clear all pending operations
    this.syncQueue.clear();

    // Clear pending actions and unlinks
    if (this.pendingActionsCleanupTimer) {
      clearInterval(this.pendingActionsCleanupTimer);
      this.pendingActionsCleanupTimer = null;
    }
    this.outbox.clear();
    for (const [, { timerId }] of this.pendingUnlinks) {
      clearTimeout(timerId);
    }
    this.pendingUnlinks.clear();
    this.recentSseNodeSaves.clear();

    this.cascade.clear();

    for (const [, waiter] of this.folderIdentityWaiters) {
      clearTimeout(waiter.timerId);
      waiter.resolve(null);
    }
    this.folderIdentityWaiters.clear();

    // Clear caches
    this.invalidateServerFilesCache();
    this.invalidateServerUploadsCache();

    console.log('[SYNC] Sync stopped');

    // Log sync stop
    if (this.logger) {
      this.logger.info('SYNC', 'Sync stopped', {
        finalStats: {
          filesDownloaded: this.stats.filesDownloaded,
          filesUploaded: this.stats.filesUploaded,
          filesProtected: this.stats.filesProtected,
          uploadsDownloaded: this.stats.uploadsDownloaded,
          uploadsUploaded: this.stats.uploadsUploaded,
          uploadsProtected: this.stats.uploadsProtected,
          errors: this.stats.errors.length
        }
      });
    }

    return {
      success: true,
      stats: this.stats
    };
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      syncFolder: this.syncFolder,
      username: this.username,
      stats: {
        ...this.stats,
        recentErrors: this.stats.errors.slice(-5) // Last 5 errors
      },
      queueStatus: {
        queueLength: this.syncQueue.length(),
        isProcessing: this.syncQueue.isProcessingQueue(),
        retryItems: this.syncQueue.getRetryItems()
      }
    };
  }

  /**
   * Clear API key from memory
   */
  clearApiKey() {
    this.apiKey = null;
    this.apiKeyEncrypted = null;
    this.username = null;
  }

  /**
   * Check if file has permanent failure
   */
  hasFailedPermanently(filename) {
    return this.syncQueue.hasFailedPermanently(filename);
  }
}

// Compose mixin modules onto the prototype. Order does not matter — mixin
// files only reference each other through `this`, never via require, so there
// are no load-time dependencies between them.
Object.assign(SyncEngine.prototype,
  require('./engine-cache'),
  require('./engine-queue'),
  require('./engine-uploader'),
  require('./engine-initial-sync'),
  require('./engine-sse'),
  require('./engine-watcher')
);

// Export singleton instance
const syncEngine = new SyncEngine();
module.exports = syncEngine;
module.exports.classifyPath = classifyPath;
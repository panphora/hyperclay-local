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
const { classifyPath } = require('./path-helpers');
const Outbox = require('./state/outbox');
const CascadeSuppression = require('./state/cascade-suppression');
const EchoWindow = require('./state/echo-window');
const NodeRepository = require('./state/node-repository');

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
    this.repo = new NodeRepository(); // nodeId → { type, path, checksum?, inode?, parentId? }
    // Convenience: `this.metaDir = x` forwards to `this.repo.attach(x)` so
    // tests and init() can set the metadata directory in one place instead
    // of having to remember to call attach() separately.
    Object.defineProperty(this, 'metaDir', {
      get() { return this.repo._metaDir; },
      set(v) { this.repo.attach(v); },
      configurable: true
    });
    this.outbox = new Outbox(); // SSE echo suppression: tracks in-flight mutations
    this.pendingUnlinks = new Map(); // watcher rename/move detection: relativePath → { timerId, nodeId, type, entry }
    this.echoWindow = new EchoWindow(); // tracks recent SSE node-saved events for toast suppression in the watcher
    // Cascade suppression (S5-Q1, extended in Step 6): when a folder operation
    // (rename, move, or delete) is detected locally OR applied via SSE, we
    // pre-mark the chokidar paths that will fire as a result so they get
    // silently consumed (no duplicate API calls, no nodeMap churn, no echo loops).
    this.cascade = new CascadeSuppression();
    this.lastSyncedAt = null; // Timestamp of last successful sync
    this.serverNodesCache = null; // Cache for unified node listing
    this.serverNodesCacheTime = null; // Timestamp of last successful fetchAndCacheServerNodes
    this.serverFilesCache = null; // Derived cache for site files (populated by fetchAndCacheServerFiles)
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

      // Calibrate clock with server (also validates API key and connectivity)
      console.log(`[SYNC] Calibrating clock with server...`);
      if (this.logger) {
        this.logger.info('SYNC', 'Testing connectivity and authenticating', { serverUrl: this.serverUrl });
      }
      const calibrateStart = Date.now();
      this.clockOffset = await calibrateClock(this.serverUrl, this.apiKey, this.logger);
      console.log(`[SYNC] Clock offset: ${this.clockOffset}ms`);
      if (this.logger) {
        this.logger.info('SYNC', 'Authentication successful, clock calibrated', {
          clockOffsetMs: this.clockOffset,
          roundtripMs: Date.now() - calibrateStart
        });
      }

      // Load node map (nodeId ↔ local path) and sync state
      // (repo was already attached via the `this.metaDir = metaDir` setter above)
      this.repo.attachLogger(this.logger);
      await this.repo.load();
      await this.repo.loadTombstones();
      const syncState = await this.repo.loadState();
      this.lastSyncedAt = syncState.lastSyncedAt || null;
      console.log(`[SYNC] Loaded node map: ${this.repo.size} entries, ${this.repo.tombstoneSize} tombstone(s), lastSyncedAt: ${this.lastSyncedAt || 'never'}`);

      await this.performInitialFolderSync();

      // Perform initial sync for sites
      console.log(`[SYNC] Starting initial site sync...`);
      await this.performInitialSync();
      console.log(`[SYNC] Initial site sync completed`);

      // Perform initial sync for uploads
      console.log(`[SYNC] Starting initial upload sync...`);
      await this.performInitialUploadSync();
      console.log(`[SYNC] Initial upload sync completed`);

      console.log(`[SYNC] Starting unified watcher...`);
      this.startUnifiedWatcher();

      // Connect to SSE stream for real-time sync (handles both live-sync and disk sync)
      console.log(`[SYNC] Connecting to SSE stream...`);
      this.connectToStream();

      // No polling - SSE handles real-time sync for both live-sync and disk writes

      // Periodic cleanup of stale outbox entries + folder rename suppression entries
      this.pendingActionsCleanupTimer = setInterval(() => {
        const expiredOutbox = this.outbox.sweep();
        if (expiredOutbox.length > 0 && this.logger) {
          for (const { operation, ageMs } of expiredOutbox) {
            this.logger.warn('OUTBOX', 'In-flight operation expired without SSE echo', { operation, ageMs });
          }
        }
        const expiredCascade = this.cascade.sweep();
        if (expiredCascade.length > 0 && this.logger) {
          this.logger.warn('CASCADE', 'Suppression entries expired before events arrived', { paths: expiredCascade });
        }
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

    for (const [nodeId, entry] of this.repo) {
      if (entry.type === 'folder' && entry.path === folderPath) {
        return parseInt(nodeId, 10);
      }
    }

    const trackedFolders = [];
    for (const [, entry] of this.repo) {
      if (entry.type === 'folder') trackedFolders.push(entry.path);
    }
    if (this.logger) {
      this.logger.error('SYNC', 'Parent folder not found in nodeMap', {
        requestedPath: folderPath,
        trackedFolders
      });
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
    this.echoWindow.clear();

    this.cascade.clear();

    // Clear caches
    this.invalidateServerNodesCache();

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
  require('./engine-watcher'),
  require('./engine-mutations')
);

// Export singleton instance
const syncEngine = new SyncEngine();
module.exports = syncEngine;
module.exports.classifyPath = classifyPath;
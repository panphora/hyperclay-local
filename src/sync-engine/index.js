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
const { calibrateClock, getLegacySnapshot } = require('./utils');
const { classifyError } = require('./reconcile/classify-error');
const { createRootLive } = require('../main/utils/root-live');
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
    this.observer = null; // RootObserver for this root (owned by the root, not by the engine)
    this._disposeObserver = null; // unsubscribes from the observer's raw feed
    this.privateObserver = null; // an observer this engine built itself, when none was passed
    this._subscribedObserver = null; // the observer whose raw feed this engine listens to
    this.isRunning = false;
    // Bumped by stop(); every async continuation that writes after an await
    // captures it and bails when it no longer matches. See init()/stop().
    this.generation = 0;
    // Per-session wiring. init() replaces these from opts; the defaults keep a
    // bare `new SyncEngine()` (tests, and the personal session before C2.5) on
    // the process-wide personal keys and the legacy server snapshot store.
    this.live = createRootLive(null);
    this.snapshots = { take: (rel) => getLegacySnapshot(rel) };
    this.pollTimer = null;
    this.sseConnection = null;
    this.sseReconnectTimer = null;
    this.sseWatchdog = null; // Watchdog timer for SSE heartbeat
    this.lastSseActivity = null; // Last SSE message timestamp
    this.deviceId = null; // Per-device identifier for multi-device sync
    // The stream adapter the session runner opens (C3 §5.6): open/close, frames
    // and failures handed to the runner instead of the legacy op handlers.
    this.stream = this.sessionStream();
    this.streamFrame = null; // Frames go here while a runner owns the stream
    this.streamError = null; // Failures go here while a runner owns the stream
    this.streamRefusal = null; // The body of a refused connect, for its code
    this.runner = null; // The session's state machine, set when the session starts
    this.syncQueue = new SyncQueue();
    this.queueWaiters = []; // whenQueueEmpty() resolvers
    // The generation the session's runner is on, and the work it handed over
    // (its signal). Both fence continuations that outlived a pause or restart.
    this.sessionGeneration = 0;
    this.sessionWork = null;
    this.sessionInvalidated = false;
    this.nodeListInFlight = null;
    this.bootstrapPass = false; // reconcileAll({ bootstrap: true }) deletes nothing
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
    this.serverNodesComplete = false; // The cached list said complete: true (protocol 2)
    this.syncReadyAt = null; // Timestamp of the last stream sync-ready frame (C3.6 sets it)
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
   * The connection every request is built from. Reads the engine's own fields
   * so callers can set serverUrl/apiKey directly.
   */
  get conn() {
    return {
      serverUrl: this.serverUrl,
      syncBase: this.syncBase || '/_/sync',
      apiKey: this.apiKey,
      accountId: this.accountId ?? null,
      protocol: this.protocol || 1,
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
  async init(apiKey, username, syncFolder, serverUrl, deviceId, metaDir, opts = {}) {
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

    // opts = {
    //   sessionId, accountId = null, syncBase = '/_/sync', protocol = 1,
    //   live,        // createRootLive(root) from src/main/utils/root-live.js
    //   snapshots,   // { take(rel) } for this root, from server.js getAndClearSnapshot(rel, rootId)
    //   observer,    // RootObserver for this root (5.9)
    //   logger,      // a SyncLogger instance for this session
    // }
    this.sessionId = opts.sessionId || null;
    this.accountId = opts.accountId ?? null;
    this.syncBase = opts.syncBase || '/_/sync';
    this.protocol = opts.protocol || 1;
    // C3.7: a team session's first bind owns its first pass (progress, disk
    // check, marker, identity), so init defers the passes and the stream to it.
    this.firstBind = opts.firstBind === true;
    this.live = opts.live || createRootLive(null);
    this.snapshots = opts.snapshots || { take: (rel) => getLegacySnapshot(rel) };
    this.observer = opts.observer || null;
    if (opts.logger) this.logger = opts.logger;

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
    if (safeStorage?.isEncryptionAvailable?.()) {
      this.apiKeyEncrypted = safeStorage.encryptString(apiKey);
    }

    try {
      // Ensure sync folder exists
      console.log(`[SYNC] Ensuring sync folder exists: ${syncFolder}`);
      await ensureDirectory(syncFolder);

      // Prove the key works and the server answers before anything syncs. C3
      // §5.5.5: the offset it reports is not used by the session engine any
      // more — content is decided by checksum and etag, not by clocks.
      console.log(`[SYNC] Calibrating clock with server...`);
      if (this.logger) {
        this.logger.info('SYNC', 'Testing connectivity and authenticating', { serverUrl: this.serverUrl });
      }
      const calibrateStart = Date.now();
      let offline = false;
      try {
        await calibrateClock(this.conn, this.logger);
      } catch (error) {
        // C3.11: a session with a runner starts offline instead of failing for
        // good. Its own start is what hits the network, goes `offline` and backs
        // off (C3 §5.6), so init skips its passes exactly as the paused and
        // firstBind paths do. A refusal (401, 403) is still a failure here.
        if (!this.runner || classifyError(error).kind !== 'offline') throw error;
        offline = true;
        console.error('[SYNC] Server unreachable; starting offline:', error.message);
        if (this.logger) {
          this.logger.error('SYNC', 'Server unreachable; the session starts offline', { error });
        }
      }
      if (!offline && this.logger) {
        this.logger.info('SYNC', 'Authentication successful, clock calibrated', {
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

      // If the node-map loaded empty but we have a lastSyncedAt, the map was lost
      // (corruption, or an interrupted prior sync). Comparing server state against
      // an empty baseline would let offline-delete detection fire against files we
      // simply lost track of. Treat this as a first sync so nothing gets deleted.
      if (this.lastSyncedAt && this.repo.size === 0) {
        console.warn('[SYNC] Node map empty but lastSyncedAt set — treating as first sync to avoid false deletes');
        if (this.logger) {
          this.logger.warn('SYNC', 'Node map empty but lastSyncedAt set — resetting to first-sync to avoid false deletes', { lastSyncedAt: this.lastSyncedAt });
        }
        this.lastSyncedAt = null;
      }

      if (!this.firstBind && !offline) {
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
        // A session with a runner (C3.7) has its stream opened by that runner
        // instead, so the legacy transport is never connected.
        if (!this.runner) {
          console.log(`[SYNC] Connecting to SSE stream...`);
          this.connectToStream();
        }
      }

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
    // First, before any await: every continuation started before this point is
    // stale now and must not touch disk, the repo, live-sync or the log.
    this.generation++;

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

    // Detach from the observer's feed. The engine never stops a shared
    // observer — it belongs to the root; one it built itself it owns.
    if (this._disposeObserver) {
      this._disposeObserver();
      this._disposeObserver = null;
    }
    if (this._subscribedObserver && this._onObserverError) {
      this._subscribedObserver.off('error', this._onObserverError);
      this._onObserverError = null;
    }
    this._subscribedObserver = null;
    if (this.privateObserver) {
      await this.privateObserver.stop();
      this.privateObserver = null;
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
   * Was this path written by an SSE node-saved event we just applied? The
   * observer uses it to tell "the edit we caused" from "the user edited".
   */
  isRecentRemoteApply(rel) {
    const found = this.repo.getByPath(rel);
    return !!(found && this.echoWindow.isRecent(found.entry.type, found.nodeId));
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

  /**
   * Fire-and-forget a control-lane envelope to the platform (best-effort sidecar).
   * Sync off (no serverUrl/apiKey) degrades to a silent no-op; the POST never throws.
   */
  async sendControlMessage(envelope) {
    if (!this.serverUrl || !this.apiKey) return { delivered: false };
    const { postControlMessage } = require('./api-client');
    return postControlMessage(this.conn, envelope);
  }
}

// Compose mixin modules onto the prototype. Order does not matter — mixin
// files only reference each other through `this`, never via require, so there
// are no load-time dependencies between them.
Object.assign(SyncEngine.prototype,
  require('./engine-cache'),
  require('./engine-queue'),
  require('./engine-session'),
  require('./engine-uploader'),
  require('./engine-initial-sync'),
  require('./engine-sse'),
  require('./engine-watcher'),
  require('./engine-mutations')
);

// Register control-lane rider handlers (data-loss/dismiss, ...) for their side
// effect, once, after the prototype is composed. See riders/register.js.
require('./riders/register');

module.exports = { SyncEngine, classifyPath };
/**
 * Sync Engine for Hyperclay Local
 * Main module that orchestrates bidirectional sync
 */

const EventEmitter = require('events').EventEmitter;
const path = require('upath'); // Use upath for cross-platform compatibility
const chokidar = require('chokidar');
const { safeStorage } = require('electron');
const { getServerBaseUrl } = require('../main/utils/utils');
const { EventSource } = require('eventsource');

// Import sync engine modules
const { SYNC_CONFIG, ERROR_PRIORITY } = require('./constants');
const { calculateChecksum, generateTimestamp, isLocalNewer, isFutureFile, calibrateClock } = require('./utils');
const { liveSync } = require('livesync-hyperclay');
const { createBackupIfExists, createBinaryBackupIfExists } = require('../main/utils/backup');
const { classifyError, formatErrorForLog } = require('./error-handler');
const {
  getLocalFiles,
  readFile,
  writeFile,
  fileExists,
  getFileStats,
  ensureDirectory,
  moveFile,
  // Upload-specific
  getLocalUploads,
  readFileBuffer,
  writeFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
const {
  listNodes,
  createNode,
  getNodeContent,
  putNodeContent,
  renameNode,
  moveNode,
  deleteNode,
  getServerStatus
} = require('./api-client');
const SyncQueue = require('./sync-queue');
const { validateFileName, validateFullPath, validateUploadPath } = require('./validation');
const nodeMap = require('./node-map');

function hasHiddenSegment(filePath) {
  return filePath.split('/').some(segment => segment.startsWith('.'));
}

function toFileId(relPath) {
  return path.normalize(relPath).replace(/\.(html|htmlclay)$/i, '');
}

function classifyPath(relativePath, eventType) {
  if (eventType === 'addDir' || eventType === 'unlinkDir') {
    return 'folder';
  }
  if (/\.(html|htmlclay)$/i.test(relativePath)) {
    return 'site';
  }
  return 'upload';
}

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
    this.pendingActions = new Map(); // SSE echo suppression: key -> timestamp ms (e.g. "delete:42" -> 1712345678901)
    this.PENDING_ACTION_TTL_MS = 30000; // each pendingAction key lives 30s from when it was added
    this.pendingUnlinks = new Map(); // watcher rename/move detection: relativePath → { timerId, nodeId, type, entry }
    this.recentSseFileSaves = new Map(); // fileId → timestamp, tracks recent SSE file-saved events for toast suppression
    this.recentFolderRenameDescendants = new Map();
    this.FOLDER_RENAME_SUPPRESSION_TTL_MS = 3000;
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

      // Periodic cleanup of stale pendingActions + folder rename suppression entries
      this.pendingActionsCleanupTimer = setInterval(() => {
        const cutoff = Date.now() - this.PENDING_ACTION_TTL_MS;
        for (const [key, ts] of this.pendingActions) {
          if (ts < cutoff) {
            this.pendingActions.delete(key);
          }
        }
        this._sweepFolderRenameSuppressionSet();
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
  }

  /**
   * Invalidate the server files cache
   */
  invalidateServerFilesCache() {
    this.serverFilesCache = null;
    this.serverFilesCacheTime = null;
  }

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
  }

  /**
   * Invalidate the server uploads cache
   */
  invalidateServerUploadsCache() {
    this.serverUploadsCache = null;
    this.serverUploadsCacheTime = null;
  }

  async fetchAndCacheServerNodes(force = false) {
    if (!force && this.serverNodesCache) return this.serverNodesCache;
    this.serverNodesCache = await listNodes(this.serverUrl, this.apiKey);
    return this.serverNodesCache;
  }

  invalidateServerNodesCache() {
    this.serverNodesCache = null;
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
   * Perform initial sync - download files from server but preserve newer local files
   */
  async performInitialSync() {
    console.log('[SYNC] Starting initial sync...');
    this.emit('sync-start', { type: 'initial' });

    try {
      const serverFiles = await this.fetchAndCacheServerFiles(true);
      const localFiles = await getLocalFiles(this.syncFolder);

      for (const serverFile of serverFiles) {
        await this.reconcileServerFile(serverFile, localFiles);
      }

      // Detect server-side deletes: nodeIds in our map but NOT in the server's file list
      // Skip entirely on first-ever sync (no baseline to compare against)
      if (this.lastSyncedAt) {
        const serverNodeIds = new Set(serverFiles.map(f => String(f.nodeId)));
        for (const [nid, entry] of this.nodeMap) {
          const localRelPath = entry.path;
          if (!serverNodeIds.has(nid)) {
            const fullPath = path.join(this.syncFolder, localRelPath);
            const exists = await fileExists(fullPath);
            if (exists) {
              const stats = await getFileStats(fullPath);
              if (stats.mtime > this.lastSyncedAt) {
                console.log(`[SYNC] Skipping trash for ${localRelPath} — local file is newer than last sync (edited while offline)`);
                this.nodeMap.delete(nid);
                continue;
              }

              const trashPath = path.join(this.syncFolder, '.trash', localRelPath);
              await ensureDirectory(path.dirname(trashPath));
              const siteName = localRelPath.split('/').pop().replace(/\.(html|htmlclay)$/i, '');
              liveSync.markBrowserSave(siteName);
              await moveFile(fullPath, trashPath);
              localFiles.delete(localRelPath);
              console.log(`[SYNC] Trashed ${localRelPath} (deleted on server while offline, nodeId ${nid})`);
              this.emit('file-synced', { file: localRelPath, action: 'trash', source: 'initial-sync' });
            }
            this.nodeMap.delete(nid);
          }
        }
      }

      await nodeMap.save(this.metaDir, this.nodeMap);

      // Detect local structural changes (delete/move/rename) that happened while offline
      if (this.lastSyncedAt) {
        await this.detectLocalChanges(serverFiles, localFiles);
        await nodeMap.save(this.metaDir, this.nodeMap);
      }

      await this.uploadLocalOnlyFiles(localFiles, serverFiles);

      this.lastSyncedAt = Date.now();
      await nodeMap.saveState(this.metaDir, { lastSyncedAt: this.lastSyncedAt });
      this.stats.lastSync = new Date().toISOString();
      console.log('[SYNC] Initial sync complete');
      console.log(`[SYNC] Stats: ${JSON.stringify(this.stats)}`);

      if (this.logger) {
        this.logger.success('SYNC', 'Initial sync completed', {
          filesDownloaded: this.stats.filesDownloaded,
          filesUploaded: this.stats.filesUploaded,
          filesProtected: this.stats.filesProtected,
          filesDownloadedSkipped: this.stats.filesDownloadedSkipped,
          filesUploadedSkipped: this.stats.filesUploadedSkipped
        });
      }

      this.emit('sync-complete', {
        type: 'initial',
        stats: { ...this.stats }
      });

      this.emit('sync-stats', this.stats);

    } catch (error) {
      console.error('[SYNC] Initial sync failed:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'initial-sync' }));

      if (this.logger) {
        this.logger.error('SYNC', 'Initial sync failed', { error });
      }

      this.emit('sync-error', {
        type: 'initial',
        error: error.message,
        priority: ERROR_PRIORITY.CRITICAL
      });

      throw error;
    }
  }

  /**
   * Reconcile a single server file against local state: move, download, or skip.
   * Mutates localFiles map when a file is moved.
   */
  async reconcileServerFile(serverFile, localFiles) {
    const relativePath = serverFile.path || serverFile.filename;
    this.resolveContainedPath(relativePath);
    const localPath = path.join(this.syncFolder, relativePath);
    let localExists = localFiles.has(relativePath);

    if (!localExists && serverFile.nodeId) {
      const knownEntry = this.nodeMap.get(String(serverFile.nodeId));
      const knownPath = knownEntry?.path;
      if (knownPath && knownPath !== relativePath && localFiles.has(knownPath)) {
        const oldFullPath = path.join(this.syncFolder, knownPath);
        const siteName = relativePath.split('/').pop().replace(/\.(html|htmlclay)$/i, '');
        try {
          liveSync.markBrowserSave(siteName);
          await moveFile(oldFullPath, localPath);

          const localInfo = localFiles.get(knownPath);
          localFiles.delete(knownPath);
          localFiles.set(relativePath, localInfo);
          localExists = true;

          console.log(`[SYNC] MOVED ${knownPath} → ${relativePath} (nodeId ${serverFile.nodeId})`);

          if (this.logger) {
            this.logger.info('SYNC', 'Moved file to match server path', {
              from: knownPath,
              to: relativePath
            });
          }
        } catch (error) {
          console.error(`[SYNC] Failed to move ${knownPath} → ${relativePath}:`, error.message);
        }
      }
    }

    const existingEntry = this.nodeMap.get(String(serverFile.nodeId)) || {};
    this.nodeMap.set(String(serverFile.nodeId), { path: relativePath, checksum: existingEntry.checksum || null, inode: existingEntry.inode || null });

    if (!localExists) {
      try {
        await this.downloadFile(serverFile.filename, relativePath, serverFile.nodeId);
        this.stats.filesDownloaded++;
        const inode = await nodeMap.getInode(localPath);
        const content = await readFile(localPath).catch(() => null);
        const cs = content ? await calculateChecksum(content) : null;
        this.nodeMap.set(String(serverFile.nodeId), { path: relativePath, checksum: cs, inode });
      } catch (error) {
        console.error(`[SYNC] Failed to download ${relativePath} during initial sync:`, error.message);
      }
      return;
    }

    try {
      const localStat = await getFileStats(localPath);
      const localContent = await readFile(localPath);
      const localChecksum = await calculateChecksum(localContent);
      const inode = await nodeMap.getInode(localPath);
      this.nodeMap.set(String(serverFile.nodeId), { path: relativePath, checksum: localChecksum, inode });

      if (isFutureFile(localStat.mtime, this.clockOffset)) {
        console.log(`[SYNC] PRESERVE ${relativePath} - future-dated file`);
        this.stats.filesProtected++;
        return;
      }

      if (isLocalNewer(localStat.mtime, serverFile.modifiedAt, this.clockOffset)) {
        console.log(`[SYNC] PRESERVE ${relativePath} - local is newer`);
        this.stats.filesProtected++;
        return;
      }

      if (localChecksum === serverFile.checksum) {
        console.log(`[SYNC] SKIP ${relativePath} - checksums match`);
        this.stats.filesDownloadedSkipped++;
        return;
      }

      await this.downloadFile(serverFile.filename, relativePath, serverFile.nodeId);
      this.stats.filesDownloaded++;
      const dlContent = await readFile(localPath).catch(() => null);
      const dlChecksum = dlContent ? await calculateChecksum(dlContent) : null;
      const dlInode = await nodeMap.getInode(localPath);
      this.nodeMap.set(String(serverFile.nodeId), { path: relativePath, checksum: dlChecksum, inode: dlInode });
    } catch (error) {
      console.error(`[SYNC] Failed to process ${relativePath} during initial sync:`, error.message);
      if (!error.message.includes('Failed to download')) {
        this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'initial-sync-check' }));
        const errorInfo = classifyError(error, { filename: relativePath, action: 'check' });
        this.emit('sync-error', errorInfo);

        if (this.logger) {
          this.logger.error('SYNC', 'Initial sync file processing failed', {
            file: relativePath,
            error
          });
        }
      }
    }
  }

  /**
   * Upload local files that don't exist on the server.
   * Skips files whose name already exists on the server at a different path (orphan duplicates).
   */
  async uploadLocalOnlyFiles(localFiles, serverFiles) {
    for (const [relativePath, localInfo] of localFiles) {
      const serverFile = serverFiles.find(f =>
        (f.path === relativePath) || (f.filename === relativePath)
      );

      if (!serverFile) {
        const localName = relativePath.split('/').pop();
        const localFolder = relativePath.split('/').slice(0, -1).join('/');
        const nameExistsInSameFolder = serverFiles.some(f => {
          const serverPath = f.path || f.filename;
          const serverName = serverPath.split('/').pop();
          const serverFolder = serverPath.split('/').slice(0, -1).join('/');
          return serverName === localName && serverFolder === localFolder;
        });

        if (nameExistsInSameFolder) {
          console.log(`[SYNC] SKIP ${relativePath} - same name already exists in folder on server`);
          if (this.logger) {
            this.logger.warn('SYNC', 'Skipped upload - name exists in same folder on server', { file: relativePath });
          }
          continue;
        }

        console.log(`[SYNC] LOCAL ONLY: ${relativePath} - uploading`);
        try {
          await this.uploadFile(relativePath);
          this.stats.filesUploaded++;
        } catch (error) {
          console.error(`[SYNC] Failed to upload ${relativePath} during initial sync:`, error.message);
          this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'initial-upload' }));

          const errorInfo = classifyError(error, { filename: relativePath, action: 'upload' });
          this.emit('sync-error', errorInfo);
        }
      }
    }
  }

  /**
   * Detect local structural changes (delete/move/rename) that happened while offline.
   * Runs during performInitialSync after server-side reconciliation.
   */
  async detectLocalChanges(serverFiles, localFiles) {
    const serverNodeIds = new Set(serverFiles.map(f => String(f.nodeId)));
    const serverFilesByNodeId = new Map(serverFiles.map(f => [String(f.nodeId), f]));

    // Build reverse map: localPath → nodeId
    const reverseMap = new Map();
    for (const [nid, entry] of this.nodeMap) {
      reverseMap.set(entry.path, nid);
    }

    // Track local files not in nodeMap (candidates for rename/move targets)
    const localOnlySet = new Set();
    for (const [relPath] of localFiles) {
      if (!reverseMap.has(relPath)) {
        localOnlySet.add(relPath);
      }
    }

    for (const [nid, entry] of [...this.nodeMap]) {
      if (!serverNodeIds.has(nid)) continue; // already handled by server-side delete reconciliation

      const serverFile = serverFilesByNodeId.get(nid);
      const serverPath = serverFile.path || serverFile.filename;

      // Only run local change detection for nodeIds where the server hasn't changed the path
      // (server wins for move/rename conflicts)
      if (serverPath !== entry.path) continue;

      if (localFiles.has(entry.path)) continue; // file still at expected path

      // File is GONE from expected path but still exists on server — find where it went

      const expectedBasename = path.basename(entry.path);

      const strategies = [
        {
          name: 'move',
          pendingKey: `move:${nid}`,
          match: async (localFile) => path.basename(localFile) === expectedBasename,
          apply: async (localFile) => {
            const targetFolder = path.dirname(localFile);
            const folderPath = targetFolder === '.' ? '' : targetFolder.replace(/\.(html|htmlclay)$/, '');
            const targetParentId = this.resolveParentIdByPath(folderPath);
            await moveNode(this.serverUrl, this.apiKey, parseInt(nid), targetParentId);
            const inode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            const cs = content ? await calculateChecksum(content) : entry.checksum;
            return { path: localFile, checksum: cs, inode };
          }
        },
        {
          name: 'rename (inode match)',
          pendingKey: `rename:${nid}`,
          match: async (localFile) => {
            const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            return localInode && entry.inode && localInode === entry.inode;
          },
          apply: async (localFile) => {
            const newName = path.basename(localFile);
            await renameNode(this.serverUrl, this.apiKey, parseInt(nid), newName);
            const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            return { path: localFile, checksum: entry.checksum, inode: localInode };
          }
        },
        {
          name: 'rename (checksum match)',
          pendingKey: `rename:${nid}`,
          match: async (localFile) => {
            if (!entry.checksum) return false;
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            if (!content) return false;
            return (await calculateChecksum(content)) === entry.checksum;
          },
          apply: async (localFile) => {
            const newName = path.basename(localFile);
            await renameNode(this.serverUrl, this.apiKey, parseInt(nid), newName);
            const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            const cs = content ? await calculateChecksum(content) : entry.checksum;
            return { path: localFile, checksum: cs, inode: localInode };
          }
        }
      ];

      let handled = false;
      for (const strategy of strategies) {
        for (const localFile of localOnlySet) {
          if (await strategy.match(localFile)) {
            try {
              console.log(`[SYNC] Local ${strategy.name} detected: ${entry.path} → ${localFile} (nodeId ${nid})`);
              this.pendingActions.set(strategy.pendingKey, Date.now());
              const newEntry = await strategy.apply(localFile);
              this.invalidateServerFilesCache();
              this.nodeMap.set(nid, newEntry);
              localOnlySet.delete(localFile);
              handled = true;
            } catch (err) {
              console.error(`[SYNC] Failed to sync local ${strategy.name} for nodeId ${nid}:`, err.message);
            }
            break;
          }
        }
        if (handled) break;
      }
      if (handled) continue;

      // 4. No match → LOCAL DELETE
      // Check for delete conflict: if server modified the file after our last sync, re-download instead
      if (serverFile.modifiedAt && new Date(serverFile.modifiedAt).getTime() > this.lastSyncedAt) {
        console.log(`[SYNC] Delete conflict: ${entry.path} deleted locally but modified on server — re-downloading`);
        try {
          await this.downloadFile(serverFile.filename, serverPath, serverFile.nodeId);
        } catch (err) {
          console.error(`[SYNC] Failed to re-download ${serverPath} after delete conflict:`, err.message);
        }
        continue;
      }

      try {
        console.log(`[SYNC] Local delete detected: ${entry.path} (nodeId ${nid})`);
        this.pendingActions.set(`delete:${nid}`, Date.now());
        await deleteNode(this.serverUrl, this.apiKey, parseInt(nid));
        this.invalidateServerFilesCache();
        this.nodeMap.delete(nid);
      } catch (err) {
        console.error(`[SYNC] Failed to sync local delete for nodeId ${nid}:`, err.message);
      }
    }
  }

  /**
   * Download a file from server
   * @param {string} filename - Full filename including extension (may include folders)
   * @param {string} relativePath - Full path for local storage
   * @param {number} nodeId - Server node id
   */
  async downloadFile(filename, relativePath, nodeId) {
    try {
      const { content, modifiedAt } = await getNodeContent(
        this.serverUrl,
        this.apiKey,
        nodeId
      );

      const localFilename = relativePath || filename;
      this.resolveContainedPath(localFilename);
      const localPath = path.join(this.syncFolder, localFilename);

      // Create backup if file exists locally
      // Remove .html extension for siteName (matches server.js behavior)
      const siteName = localFilename.replace(/\.(html|htmlclay)$/i, '');
      await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this), this.logger);

      // Mark as expected write so file watcher doesn't send "File changed on disk" notification
      liveSync.markBrowserSave(siteName);

      // Write file with server modification time (ensures directories exist)
      await writeFile(localPath, content, modifiedAt);

      console.log(`[SYNC] Downloaded ${localFilename}`);

      // Log download success
      if (this.logger) {
        this.logger.success('DOWNLOAD', 'File downloaded', {
          file: this.logger.sanitizePath(localPath),
          modifiedAt
        });
      }

      // Emit success event
      this.emit('file-synced', {
        file: localFilename,
        action: 'download'
      });

    } catch (error) {
      console.error(`[SYNC] Failed to download ${filename}:`, error);

      // Log download error
      if (this.logger) {
        this.logger.error('DOWNLOAD', 'Download failed', {
          file: filename,
          error
        });
      }

      const errorInfo = classifyError(error, { filename, action: 'download' });
      this.stats.errors.push(formatErrorForLog(error, { filename, action: 'download' }));

      // Emit structured error
      this.emit('sync-error', errorInfo);
    }
  }

  /**
   * Handle file-saved SSE message - write stripped content to disk
   * @param {string} file - Site name (without .html)
   * @param {string} content - Stripped HTML content
   * @param {string} checksum - MD5 checksum of content
   * @param {string} modifiedAt - ISO timestamp
   */
  async handleFileSaved(file, content, checksum, modifiedAt, sseNodeId) {
    const localFilename = /\.(html|htmlclay)$/.test(file) ? file : `${file}.html`;
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);

    try {
      // Check if we already have this exact content at the target path
      try {
        const localContent = await readFile(localPath);
        const localChecksum = await calculateChecksum(localContent);

        if (localChecksum === checksum) {
          console.log(`[SYNC] SSE file-saved: ${file} already up to date (checksums match)`);
          if (sseNodeId) {
            const inode = await nodeMap.getInode(localPath);
            this.nodeMap.set(String(sseNodeId), { path: localFilename, checksum: localChecksum, inode });
          }
          return;
        }
      } catch (e) {
        // File doesn't exist at target path
      }

      // Create backup if file exists
      const siteName = localFilename.replace(/\.(html|htmlclay)$/i, '');
      await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this), this.logger);

      // Ensure directory exists (for nested paths)
      await ensureDirectory(path.dirname(localPath));

      // Mark as expected write so file watcher doesn't send "File changed on disk" notification
      liveSync.markBrowserSave(file);

      // Write file with server modification time
      await writeFile(localPath, content, new Date(modifiedAt));

      if (sseNodeId) {
        const inode = await nodeMap.getInode(localPath);
        const cs = await calculateChecksum(content);
        this.nodeMap.set(String(sseNodeId), { path: localFilename, checksum: cs, inode });
        await nodeMap.save(this.metaDir, this.nodeMap);
      }

      console.log(`[SYNC] SSE file-saved: Downloaded ${localFilename}`);
      this.stats.filesDownloaded++;

      // Emit success event
      this.emit('file-synced', {
        file: localFilename,
        action: 'download',
        source: 'sse'
      });

    } catch (error) {
      console.error(`[SYNC] SSE file-saved: Failed to write ${localFilename}:`, error.message);

      if (this.logger) {
        this.logger.error('SSE', 'Failed to write file-saved', {
          file: localFilename,
          error
        });
      }

      const errorInfo = classifyError(error, { filename: localFilename, action: 'sse-download' });
      this.stats.errors.push(formatErrorForLog(error, { filename: localFilename, action: 'sse-download' }));
      this.emit('sync-error', errorInfo);
    }
  }

  async handleFileRenamed(nodeId, oldName, newName) {
    const entry = this.nodeMap.get(String(nodeId));
    if (!entry) {
      console.log(`[SYNC] SSE file-renamed: nodeId ${nodeId} not in map, skipping`);
      return;
    }
    const currentPath = entry.path;

    const localPath = path.join(this.syncFolder, currentPath);
    const dir = path.dirname(currentPath);
    const newLocalFilename = dir === '.' ? newName : `${dir}/${newName}`;
    this.resolveContainedPath(newLocalFilename);
    const newLocalPath = path.join(this.syncFolder, newLocalFilename);

    liveSync.markBrowserSave(toFileId(currentPath));
    liveSync.markBrowserSave(toFileId(newLocalFilename));
    await ensureDirectory(path.dirname(newLocalPath));
    await moveFile(localPath, newLocalPath);

    const inode = await nodeMap.getInode(newLocalPath);
    this.nodeMap.set(String(nodeId), { path: newLocalFilename, checksum: entry.checksum, inode });
    await nodeMap.save(this.metaDir, this.nodeMap);

    console.log(`[SYNC] SSE file-renamed: ${currentPath} → ${newLocalFilename}`);
  }

  async handleFileMoved(nodeId, file, fromPath, toPath) {
    this.resolveContainedPath(toPath);
    const entry = this.nodeMap.get(String(nodeId));
    const currentPath = entry?.path || fromPath;
    const localPath = path.join(this.syncFolder, currentPath);
    const newLocalPath = path.join(this.syncFolder, toPath);

    const exists = await fileExists(localPath);
    if (!exists) {
      const alreadyMoved = await fileExists(newLocalPath);
      if (alreadyMoved) {
        console.log(`[SYNC] SSE file-moved: ${toPath} already in place`);
      } else {
        console.log(`[SYNC] SSE file-moved: ${currentPath} not found locally, skipping`);
      }
      const inode = await nodeMap.getInode(newLocalPath);
      this.nodeMap.set(String(nodeId), { path: toPath, checksum: entry?.checksum || null, inode });
      await nodeMap.save(this.metaDir, this.nodeMap);
      return;
    }

    liveSync.markBrowserSave(toFileId(currentPath));
    liveSync.markBrowserSave(toFileId(toPath));
    await ensureDirectory(path.dirname(newLocalPath));
    await moveFile(localPath, newLocalPath);

    const movedInode = await nodeMap.getInode(newLocalPath);
    this.nodeMap.set(String(nodeId), { path: toPath, checksum: entry?.checksum || null, inode: movedInode });
    await nodeMap.save(this.metaDir, this.nodeMap);

    console.log(`[SYNC] SSE file-moved: ${currentPath} → ${toPath}`);
  }

  async handleFileDeleted(nodeId, file) {
    const entry = this.nodeMap.get(String(nodeId));
    const localFilename = entry?.path
      || (/\.(html|htmlclay)$/.test(file) ? file : `${file}.html`);
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);
    const trashPath = path.join(this.syncFolder, '.trash', localFilename);

    try {
      const exists = await fileExists(localPath);
      if (!exists) {
        console.log(`[SYNC] SSE file-deleted: ${localFilename} not found locally`);
        this.nodeMap.delete(String(nodeId));
        await nodeMap.save(this.metaDir, this.nodeMap);
        return;
      }

      await ensureDirectory(path.dirname(trashPath));
      liveSync.markBrowserSave(toFileId(localFilename));
      await moveFile(localPath, trashPath);

      this.nodeMap.delete(String(nodeId));
      await nodeMap.save(this.metaDir, this.nodeMap);

      console.log(`[SYNC] SSE file-deleted: Trashed ${localFilename}`);
      this.emit('file-synced', { file: localFilename, action: 'trash', source: 'sse' });
    } catch (error) {
      console.error(`[SYNC] SSE file-deleted: Failed to trash ${localFilename}:`, error.message);
    }
  }

  /**
   * Upload a file to server
   * @param {string} filename - Relative path WITH .html (may include folders)
   */
  async uploadFile(filename) {
    try {
      // Validate filename before uploading
      const validationResult = filename.includes('/')
        ? validateFullPath(filename)
        : validateFileName(filename, false);

      if (!validationResult.valid) {
        const validationError = new Error(validationResult.error);
        validationError.isValidationError = true;

        console.error(`[SYNC] Validation failed for ${filename}: ${validationResult.error}`);

        // Log validation error
        if (this.logger) {
          this.logger.error('VALIDATION', 'Filename validation failed', {
            file: filename,
            reason: validationResult.error
          });
        }

        // Emit validation error
        this.emit('sync-error', {
          file: filename,
          error: validationResult.error,
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          action: 'upload',
          canRetry: false
        });

        // Don't throw - just skip this file
        return;
      }

      const localPath = path.join(this.syncFolder, filename);
      const content = await readFile(localPath);
      const stat = await getFileStats(localPath);

      // Calculate checksum for skip optimization
      const localChecksum = await calculateChecksum(content);

      // Check if server already has this exact content using cached data
      try {
        const serverFiles = await this.fetchAndCacheServerFiles(false);
        const serverFile = serverFiles.find(f => f.filename === filename);

        if (serverFile && serverFile.checksum === localChecksum) {
          console.log(`[SYNC] SKIP upload ${filename} - server has same checksum`);
          this.stats.filesUploadedSkipped++;

          // Log upload skip
          if (this.logger) {
            this.logger.skip('UPLOAD', 'Upload skipped - checksums match', {
              file: this.logger.sanitizePath(localPath)
            });
          }

          return;
        }
      } catch (error) {
        // If checksum check fails, continue with upload
        console.log(`[SYNC] Could not verify server checksum, proceeding with upload: ${error.message}`);
      }

      // Try to get cached snapshot for platform live sync
      let snapshotHtml = null;
      try {
        const { getAndClearSnapshot } = require('../main/server.js');
        snapshotHtml = getAndClearSnapshot(filename);
        if (snapshotHtml) {
          console.log(`[SYNC] Including snapshot for platform live sync: ${filename}`);
        }
      } catch (err) {
        // Server module not available or getAndClearSnapshot not exported
      }

      // Check nodeMap for an existing nodeId for this file path
      let existingNodeId = null;
      for (const [nid, entry] of this.nodeMap) {
        if (entry.path === filename) {
          existingNodeId = parseInt(nid);
          break;
        }
      }

      let result;
      if (existingNodeId) {
        result = await putNodeContent(
          this.serverUrl,
          this.apiKey,
          existingNodeId,
          content,
          {
            modifiedAt: stat.mtime,
            snapshotHtml,
            senderId: this.deviceId
          }
        );
        result.nodeId = existingNodeId;
      } else {
        const pathParts = filename.split('/').filter(Boolean);
        const name = pathParts[pathParts.length - 1];
        const folderPath = pathParts.slice(0, -1).join('/');
        const parentId = this.resolveParentIdByPath(folderPath);

        const createdNode = await createNode(this.serverUrl, this.apiKey, {
          type: 'site',
          name,
          parentId,
          content,
          modifiedAt: stat.mtime
        });
        result = { nodeId: createdNode.id };
      }

      if (result.nodeId) {
        const inode = await nodeMap.getInode(path.join(this.syncFolder, filename));
        this.nodeMap.set(String(result.nodeId), { path: filename, checksum: localChecksum, inode });
        await nodeMap.save(this.metaDir, this.nodeMap);
      }

      console.log(`[SYNC] Uploaded ${filename}`);
      this.stats.filesUploaded++;

      // Log upload success
      if (this.logger) {
        this.logger.success('UPLOAD', 'File uploaded', {
          file: this.logger.sanitizePath(localPath),
          modifiedAt: stat.mtime
        });
      }

      // Invalidate cache since server state changed
      this.invalidateServerFilesCache();

      // Emit success event
      this.emit('file-synced', {
        file: filename,
        action: 'upload'
      });

    } catch (error) {
      console.error(`[SYNC] Failed to upload ${filename}:`, error);

      // Log upload error
      if (this.logger) {
        this.logger.error('UPLOAD', 'Upload failed', {
          file: filename,
          error
        });
      }

      // Check for detailed error structure (name conflicts)
      if (error.details) {
        this.emit('sync-conflict', {
          file: filename,
          conflict: 'name_taken',
          suggestions: error.details.suggestions,
          message: error.details.message
        });
      }

      const errorInfo = classifyError(error, { filename, action: 'upload' });
      this.stats.errors.push(formatErrorForLog(error, { filename, action: 'upload' }));

      // Emit structured error
      this.emit('sync-error', errorInfo);

      // Re-throw for retry logic
      throw error;
    }
  }

  queueSync(type, filename) {
    if (!this.isRunning) return;
    if (hasHiddenSegment(filename)) return;

    if (type === 'add' || type === 'change') {
      const eventType = type === 'add' ? 'add' : 'change';
      const classified = classifyPath(filename, eventType);

      if (classified !== 'folder') {
        const validationResult = filename.includes('/')
          ? validateFullPath(filename)
          : validateFileName(filename, false);

        if (!validationResult.valid) {
          console.error(`[SYNC] Cannot queue ${filename}: ${validationResult.error}`);
          if (this.logger) {
            this.logger.error('VALIDATION', 'Cannot queue file - validation failed', {
              file: filename,
              reason: validationResult.error
            });
          }
          this.emit('sync-error', {
            file: filename,
            error: validationResult.error,
            type: 'validation',
            priority: ERROR_PRIORITY.HIGH,
            action: 'queue',
            canRetry: false
          });
          return;
        }
      }
    }

    if (!this.syncQueue.add(type, filename)) {
      return;
    }

    this.syncQueue.setQueueTimer(() => {
      if (this.isRunning) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (!this.isRunning || this.syncQueue.isProcessingQueue() || this.syncQueue.isEmpty()) {
      return;
    }

    this.syncQueue.setProcessing(true);

    while (!this.syncQueue.isEmpty()) {
      const item = this.syncQueue.next();

      try {
        if (item.type === 'add' || item.type === 'change') {
          let type = null;
          for (const [, entry] of this.nodeMap) {
            if (entry.path === item.filename) {
              type = entry.type;
              break;
            }
          }
          if (!type) {
            type = classifyPath(item.filename, item.type === 'add' ? 'add' : 'change');
          }

          if (type === 'folder') {
            await this.createFolderOnServer(item.filename);
          } else if (type === 'upload') {
            await this.uploadUploadFile(item.filename);
          } else {
            await this.uploadFile(item.filename);
          }
        }

        this.syncQueue.clearRetry(item.filename);

        if (this.logger) {
          this.logger.success('QUEUE', 'Queue item processed', {
            file: item.filename,
            type: item.type
          });
        }

      } catch (error) {
        if (this.logger) {
          this.logger.error('QUEUE', 'Queue processing failed', {
            file: item.filename,
            type: item.type,
            error
          });
        }

        const retryResult = this.syncQueue.scheduleRetry(
          item,
          error,
          (retryItem) => {
            if (this.isRunning) {
              const filePath = path.join(this.syncFolder, retryItem.filename);
              if (fileExists(filePath)) {
                this.queueSync(retryItem.type, retryItem.filename);
              } else {
                this.syncQueue.clearRetry(retryItem.filename);
              }
            }
          }
        );

        if (!retryResult.shouldRetry) {
          console.error(`[SYNC] Permanent failure for ${item.filename}: ${retryResult.reason}`);
          this.emit('sync-failed', {
            file: item.filename,
            error: error.message,
            priority: ERROR_PRIORITY.CRITICAL,
            finalFailure: true,
            attempts: retryResult.attempts
          });
        } else {
          if (this.logger) {
            this.logger.warn('QUEUE', 'Retry scheduled', {
              file: item.filename,
              attempt: retryResult.attempt,
              maxAttempts: retryResult.maxAttempts,
              nextRetryIn: retryResult.nextRetryIn
            });
          }
          this.emit('sync-retry', {
            file: item.filename,
            attempt: retryResult.attempt,
            maxAttempts: retryResult.maxAttempts,
            nextRetryIn: retryResult.nextRetryIn,
            error: error.message
          });
        }
      }
    }

    this.stats.lastSync = new Date().toISOString();
    this.emit('sync-stats', this.stats);
    this.syncQueue.setProcessing(false);
  }

  startUnifiedWatcher() {
    this.watcher = chokidar.watch('**/*', {
      cwd: this.syncFolder,
      persistent: true,
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/sites-versions/**',
        '**/tailwindcss/**',
        '**/.*',
        '**/.*/**',
        '**/.DS_Store',
        '**/Thumbs.db',
        '**/.trash/**'
      ],
      awaitWriteFinish: SYNC_CONFIG.FILE_STABILIZATION
    });

    this.watcher
      .on('add',       (filename) => this._onAdd(filename))
      .on('addDir',    (dirname)  => this._onAddDir(dirname))
      .on('change',    (filename) => this._onChange(filename))
      .on('unlink',    (filename) => this._onUnlink(filename))
      .on('unlinkDir', (dirname)  => this._onUnlinkDir(dirname))
      .on('error', (error) => {
        console.error('[SYNC] Watcher error:', error);
        this.stats.errors.push(formatErrorForLog(error, { action: 'watcher' }));
        if (this.logger) {
          this.logger.error('WATCHER', 'File watcher error', { error });
        }
      });

    console.log('[SYNC] Unified watcher started (sites + uploads + folders)');

    if (this.logger) {
      this.logger.info('WATCHER', 'Unified watcher started', {
        syncFolder: this.logger.sanitizePath(this.syncFolder)
      });
    }
  }

  // --- Event handler shims ---

  _onAdd(filename) {
    const normalizedPath = path.normalize(filename);

    if (this._consumeSuppressedEvent(normalizedPath)) {
      console.log(`[SYNC] Watcher: Suppressed cascade event for ${normalizedPath}`);
      return;
    }

    this._maybeResolveFolderIdentityWaiter(normalizedPath);

    const type = classifyPath(normalizedPath, 'add');

    if (this._tryCorrelatePendingUnlink(normalizedPath, type)) {
      return;
    }

    if (type === 'site') {
      this._handleSiteAdd(normalizedPath);
    } else if (type === 'upload') {
      this._handleUploadAdd(normalizedPath);
    }
  }

  _onAddDir(dirname) {
    const normalizedPath = path.normalize(dirname);

    if (!normalizedPath || normalizedPath === '' || normalizedPath === '.') return;

    if (this._consumeSuppressedEvent(normalizedPath)) {
      console.log(`[SYNC] Watcher: Suppressed cascade event for ${normalizedPath}`);
      return;
    }

    if (this._tryCorrelatePendingUnlink(normalizedPath, 'folder')) {
      return;
    }

    this._handleFolderAdd(normalizedPath);
  }

  _onChange(filename) {
    const normalizedPath = path.normalize(filename);

    if (this._consumeSuppressedEvent(normalizedPath)) return;

    const type = classifyPath(normalizedPath, 'change');
    if (type === 'site') {
      this._handleSiteChange(normalizedPath);
    } else if (type === 'upload') {
      this._handleUploadChange(normalizedPath);
    }
  }

  _onUnlink(filename) {
    const normalizedPath = path.normalize(filename);

    if (this._consumeSuppressedEvent(normalizedPath)) return;

    const type = classifyPath(normalizedPath, 'unlink');
    this._registerPendingUnlink(normalizedPath, type);
  }

  _onUnlinkDir(dirname) {
    const normalizedPath = path.normalize(dirname);

    if (!normalizedPath || normalizedPath === '' || normalizedPath === '.') return;

    if (this._consumeSuppressedEvent(normalizedPath)) return;

    this._registerPendingUnlink(normalizedPath, 'folder');
  }

  // --- Type-tagged correlator ---

  _registerPendingUnlink(normalizedPath, type) {
    const UNLINK_GRACE_PERIOD = 1500;

    let foundNodeId = null;
    let foundEntry = null;
    for (const [nid, entry] of this.nodeMap) {
      if (entry.type === type && entry.path === normalizedPath) {
        foundNodeId = nid;
        foundEntry = entry;
        break;
      }
    }

    if (!foundNodeId) {
      console.log(`[SYNC] Watcher: ${type} unlink for untracked path: ${normalizedPath}`);
      return;
    }

    const timerId = setTimeout(async () => {
      this.pendingUnlinks.delete(normalizedPath);
      console.log(`[SYNC] Watcher: Local ${type} delete detected: ${normalizedPath} (nodeId ${foundNodeId})`);
      try {
        this.pendingActions.set(`delete:${foundNodeId}`, Date.now());
        await deleteNode(this.serverUrl, this.apiKey, parseInt(foundNodeId));
        this.invalidateServerNodesCache();

        if (type === 'folder') {
          const descendants = nodeMap.walkDescendants(this.nodeMap, normalizedPath);
          for (const { nodeId: descId } of descendants) {
            this.nodeMap.delete(descId);
          }
        }

        this.nodeMap.delete(foundNodeId);
        await nodeMap.save(this.metaDir, this.nodeMap);
      } catch (err) {
        console.error(`[SYNC] Watcher: Failed to sync ${type} delete for ${normalizedPath}:`, err.message);
      }
    }, UNLINK_GRACE_PERIOD);

    this.pendingUnlinks.set(normalizedPath, {
      timerId,
      nodeId: foundNodeId,
      type,
      entry: foundEntry
    });
  }

  _tryCorrelatePendingUnlink(normalizedPath, type) {
    const addBasename = path.basename(normalizedPath);
    const addDirname = path.dirname(normalizedPath);

    for (const [oldPath, pending] of this.pendingUnlinks) {
      if (pending.type !== type) continue;

      const oldBasename = path.basename(oldPath);
      const oldDirname = path.dirname(oldPath);

      const isMove = oldBasename === addBasename && oldDirname !== addDirname;
      const isRename = oldBasename !== addBasename && oldDirname === addDirname;
      const isMoveRename = oldBasename !== addBasename && oldDirname !== addDirname;

      if (!(isMove || isRename || isMoveRename)) continue;

      clearTimeout(pending.timerId);
      this.pendingUnlinks.delete(oldPath);

      const shape = isMove ? 'move' : isRename ? 'rename' : 'move+rename';
      if (type === 'folder') {
        this._correlateFolderUnlinkAdd(oldPath, normalizedPath, pending, shape).catch(err =>
          console.error(`[SYNC] Watcher: Folder correlation failed for ${oldPath}:`, err)
        );
      } else {
        this._correlateFileUnlinkAdd(oldPath, normalizedPath, pending, shape, type).catch(err =>
          console.error(`[SYNC] Watcher: ${type} correlation failed for ${oldPath}:`, err)
        );
      }

      return true;
    }

    return false;
  }

  async _correlateFileUnlinkAdd(oldPath, newPath, pending, shape, type) {
    const newFullPath = path.join(this.syncFolder, newPath);
    const newInode = await nodeMap.getInode(newFullPath);

    let isSameFile = false;
    if (pending.entry.inode && newInode && pending.entry.inode === newInode) {
      isSameFile = true;
    } else if (pending.entry.checksum) {
      try {
        const content = type === 'site'
          ? await readFile(newFullPath)
          : await readFileBuffer(newFullPath);
        const newChecksum = type === 'site'
          ? await calculateChecksum(content)
          : calculateBufferChecksum(content);
        isSameFile = newChecksum === pending.entry.checksum;
      } catch (e) {
        // File read failed — can't verify checksum
      }
    } else {
      isSameFile = true;
    }

    if (!isSameFile) {
      console.log(`[SYNC] Watcher: Identity mismatch for ${oldPath} → ${newPath}, treating as delete+add`);
      try {
        this.pendingActions.set(`delete:${pending.nodeId}`, Date.now());
        await deleteNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId));
        this.invalidateServerNodesCache();
        this.nodeMap.delete(pending.nodeId);
        await nodeMap.save(this.metaDir, this.nodeMap);
      } catch (err) {
        console.error(`[SYNC] Watcher: Failed to sync delete for ${oldPath}:`, err.message);
      }
      this.queueSync('add', newPath);
      return;
    }

    const addBasename = path.basename(newPath);
    const newDirname = path.dirname(newPath);
    const newFolderPath = newDirname === '.' ? '' : newDirname;

    try {
      if (shape === 'move') {
        console.log(`[SYNC] Watcher: Local ${type} move detected: ${oldPath} → ${newPath}`);
        this.pendingActions.set(`move:${pending.nodeId}`, Date.now());
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await moveNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), targetParentId);
      } else if (shape === 'rename') {
        console.log(`[SYNC] Watcher: Local ${type} rename detected: ${oldPath} → ${newPath}`);
        this.pendingActions.set(`rename:${pending.nodeId}`, Date.now());
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
      } else {
        console.log(`[SYNC] Watcher: Local ${type} move+rename detected: ${oldPath} → ${newPath}`);
        this.pendingActions.set(`rename:${pending.nodeId}`, Date.now());
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
        this.pendingActions.set(`move:${pending.nodeId}`, Date.now());
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await moveNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), targetParentId);
      }

      this.invalidateServerNodesCache();
      this.nodeMap.set(pending.nodeId, {
        type,
        path: newPath,
        checksum: pending.entry.checksum,
        inode: newInode
      });
      await nodeMap.save(this.metaDir, this.nodeMap);
    } catch (err) {
      console.error(`[SYNC] Watcher: Failed to sync ${shape} for ${oldPath}:`, err.message);
    }
  }

  // --- Cascade suppression ---

  _markDescendantsForSuppression(descendantPaths) {
    const expiresAt = Date.now() + this.FOLDER_RENAME_SUPPRESSION_TTL_MS;
    for (const p of descendantPaths) {
      this.recentFolderRenameDescendants.set(p, expiresAt);
    }
  }

  _consumeSuppressedEvent(normalizedPath) {
    const expiresAt = this.recentFolderRenameDescendants.get(normalizedPath);
    if (expiresAt === undefined) return false;

    if (expiresAt < Date.now()) {
      this.recentFolderRenameDescendants.delete(normalizedPath);
      return false;
    }

    this.recentFolderRenameDescendants.delete(normalizedPath);
    return true;
  }

  _sweepFolderRenameSuppressionSet() {
    const now = Date.now();
    for (const [p, expiresAt] of this.recentFolderRenameDescendants) {
      if (expiresAt < now) {
        this.recentFolderRenameDescendants.delete(p);
      }
    }
  }

  // --- Folder identity (S5-Q2) ---

  async _correlateFolderUnlinkAdd(oldPath, newPath, pending, shape) {
    const newFullPath = path.join(this.syncFolder, newPath);
    let isSameFolder = false;
    let reason = '';

    const newInode = await nodeMap.getInode(newFullPath);
    if (pending.entry.inode && newInode && pending.entry.inode === newInode) {
      isSameFolder = true;
      reason = 'inode-match';
    } else {
      const knownDescendantBasenames = new Set(
        nodeMap.walkDescendants(this.nodeMap, oldPath)
          .map(({ entry }) => path.basename(entry.path))
      );

      if (knownDescendantBasenames.size === 0) {
        isSameFolder = true;
        reason = 'empty-folder';
      } else {
        try {
          const firstAddBasename = await this._waitForFirstDescendantAdd(newPath, this.FOLDER_IDENTITY_WAIT_MS);
          if (firstAddBasename && knownDescendantBasenames.has(firstAddBasename)) {
            isSameFolder = true;
            reason = 'descendant-name-match';
          } else {
            reason = firstAddBasename ? 'descendant-mismatch' : 'no-descendant-in-window';
          }
        } catch (e) {
          reason = 'identity-wait-error';
        }
      }
    }

    console.log(`[SYNC] Watcher: Folder identity for ${oldPath} → ${newPath}: ${isSameFolder ? 'CONFIRMED' : 'REJECTED'} (${reason})`);

    if (!isSameFolder) {
      try {
        this.pendingActions.set(`delete:${pending.nodeId}`, Date.now());
        await deleteNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId));
        this.invalidateServerNodesCache();
        const oldDescendants = nodeMap.walkDescendants(this.nodeMap, oldPath);
        for (const { nodeId: descId } of oldDescendants) {
          this.nodeMap.delete(descId);
        }
        this.nodeMap.delete(pending.nodeId);
        await nodeMap.save(this.metaDir, this.nodeMap);
      } catch (err) {
        console.error(`[SYNC] Watcher: Failed to sync folder delete for ${oldPath}:`, err.message);
      }
      this._handleFolderAdd(newPath);
      return;
    }

    const oldDescendants = nodeMap.walkDescendants(this.nodeMap, oldPath);
    const expectedNewPaths = oldDescendants.map(({ entry }) => {
      return newPath + entry.path.substring(oldPath.length);
    });
    this._markDescendantsForSuppression([newPath, ...expectedNewPaths]);

    const addBasename = path.basename(newPath);
    const newDirname = path.dirname(newPath);
    const newFolderPath = newDirname === '.' ? '' : newDirname;

    try {
      if (shape === 'move') {
        console.log(`[SYNC] Watcher: Local folder move detected: ${oldPath} → ${newPath}`);
        this.pendingActions.set(`move:${pending.nodeId}`, Date.now());
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await moveNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), targetParentId);
      } else if (shape === 'rename') {
        console.log(`[SYNC] Watcher: Local folder rename detected: ${oldPath} → ${newPath}`);
        this.pendingActions.set(`rename:${pending.nodeId}`, Date.now());
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
      } else {
        console.log(`[SYNC] Watcher: Local folder move+rename detected: ${oldPath} → ${newPath}`);
        this.pendingActions.set(`rename:${pending.nodeId}`, Date.now());
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
        this.pendingActions.set(`move:${pending.nodeId}`, Date.now());
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await moveNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), targetParentId);
      }
      this.invalidateServerNodesCache();

      for (const { nodeId: descId, entry } of oldDescendants) {
        const newEntryPath = newPath + entry.path.substring(oldPath.length);
        this.nodeMap.set(descId, { ...entry, path: newEntryPath });
      }

      this.nodeMap.set(pending.nodeId, {
        type: 'folder',
        path: newPath,
        parentId: pending.entry.parentId,
        inode: newInode
      });

      await nodeMap.save(this.metaDir, this.nodeMap);
    } catch (err) {
      console.error(`[SYNC] Watcher: Failed to sync folder ${shape} for ${oldPath}:`, err.message);
    }
  }

  _waitForFirstDescendantAdd(parentPath, timeoutMs) {
    return new Promise((resolve) => {
      const timerId = setTimeout(() => {
        if (this.folderIdentityWaiters.get(parentPath)?.resolve === resolve) {
          this.folderIdentityWaiters.delete(parentPath);
        }
        resolve(null);
      }, timeoutMs);

      this.folderIdentityWaiters.set(parentPath, { resolve, timerId });
    });
  }

  _maybeResolveFolderIdentityWaiter(normalizedPath) {
    for (const [parentPath, waiter] of this.folderIdentityWaiters) {
      const parentPrefix = parentPath + '/';
      if (normalizedPath.startsWith(parentPrefix)) {
        const basename = path.basename(normalizedPath);
        clearTimeout(waiter.timerId);
        this.folderIdentityWaiters.delete(parentPath);
        waiter.resolve(basename);
        break;
      }
    }
  }

  // --- Type-specific handlers ---

  _handleSiteAdd(normalizedPath) {
    console.log(`[SYNC] Site added: ${normalizedPath}`);
    this.queueSync('add', normalizedPath);

    const fileId = normalizedPath.replace(/\.(html|htmlclay)$/, '');
    if (!liveSync.wasBrowserSave(fileId)) {
      liveSync.notify(fileId, {
        msgType: 'info',
        msg: 'New file created',
        action: 'reload'
      });
    }
  }

  async _handleSiteChange(normalizedPath) {
    const fileId = normalizedPath.replace(/\.(html|htmlclay)$/, '');

    try {
      const localPath = path.join(this.syncFolder, normalizedPath);
      const content = await readFile(localPath);
      const newChecksum = await calculateChecksum(content);

      let storedChecksum = null;
      for (const [, entry] of this.nodeMap) {
        if (entry.path === normalizedPath && entry.type === 'site') {
          storedChecksum = entry.checksum;
          break;
        }
      }

      if (storedChecksum && storedChecksum === newChecksum) {
        console.log(`[SYNC] File changed but content identical (skipping): ${normalizedPath}`);
        return;
      }
    } catch (e) {
      // File read failed — fall through
    }

    console.log(`[SYNC] Site changed: ${normalizedPath}`);
    this.queueSync('change', normalizedPath);

    const recentSseSave = this.recentSseFileSaves.has(fileId);
    if (!liveSync.wasBrowserSave(fileId) && !recentSseSave) {
      liveSync.notify(fileId, {
        msgType: 'warning',
        msg: 'File changed on disk',
        action: 'reload',
        persistent: true
      });
    } else if (recentSseSave) {
      console.log(`[SYNC] Suppressing toast for ${fileId} (recent SSE file-saved)`);
    }
  }

  _handleUploadAdd(normalizedPath) {
    console.log(`[SYNC] Upload added: ${normalizedPath}`);
    this.queueSync('add', normalizedPath);
  }

  async _handleUploadChange(normalizedPath) {
    try {
      const localPath = path.join(this.syncFolder, normalizedPath);
      const content = await readFileBuffer(localPath);
      const newChecksum = calculateBufferChecksum(content);

      let storedChecksum = null;
      for (const [, entry] of this.nodeMap) {
        if (entry.path === normalizedPath && entry.type === 'upload') {
          storedChecksum = entry.checksum;
          break;
        }
      }

      if (storedChecksum && storedChecksum === newChecksum) {
        console.log(`[SYNC] Upload changed but content identical (skipping): ${normalizedPath}`);
        return;
      }
    } catch (e) {
      // File read failed — fall through
    }

    console.log(`[SYNC] Upload changed: ${normalizedPath}`);
    this.queueSync('change', normalizedPath);
  }

  _handleFolderAdd(normalizedPath) {
    console.log(`[SYNC] Folder added: ${normalizedPath}`);
    this.createFolderOnServer(normalizedPath).catch(err => {
      console.error(`[SYNC] Failed to create folder ${normalizedPath}:`, err.message);
    });
  }

  // --- Folder create on server ---

  async createFolderOnServer(relativePath) {
    try {
      const pathParts = relativePath.split('/').filter(Boolean);
      const name = pathParts[pathParts.length - 1];
      const parentFolderPath = pathParts.slice(0, -1).join('/');

      const parentId = this.resolveParentIdByPath(parentFolderPath);

      for (const [, entry] of this.nodeMap) {
        if (entry.type === 'folder' && entry.path === relativePath) {
          console.log(`[SYNC] Folder already tracked in nodeMap: ${relativePath}`);
          return;
        }
      }

      console.log(`[SYNC] Creating folder on server: ${relativePath} (parentId=${parentId})`);
      const createdNode = await createNode(this.serverUrl, this.apiKey, {
        type: 'folder',
        name,
        parentId
      });

      this.pendingActions.set(`save:${createdNode.id}`, Date.now());

      const fullPath = path.join(this.syncFolder, relativePath);
      const inode = await nodeMap.getInode(fullPath);
      this.nodeMap.set(String(createdNode.id), {
        type: 'folder',
        path: relativePath,
        parentId: createdNode.parentId,
        inode
      });
      await nodeMap.save(this.metaDir, this.nodeMap);

      this.invalidateServerNodesCache();
      this.emit('file-synced', { file: relativePath, action: 'create', type: 'folder' });

    } catch (error) {
      console.error(`[SYNC] Failed to create folder ${relativePath}:`, error.message);
      if (this.logger) {
        this.logger.error('SYNC', 'Folder create failed', { file: relativePath, error });
      }
      const errorInfo = classifyError(error, { filename: relativePath, action: 'create-folder' });
      this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'create-folder' }));
      this.emit('sync-error', errorInfo);
      throw error;
    }
  }

  // ===========================================================================
  // UPLOAD SYNC METHODS
  // ===========================================================================

  /**
   * Perform initial sync for uploads
   */
  async performInitialUploadSync() {
    console.log('[SYNC] Starting initial upload sync...');
    this.emit('sync-start', { type: 'initial-uploads' });

    try {
      const serverUploads = await this.fetchAndCacheServerUploads(true);
      const localUploads = await getLocalUploads(this.syncFolder);

      // Download server uploads not present locally
      for (const serverUpload of serverUploads) {
        const localPath = path.join(this.syncFolder, serverUpload.path);
        const localExists = localUploads.has(serverUpload.path);

        if (!localExists) {
          try {
            await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
            this.stats.uploadsDownloaded++;
            if (serverUpload.nodeId) {
              this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
            }
          } catch (error) {
            console.error(`[SYNC] Failed to download upload ${serverUpload.path}:`, error.message);
            this.stats.errors.push(formatErrorForLog(error, { filename: serverUpload.path, action: 'initial-upload-download' }));
          }
        } else {
          try {
            const localInfo = localUploads.get(serverUpload.path);

            // Check if local is future-dated
            if (isFutureFile(localInfo.mtime, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - future-dated`);
              this.stats.uploadsProtected++;
              if (serverUpload.nodeId) {
                this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: null, inode: null });
              }
              continue;
            }

            // Check if local is newer
            if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer`);
              this.stats.uploadsProtected++;
              if (serverUpload.nodeId) {
                this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: null, inode: null });
              }
              continue;
            }

            // Check checksums
            const localContent = await readFileBuffer(localPath);
            const localChecksum = calculateBufferChecksum(localContent);

            if (localChecksum === serverUpload.checksum) {
              console.log(`[SYNC] SKIP upload ${serverUpload.path} - checksums match`);
              this.stats.uploadsSkipped++;
              if (serverUpload.nodeId) {
                this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: localChecksum, inode: null });
              }
              continue;
            }

            // Server is newer, download it
            await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
            this.stats.uploadsDownloaded++;
            if (serverUpload.nodeId) {
              this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
            }
          } catch (error) {
            console.error(`[SYNC] Failed to process upload ${serverUpload.path}:`, error.message);
            this.stats.errors.push(formatErrorForLog(error, { filename: serverUpload.path, action: 'initial-upload-check' }));
          }
        }
      }

      // Upload local files not on server
      for (const [relativePath, localInfo] of localUploads) {
        const serverUpload = serverUploads.find(u => u.path === relativePath);

        if (!serverUpload) {
          console.log(`[SYNC] LOCAL ONLY upload: ${relativePath} - uploading`);
          try {
            await this.uploadUploadFile(relativePath);
            // Note: uploadsUploaded is incremented inside uploadUploadFile
          } catch (error) {
            console.error(`[SYNC] Failed to upload ${relativePath}:`, error.message);
            this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'initial-upload-upload' }));
          }
        }
      }

      await nodeMap.save(this.metaDir, this.nodeMap);

      console.log('[SYNC] Initial upload sync complete');
      this.emit('sync-complete', { type: 'initial-uploads', stats: this.stats });

    } catch (error) {
      console.error('[SYNC] Initial upload sync failed:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'initial-upload-sync' }));
      // Don't throw - allow sync to continue even if upload sync fails
    }
  }

  /**
   * Download an upload file from server
   */
  async downloadUploadFile(serverPath, nodeId) {
    this.resolveContainedPath(serverPath);
    try {
      const { content, modifiedAt } = await getNodeContent(
        this.serverUrl,
        this.apiKey,
        nodeId
      );

      const localPath = path.join(this.syncFolder, serverPath);

      // Create binary backup if file exists (preserves images, PDFs, etc.)
      await createBinaryBackupIfExists(localPath, serverPath, this.syncFolder, this.emit.bind(this), this.logger);

      // Write file
      await writeFileBuffer(localPath, content, modifiedAt);

      console.log(`[SYNC] Downloaded upload: ${serverPath}`);

      if (this.logger) {
        this.logger.success('DOWNLOAD', 'Upload downloaded', { file: serverPath });
      }

      this.emit('file-synced', { file: serverPath, action: 'download', type: 'upload' });

    } catch (error) {
      console.error(`[SYNC] Failed to download upload ${serverPath}:`, error);

      if (this.logger) {
        this.logger.error('DOWNLOAD', 'Upload download failed', { file: serverPath, error });
      }

      const errorInfo = classifyError(error, { filename: serverPath, action: 'download-upload' });
      this.stats.errors.push(formatErrorForLog(error, { filename: serverPath, action: 'download-upload' }));
      this.emit('sync-error', errorInfo);
    }
  }

  /**
   * Upload an upload file to server
   */
  async uploadUploadFile(relativePath) {
    try {
      // Validate path
      const validationResult = validateUploadPath(relativePath);
      if (!validationResult.valid) {
        console.error(`[SYNC] Validation failed for upload ${relativePath}: ${validationResult.error}`);
        this.emit('sync-error', {
          file: relativePath,
          error: validationResult.error,
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          canRetry: false
        });
        return;
      }

      const localPath = path.join(this.syncFolder, relativePath);
      const content = await readFileBuffer(localPath);
      const stat = await getFileStats(localPath);

      // Check size limit (10MB)
      if (content.length > 10 * 1024 * 1024) {
        this.emit('sync-error', {
          file: relativePath,
          error: 'File exceeds 10MB limit',
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          canRetry: false
        });
        return;
      }

      // Check if server has same content
      const localChecksum = calculateBufferChecksum(content);

      try {
        const serverUploads = await this.fetchAndCacheServerUploads(false);
        const serverUpload = serverUploads.find(u => u.path === relativePath);

        if (serverUpload && serverUpload.checksum === localChecksum) {
          console.log(`[SYNC] SKIP upload ${relativePath} - server has same checksum`);
          this.stats.uploadsSkipped++;
          return;
        }
      } catch (error) {
        console.log(`[SYNC] Could not verify server checksum, proceeding: ${error.message}`);
      }

      // Check nodeMap for an existing nodeId for this upload path
      let existingNodeId = null;
      for (const [nid, entry] of this.nodeMap) {
        if (entry.path === relativePath) {
          existingNodeId = parseInt(nid);
          break;
        }
      }

      let resultNodeId = existingNodeId;
      if (existingNodeId) {
        await putNodeContent(
          this.serverUrl,
          this.apiKey,
          existingNodeId,
          content,
          { modifiedAt: stat.mtime }
        );
      } else {
        const pathParts = relativePath.split('/').filter(Boolean);
        const name = pathParts[pathParts.length - 1];
        const folderPath = pathParts.slice(0, -1).join('/');
        const parentId = this.resolveParentIdByPath(folderPath);

        const createdNode = await createNode(this.serverUrl, this.apiKey, {
          type: 'upload',
          name,
          parentId,
          content,
          modifiedAt: stat.mtime
        });
        resultNodeId = createdNode.id;
      }

      if (resultNodeId) {
        this.nodeMap.set(String(resultNodeId), { path: relativePath, checksum: localChecksum, inode: null });
        await nodeMap.save(this.metaDir, this.nodeMap);
      }

      console.log(`[SYNC] Uploaded: ${relativePath}`);
      this.stats.uploadsUploaded++;

      // Invalidate cache
      this.invalidateServerUploadsCache();

      this.emit('file-synced', { file: relativePath, action: 'upload', type: 'upload' });

    } catch (error) {
      console.error(`[SYNC] Failed to upload ${relativePath}:`, error);

      if (this.logger) {
        this.logger.error('UPLOAD', 'Upload failed', { file: relativePath, error });
      }

      const errorInfo = classifyError(error, { filename: relativePath, action: 'upload-upload' });
      this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'upload-upload' }));
      this.emit('sync-error', errorInfo);
      throw error;
    }
  }

  async populateFolderNodeMap() {
    console.log('[SYNC] Populating folder nodeMap entries...');

    const nodes = await this.fetchAndCacheServerNodes(true);
    const folders = nodes.filter(n => n.type === 'folder');

    let added = 0;
    for (const folder of folders) {
      const fullPath = folder.path ? `${folder.path}/${folder.name}` : folder.name;
      const localPath = path.join(this.syncFolder, fullPath);

      try {
        await ensureDirectory(localPath);
      } catch (error) {
        console.warn(`[SYNC] Could not create local folder ${fullPath}:`, error.message);
      }

      const inode = await nodeMap.getInode(localPath);
      this.nodeMap.set(String(folder.id), {
        type: 'folder',
        path: fullPath,
        parentId: folder.parentId,
        inode
      });
      added++;
    }

    await nodeMap.save(this.metaDir, this.nodeMap);
    console.log(`[SYNC] Added ${added} folder(s) to nodeMap`);
  }

  /**
   * Connect to SSE stream for real-time sync notifications
   */
  connectToStream() {
    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
    }

    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }

    const url = `${this.serverUrl}/sync/stream`;
    console.log(`[SYNC] Connecting to SSE stream: ${url}`);

    const apiKey = this.apiKey;
    this.sseConnection = new EventSource(url, {
      fetch: (input, init) => fetch(input, {
        ...init,
        headers: {
          ...init.headers,
          'X-API-Key': apiKey
        }
      })
    });

    this.sseConnection.onopen = () => {
      console.log('[SYNC] SSE stream connected');
      this.lastSseActivity = Date.now();
      this.startSseWatchdog();
      if (this.logger) {
        this.logger.info('SSE', 'Stream connected');
      }
    };

    const skipIfEcho = (actionType, nodeId) => {
      const key = `${actionType}:${nodeId}`;
      if (this.pendingActions.has(key)) {
        this.pendingActions.delete(key);
        console.log(`[SYNC] SSE: Skipping self-initiated ${actionType} for nodeId ${nodeId}`);
        return true;
      }
      return false;
    };

    const sseDispatch = {
      'live-sync': async (data) => {
        const { file, html, sender } = data;
        if (sender === this.deviceId) {
          console.log(`[SYNC] SSE: Ignoring own live-sync for ${file}`);
          return;
        }
        console.log(`[SYNC] SSE: Received live-sync for ${file} from ${sender}`);
        liveSync.broadcast(file, { html, sender });
        if (this.logger) this.logger.success('SSE', 'Relayed live-sync to local browsers', { file });
      },
      'file-saved': async (data) => {
        console.log(`[SYNC] SSE: Received file-saved for ${data.file}`);
        this.recentSseFileSaves.set(data.file, Date.now());
        setTimeout(() => this.recentSseFileSaves.delete(data.file), 5000);
        await this.handleFileSaved(data.file, data.content, data.checksum, data.modifiedAt, data.nodeId);
        if (this.logger) this.logger.success('SSE', 'Handled file-saved', { file: data.file });
      },
      'file-renamed': async (data) => {
        if (skipIfEcho('rename', data.nodeId)) return;
        console.log(`[SYNC] SSE: Received file-renamed: ${data.oldName} → ${data.newName}`);
        await this.handleFileRenamed(data.nodeId, data.oldName, data.newName);
      },
      'file-moved': async (data) => {
        if (skipIfEcho('move', data.nodeId)) return;
        console.log(`[SYNC] SSE: Received file-moved: ${data.fromPath} → ${data.toPath}`);
        await this.handleFileMoved(data.nodeId, data.file, data.fromPath, data.toPath);
      },
      'file-deleted': async (data) => {
        if (skipIfEcho('delete', data.nodeId)) return;
        console.log(`[SYNC] SSE: Received file-deleted: ${data.file}`);
        await this.handleFileDeleted(data.nodeId, data.file);
      }
    };

    this.sseConnection.onmessage = async (event) => {
      if (!this.isRunning) return;
      this.lastSseActivity = Date.now();

      try {
        const data = JSON.parse(event.data);
        const type = data.type || 'live-sync';
        const handler = sseDispatch[type];
        if (handler) await handler(data);
      } catch (error) {
        console.error('[SYNC] SSE: Error processing message:', error.message);
        if (this.logger) {
          this.logger.error('SSE', 'Error processing stream message', { error });
        }
      }
    };

    this.sseConnection.onerror = (error) => {
      console.error('[SYNC] SSE stream error:', error.message || 'Connection error');

      // Only attempt reconnect if we're still running
      if (this.isRunning && !this.sseReconnectTimer) {
        console.log('[SYNC] SSE: Will reconnect in 5 seconds...');
        this.sseReconnectTimer = setTimeout(() => {
          this.sseReconnectTimer = null;
          if (this.isRunning) {
            this.connectToStream();
          }
        }, 5000);
      }
    };
  }

  /**
   * Disconnect from SSE stream
   */
  disconnectStream() {
    if (this.sseWatchdog) {
      clearInterval(this.sseWatchdog);
      this.sseWatchdog = null;
    }

    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }

    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
      console.log('[SYNC] SSE stream disconnected');
    }
  }

  /**
   * Start SSE watchdog timer - triggers manual sync if no SSE activity
   */
  startSseWatchdog() {
    if (this.sseWatchdog) {
      clearInterval(this.sseWatchdog);
    }

    const WATCHDOG_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const CHECK_INTERVAL = 60 * 1000; // Check every minute

    this.sseWatchdog = setInterval(() => {
      if (!this.isRunning || !this.lastSseActivity) return;

      const elapsed = Date.now() - this.lastSseActivity;
      if (elapsed > WATCHDOG_TIMEOUT) {
        console.log(`[SYNC] SSE watchdog: no activity for ${Math.round(elapsed / 1000)}s, checking for remote changes`);
        if (this.logger) {
          this.logger.info('SSE', 'Watchdog triggered - no activity', { elapsed });
        }
        this.checkForRemoteChanges();
        this.lastSseActivity = Date.now(); // Reset to avoid repeated triggers
      }
    }, CHECK_INTERVAL);

    console.log('[SYNC] SSE watchdog started (5 min timeout)');
  }

  /**
   * Start polling for remote changes (fallback, runs less frequently with SSE)
   */
  startPolling() {
    // With SSE, poll less frequently as a fallback (every 5 minutes instead of 30 seconds)
    const pollInterval = SYNC_CONFIG.POLL_INTERVAL * 10; // 5 minutes

    this.pollTimer = setInterval(async () => {
      await this.checkForRemoteChanges();
    }, pollInterval);

    console.log(`[SYNC] Fallback polling started (interval: ${pollInterval / 1000}s)`);

    // Log polling start
    if (this.logger) {
      this.logger.info('POLL', 'Fallback polling started', {
        interval: pollInterval
      });
    }
  }

  /**
   * Check for changes on the server
   */
  async checkForRemoteChanges() {
    // Don't poll if sync is not running
    if (!this.isRunning) {
      return;
    }

    if (this.syncQueue.isProcessingQueue()) {
      // Log when poll is skipped due to queue processing
      if (this.logger) {
        this.logger.info('POLL', 'Poll check skipped - queue is processing');
      }
      return;
    }

    try {
      // Log poll check start
      if (this.logger) {
        this.logger.info('POLL', 'Checking for remote changes');
      }

      const serverFiles = await this.fetchAndCacheServerFiles(true);

      // Check if sync was stopped during the fetch
      if (!this.isRunning) {
        return;
      }

      const localFiles = await getLocalFiles(this.syncFolder);
      let changesFound = false;

      for (const serverFile of serverFiles) {
        // Check if sync was stopped during iteration
        if (!this.isRunning) {
          return;
        }
        // Server returns path WITH .html (e.g., "folder1/folder2/site.html" or "site.html")
        const relativePath = serverFile.path || serverFile.filename;
        const localPath = path.join(this.syncFolder, relativePath);
        const localExists = localFiles.has(relativePath);

        if (!localExists) {
          // New file on server
          await this.downloadFile(serverFile.filename, relativePath, serverFile.nodeId);
          this.stats.filesDownloaded++;
          changesFound = true;
          if (serverFile.nodeId) {
            const inode = await nodeMap.getInode(path.join(this.syncFolder, relativePath));
            this.nodeMap.set(String(serverFile.nodeId), { path: relativePath, checksum: serverFile.checksum, inode });
          }
        } else {
          const localInfo = localFiles.get(relativePath);
          const localContent = await readFile(localPath);
          const localChecksum = await calculateChecksum(localContent);

          // Check if content is different
          if (localChecksum !== serverFile.checksum) {
            // Check if local is newer
            if (isLocalNewer(localInfo.mtime, serverFile.modifiedAt, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE ${relativePath} - local is newer`);
              this.stats.filesProtected++;
            } else {
              // Download newer version from server
              await this.downloadFile(serverFile.filename, relativePath, serverFile.nodeId);
              this.stats.filesDownloaded++;
              changesFound = true;
              if (serverFile.nodeId) {
                const inode = await nodeMap.getInode(path.join(this.syncFolder, relativePath));
                this.nodeMap.set(String(serverFile.nodeId), { path: relativePath, checksum: serverFile.checksum, inode });
              }
            }
          }
        }
      }

      await nodeMap.save(this.metaDir, this.nodeMap);

      // Also check for upload changes
      if (!this.isRunning) return;

      const serverUploads = await this.fetchAndCacheServerUploads(true);
      const localUploads = await getLocalUploads(this.syncFolder);

      for (const serverUpload of serverUploads) {
        if (!this.isRunning) return;

        const localPath = path.join(this.syncFolder, serverUpload.path);
        const localExists = localUploads.has(serverUpload.path);

        if (!localExists) {
          await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
          this.stats.uploadsDownloaded++;
          changesFound = true;
          if (serverUpload.nodeId) {
            this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
          }
        } else {
          const localInfo = localUploads.get(serverUpload.path);
          const localContent = await readFileBuffer(localPath);
          const localChecksum = calculateBufferChecksum(localContent);

          if (localChecksum !== serverUpload.checksum) {
            if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer`);
              this.stats.uploadsProtected++;
            } else {
              await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
              this.stats.uploadsDownloaded++;
              changesFound = true;
              if (serverUpload.nodeId) {
                this.nodeMap.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
              }
            }
          }
        }
      }

      await nodeMap.save(this.metaDir, this.nodeMap);

      if (changesFound) {
        this.emit('sync-stats', this.stats);

        // Log poll check completion with changes
        if (this.logger) {
          this.logger.success('POLL', 'Remote changes detected and downloaded', {
            filesDownloaded: this.stats.filesDownloaded,
            uploadsDownloaded: this.stats.uploadsDownloaded
          });
        }
      } else {
        // Log poll check completion with no changes
        if (this.logger) {
          this.logger.info('POLL', 'Poll check completed - no changes');
        }
      }

      this.stats.lastSync = new Date().toISOString();
    } catch (error) {
      console.error('[SYNC] Failed to check for remote changes:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'poll' }));

      // Log polling error
      if (this.logger) {
        this.logger.error('POLL', 'Polling check failed', { error });
      }
    }
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
    this.pendingActions.clear();
    for (const [, { timerId }] of this.pendingUnlinks) {
      clearTimeout(timerId);
    }
    this.pendingUnlinks.clear();
    this.recentSseFileSaves.clear();

    this.recentFolderRenameDescendants.clear();

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

// Export singleton instance
const syncEngine = new SyncEngine();
module.exports = syncEngine;
module.exports.classifyPath = classifyPath;
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
  fetchServerFiles,
  downloadFromServer,
  uploadToServer,
  getServerStatus,
  deleteFileOnServer,
  renameFileOnServer,
  moveFileOnServer,
  // Upload sync
  fetchServerUploads,
  downloadUpload,
  uploadUploadToServer
} = require('./api-client');
const SyncQueue = require('./sync-queue');
const { validateFileName, validateFullPath, validateUploadPath } = require('./validation');
const nodeMap = require('./node-map');

function hasHiddenSegment(filePath) {
  return filePath.split('/').some(segment => segment.startsWith('.'));
}

function toFileId(relPath) {
  return path.normalize(relPath).replace(/\.html$/i, '');
}

class SyncEngine extends EventEmitter {
  constructor() {
    super();
    this.apiKey = null;
    this.apiKeyEncrypted = null;
    this.username = null;
    this.serverUrl = null;
    this.syncFolder = null;
    this.watcher = null;
    this.uploadWatcher = null; // Watcher for uploads
    this.isRunning = false;
    this.clockOffset = 0;
    this.pollTimer = null;
    this.sseConnection = null;
    this.sseReconnectTimer = null;
    this.sseWatchdog = null; // Watchdog timer for SSE heartbeat
    this.lastSseActivity = null; // Last SSE message timestamp
    this.deviceId = null; // Per-device identifier for multi-device sync
    this.syncQueue = new SyncQueue();
    this.nodeMap = new Map(); // nodeId → { path, checksum, inode }
    this.pendingActions = new Set(); // SSE echo suppression: "delete:42", "rename:42", "move:42"
    this.pendingUnlinks = new Map(); // watcher rename/move detection: relativePath → { timerId, nodeId, entry }
    this.lastSyncedAt = null; // Timestamp of last successful sync
    this.serverFilesCache = null; // Cache for server files list
    this.serverFilesCacheTime = null; // When cache was last updated
    this.serverUploadsCache = null; // Cache for server uploads list
    this.serverUploadsCacheTime = null; // When uploads cache was last updated
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

  /**
   * Initialize sync with API key and folder
   */
  async init(apiKey, username, syncFolder, serverUrl, deviceId) {
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
      this.nodeMap = await nodeMap.load(syncFolder);
      const syncState = await nodeMap.loadState(syncFolder);
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

      // Start file watcher for sites
      console.log(`[SYNC] Starting file watcher...`);
      this.startFileWatcher();

      // Start upload watcher
      console.log(`[SYNC] Starting upload watcher...`);
      this.startUploadWatcher();

      // Connect to SSE stream for real-time sync (handles both live-sync and disk sync)
      console.log(`[SYNC] Connecting to SSE stream...`);
      this.connectToStream();

      // No polling - SSE handles real-time sync for both live-sync and disk writes

      // Periodic cleanup of stale pendingActions (30s TTL)
      this.pendingActionsCleanupTimer = setInterval(() => {
        this.pendingActions.clear();
      }, 30000);

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
    this.serverFilesCache = await fetchServerFiles(this.serverUrl, this.apiKey);
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
    this.serverUploadsCache = await fetchServerUploads(this.serverUrl, this.apiKey);
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

  /**
   * Perform initial sync - download files from server but preserve newer local files
   */
  async performInitialSync() {
    console.log('[SYNC] Starting initial sync...');
    this.emit('sync-start', { type: 'initial' });

    try {
      const serverFiles = await this.fetchAndCacheServerFiles(true);
      const localFiles = await getLocalFiles(this.syncFolder);

      this.detectDuplicateFilenames(localFiles);

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
              const siteName = localRelPath.split('/').pop().replace(/\.html$/i, '');
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

      await nodeMap.save(this.syncFolder, this.nodeMap);

      // Detect local structural changes (delete/move/rename) that happened while offline
      if (this.lastSyncedAt) {
        await this.detectLocalChanges(serverFiles, localFiles);
        await nodeMap.save(this.syncFolder, this.nodeMap);
      }

      await this.uploadLocalOnlyFiles(localFiles, serverFiles);

      this.lastSyncedAt = Date.now();
      await nodeMap.saveState(this.syncFolder, { lastSyncedAt: this.lastSyncedAt });
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
   * Detect and warn about duplicate filenames across different local folders.
   * Site names are globally unique on the server, so local duplicates cause issues.
   */
  detectDuplicateFilenames(localFiles) {
    const nameIndex = new Map();
    for (const [relativePath] of localFiles) {
      const name = relativePath.split('/').pop();
      if (!nameIndex.has(name)) {
        nameIndex.set(name, []);
      }
      nameIndex.get(name).push(relativePath);
    }

    for (const [name, paths] of nameIndex) {
      if (paths.length > 1) {
        console.log(`[SYNC] WARNING: Duplicate filename "${name}" found in ${paths.length} locations: ${paths.join(', ')}`);
        this.emit('sync-warning', {
          type: 'duplicate-filename',
          filename: name,
          paths,
          message: `"${name}" exists in ${paths.length} folders — only one can sync`
        });

        if (this.logger) {
          this.logger.warn('SYNC', `Duplicate filename detected: ${name}`, { paths });
        }
      }
    }
  }

  /**
   * Reconcile a single server file against local state: move, download, or skip.
   * Mutates localFiles map when a file is moved.
   */
  async reconcileServerFile(serverFile, localFiles) {
    const relativePath = serverFile.path || `${serverFile.filename}.html`;
    const localPath = path.join(this.syncFolder, relativePath);
    let localExists = localFiles.has(relativePath);

    if (!localExists && serverFile.nodeId) {
      const knownEntry = this.nodeMap.get(String(serverFile.nodeId));
      const knownPath = knownEntry?.path;
      if (knownPath && knownPath !== relativePath && localFiles.has(knownPath)) {
        const oldFullPath = path.join(this.syncFolder, knownPath);
        const siteName = relativePath.split('/').pop().replace(/\.html$/i, '');
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
        await this.downloadFile(serverFile.filename, relativePath);
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

      await this.downloadFile(serverFile.filename, relativePath);
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
        (f.path === relativePath) || (`${f.filename}.html` === relativePath)
      );

      if (!serverFile) {
        const localName = relativePath.split('/').pop();
        const nameExistsOnServer = serverFiles.some(f => {
          const serverName = (f.path || `${f.filename}.html`).split('/').pop();
          return serverName === localName;
        });

        if (nameExistsOnServer) {
          console.log(`[SYNC] SKIP ${relativePath} - duplicate name already exists on server`);
          if (this.logger) {
            this.logger.warn('SYNC', 'Skipped upload - duplicate name on server', { file: relativePath });
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
      const serverPath = serverFile.path || `${serverFile.filename}.html`;

      // Only run local change detection for nodeIds where the server hasn't changed the path
      // (server wins for move/rename conflicts)
      if (serverPath !== entry.path) continue;

      if (localFiles.has(entry.path)) continue; // file still at expected path

      // File is GONE from expected path but still exists on server — find where it went

      const expectedBasename = path.basename(entry.path);

      // 1. Same basename at different path → MOVE
      let handled = false;
      for (const localFile of localOnlySet) {
        if (path.basename(localFile) === expectedBasename) {
          const targetFolder = path.dirname(localFile);
          const folderPath = targetFolder === '.' ? '' : targetFolder.replace(/\.html$/, '');
          try {
            console.log(`[SYNC] Local move detected: ${entry.path} → ${localFile} (nodeId ${nid})`);
            this.pendingActions.add(`move:${nid}`);
            await moveFileOnServer(this.serverUrl, this.apiKey, parseInt(nid), folderPath);
            const inode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            const cs = content ? await calculateChecksum(content) : entry.checksum;
            this.nodeMap.set(nid, { path: localFile, checksum: cs, inode });
            localOnlySet.delete(localFile);
            handled = true;
          } catch (err) {
            console.error(`[SYNC] Failed to sync local move for nodeId ${nid}:`, err.message);
          }
          break;
        }
      }
      if (handled) continue;

      // 2. Check inode match → RENAME
      for (const localFile of localOnlySet) {
        const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
        if (localInode && entry.inode && localInode === entry.inode) {
          const newName = path.basename(localFile).replace(/\.html$/, '');
          try {
            console.log(`[SYNC] Local rename detected (inode match): ${entry.path} → ${localFile} (nodeId ${nid})`);
            this.pendingActions.add(`rename:${nid}`);
            await renameFileOnServer(this.serverUrl, this.apiKey, parseInt(nid), newName);
            this.nodeMap.set(nid, { path: localFile, checksum: entry.checksum, inode: localInode });
            localOnlySet.delete(localFile);
            handled = true;
          } catch (err) {
            console.error(`[SYNC] Failed to sync local rename for nodeId ${nid}:`, err.message);
          }
          break;
        }
      }
      if (handled) continue;

      // 3. Check checksum match → RENAME (editor rewrote file, changing inode)
      for (const localFile of localOnlySet) {
        if (entry.checksum) {
          const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
          if (content) {
            const cs = await calculateChecksum(content);
            if (cs === entry.checksum) {
              const newName = path.basename(localFile).replace(/\.html$/, '');
              try {
                console.log(`[SYNC] Local rename detected (checksum match): ${entry.path} → ${localFile} (nodeId ${nid})`);
                this.pendingActions.add(`rename:${nid}`);
                await renameFileOnServer(this.serverUrl, this.apiKey, parseInt(nid), newName);
                const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
                this.nodeMap.set(nid, { path: localFile, checksum: cs, inode: localInode });
                localOnlySet.delete(localFile);
                handled = true;
              } catch (err) {
                console.error(`[SYNC] Failed to sync local rename for nodeId ${nid}:`, err.message);
              }
              break;
            }
          }
        }
      }
      if (handled) continue;

      // 4. No match → LOCAL DELETE
      // Check for delete conflict: if server modified the file after our last sync, re-download instead
      if (serverFile.modifiedAt && new Date(serverFile.modifiedAt).getTime() > this.lastSyncedAt) {
        console.log(`[SYNC] Delete conflict: ${entry.path} deleted locally but modified on server — re-downloading`);
        try {
          await this.downloadFile(serverFile.filename, serverPath);
        } catch (err) {
          console.error(`[SYNC] Failed to re-download ${serverPath} after delete conflict:`, err.message);
        }
        continue;
      }

      try {
        console.log(`[SYNC] Local delete detected: ${entry.path} (nodeId ${nid})`);
        this.pendingActions.add(`delete:${nid}`);
        await deleteFileOnServer(this.serverUrl, this.apiKey, parseInt(nid));
        this.nodeMap.delete(nid);
      } catch (err) {
        console.error(`[SYNC] Failed to sync local delete for nodeId ${nid}:`, err.message);
      }
    }
  }

  /**
   * Download a file from server
   * @param {string} filename - Filename WITHOUT .html (may include folders)
   * @param {string} relativePath - Full path WITH .html for local storage
   */
  async downloadFile(filename, relativePath) {
    try {
      // Server expects filename WITHOUT .html
      const { content, modifiedAt } = await downloadFromServer(
        this.serverUrl,
        this.apiKey,
        filename
      );

      // Use provided relativePath or construct it
      const localFilename = relativePath || (filename.endsWith('.html') ? filename : `${filename}.html`);
      const localPath = path.join(this.syncFolder, localFilename);

      // Create backup if file exists locally
      // Remove .html extension for siteName (matches server.js behavior)
      const siteName = localFilename.replace(/\.html$/i, '');
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
    const localFilename = file.endsWith('.html') ? file : `${file}.html`;
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
      const siteName = localFilename.replace(/\.html$/i, '');
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
        await nodeMap.save(this.syncFolder, this.nodeMap);
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
    const newLocalFilename = currentPath.replace(
      new RegExp(`${oldName}\\.html$`),
      `${newName}.html`
    );
    const newLocalPath = path.join(this.syncFolder, newLocalFilename);

    liveSync.markBrowserSave(toFileId(currentPath));
    liveSync.markBrowserSave(toFileId(newLocalFilename));
    await ensureDirectory(path.dirname(newLocalPath));
    await moveFile(localPath, newLocalPath);

    const inode = await nodeMap.getInode(newLocalPath);
    this.nodeMap.set(String(nodeId), { path: newLocalFilename, checksum: entry.checksum, inode });
    await nodeMap.save(this.syncFolder, this.nodeMap);

    console.log(`[SYNC] SSE file-renamed: ${currentPath} → ${newLocalFilename}`);
  }

  async handleFileMoved(nodeId, file, fromPath, toPath) {
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
      await nodeMap.save(this.syncFolder, this.nodeMap);
      return;
    }

    liveSync.markBrowserSave(toFileId(currentPath));
    liveSync.markBrowserSave(toFileId(toPath));
    await ensureDirectory(path.dirname(newLocalPath));
    await moveFile(localPath, newLocalPath);

    const movedInode = await nodeMap.getInode(newLocalPath);
    this.nodeMap.set(String(nodeId), { path: toPath, checksum: entry?.checksum || null, inode: movedInode });
    await nodeMap.save(this.syncFolder, this.nodeMap);

    console.log(`[SYNC] SSE file-moved: ${currentPath} → ${toPath}`);
  }

  async handleFileDeleted(nodeId, file) {
    const entry = this.nodeMap.get(String(nodeId));
    const localFilename = entry?.path
      || (file.endsWith('.html') ? file : `${file}.html`);
    const localPath = path.join(this.syncFolder, localFilename);
    const trashPath = path.join(this.syncFolder, '.trash', localFilename);

    try {
      const exists = await fileExists(localPath);
      if (!exists) {
        console.log(`[SYNC] SSE file-deleted: ${localFilename} not found locally`);
        this.nodeMap.delete(String(nodeId));
        await nodeMap.save(this.syncFolder, this.nodeMap);
        return;
      }

      await ensureDirectory(path.dirname(trashPath));
      liveSync.markBrowserSave(toFileId(localFilename));
      await moveFile(localPath, trashPath);

      this.nodeMap.delete(String(nodeId));
      await nodeMap.save(this.syncFolder, this.nodeMap);

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
        const filenameWithoutHtml = filename.replace(/\.html$/i, '');
        const serverFile = serverFiles.find(f => f.filename === filenameWithoutHtml);

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

      // Upload to server (filename WITHOUT .html)
      const filenameWithoutHtml = filename.replace(/\.html$/i, '');

      // Try to get cached snapshot for platform live sync
      let snapshotHtml = null;
      try {
        const { getAndClearSnapshot } = require('../main/server.js');
        snapshotHtml = getAndClearSnapshot(filenameWithoutHtml);
        if (snapshotHtml) {
          console.log(`[SYNC] Including snapshot for platform live sync: ${filenameWithoutHtml}`);
        }
      } catch (err) {
        // Server module not available or getAndClearSnapshot not exported
        // This is fine - just upload without snapshot
      }

      const result = await uploadToServer(
        this.serverUrl,
        this.apiKey,
        filenameWithoutHtml,
        content,
        stat.mtime,
        {
          snapshotHtml,
          senderId: this.deviceId
        }
      );

      if (result.nodeId) {
        const localChecksum = await calculateChecksum(content);
        const inode = await nodeMap.getInode(path.join(this.syncFolder, filename));
        this.nodeMap.set(String(result.nodeId), { path: filename, checksum: localChecksum, inode });
        await nodeMap.save(this.syncFolder, this.nodeMap);
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

  /**
   * Queue a file for sync
   */
  queueSync(type, filename) {
    // Don't queue if sync is not running
    if (!this.isRunning) return;

    // Silently skip hidden files/folders (e.g. .git, .DS_Store)
    if (hasHiddenSegment(filename)) return;

    // Validate filename before queueing (for add/change operations)
    if (type === 'add' || type === 'change') {
      const validationResult = filename.includes('/')
        ? validateFullPath(filename)
        : validateFileName(filename, false);

      if (!validationResult.valid) {
        console.error(`[SYNC] Cannot queue ${filename}: ${validationResult.error}`);

        // Log validation error
        if (this.logger) {
          this.logger.error('VALIDATION', 'Cannot queue file - validation failed', {
            file: filename,
            reason: validationResult.error
          });
        }

        // Emit validation error immediately
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

    // Add to queue
    if (!this.syncQueue.add(type, filename)) {
      return; // Already in queue or invalid file
    }

    // Process queue after a short delay (debounce)
    this.syncQueue.setQueueTimer(() => {
      if (this.isRunning) {
        this.processQueue();
      }
    });
  }

  /**
   * Process sync queue with retry logic
   */
  async processQueue() {
    // Don't process if stopped or already processing
    if (!this.isRunning || this.syncQueue.isProcessingQueue() || this.syncQueue.isEmpty()) {
      return;
    }

    this.syncQueue.setProcessing(true);

    while (!this.syncQueue.isEmpty()) {
      const item = this.syncQueue.next();

      try {
        if (item.type === 'add' || item.type === 'change') {
          // Check if this is an upload (prefixed with 'upload:')
          if (item.filename.startsWith('upload:')) {
            const uploadPath = item.filename.replace('upload:', '');
            await this.uploadUploadFile(uploadPath);
          } else {
            // Regular site file
            await this.uploadFile(item.filename);
          }
        }

        // Success - clear retry tracking
        this.syncQueue.clearRetry(item.filename);

        // Log successful queue item processing
        if (this.logger) {
          this.logger.success('QUEUE', 'Queue item processed', {
            file: item.filename,
            type: item.type
          });
        }

      } catch (error) {
        // Log queue processing error
        if (this.logger) {
          this.logger.error('QUEUE', 'Queue processing failed', {
            file: item.filename,
            type: item.type,
            error
          });
        }

        // Handle retry
        const retryResult = this.syncQueue.scheduleRetry(
          item,
          error,
          (retryItem) => {
            // Only retry if sync is still running and file exists
            if (this.isRunning) {
              // Handle upload vs site paths
              let filePath;
              if (retryItem.filename.startsWith('upload:')) {
                const uploadPath = retryItem.filename.replace('upload:', '');
                filePath = path.join(this.syncFolder, uploadPath);
              } else {
                filePath = path.join(this.syncFolder, retryItem.filename);
              }

              if (fileExists(filePath)) {
                // Re-queue with appropriate method
                if (retryItem.filename.startsWith('upload:')) {
                  this.queueUploadSync(retryItem.type, retryItem.filename.replace('upload:', ''));
                } else {
                  this.queueSync(retryItem.type, retryItem.filename);
                }
              } else {
                this.syncQueue.clearRetry(retryItem.filename);
              }
            }
          }
        );

        if (!retryResult.shouldRetry) {
          // Permanent failure
          console.error(`[SYNC] Permanent failure for ${item.filename}: ${retryResult.reason}`);

          this.emit('sync-failed', {
            file: item.filename,
            error: error.message,
            priority: ERROR_PRIORITY.CRITICAL,
            finalFailure: true,
            attempts: retryResult.attempts
          });
        } else {
          // Log retry scheduling
          if (this.logger) {
            this.logger.warn('QUEUE', 'Retry scheduled', {
              file: item.filename,
              attempt: retryResult.attempt,
              maxAttempts: retryResult.maxAttempts,
              nextRetryIn: retryResult.nextRetryIn
            });
          }

          // Scheduled for retry
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

    // Emit stats update to UI
    this.emit('sync-stats', this.stats);

    this.syncQueue.setProcessing(false);
  }

  /**
   * Start watching local files
   */
  startFileWatcher() {
    // Watch recursively for all HTML files (excluding uploads folder)
    this.watcher = chokidar.watch('**/*.html', {
      cwd: this.syncFolder,
      persistent: true,
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/sites-versions/**',
        '**/tailwindcss/**',
        '**/.*',
        '**/.*/**',
        '**/.sync-meta/**',
        '**/.trash/**'
      ],
      awaitWriteFinish: SYNC_CONFIG.FILE_STABILIZATION
    });

    const UNLINK_GRACE_PERIOD = 500;

    this.watcher
      .on('add', filename => {
        const normalizedPath = path.normalize(filename);

        // Check if this correlates with a pending unlink (move/rename detection)
        // Verify via inode to avoid false positives (delete + unrelated new file within grace window)
        let correlated = false;
        const addBasename = path.basename(normalizedPath);
        const addDirname = path.dirname(normalizedPath);

        for (const [oldPath, pending] of this.pendingUnlinks) {
          const oldBasename = path.basename(oldPath);
          const oldDirname = path.dirname(oldPath);

          const isMove = oldBasename === addBasename && oldDirname !== addDirname;
          const isRename = oldBasename !== addBasename && oldDirname === addDirname;
          const isMoveRename = oldBasename !== addBasename && oldDirname !== addDirname;

          if (isMove || isRename || isMoveRename) {
            clearTimeout(pending.timerId);
            this.pendingUnlinks.delete(oldPath);
            correlated = true;

            const self = this;
            (async () => {
              // Verify file identity before committing to the correlation.
              // Prevents false positives when a delete + unrelated new file arrive within the grace window.
              // Uses inode when available (Linux/macOS), falls back to checksum (Windows/FAT32).
              const newFullPath = path.join(self.syncFolder, normalizedPath);
              const newInode = await nodeMap.getInode(newFullPath);
              let isSameFile = false;
              if (pending.entry.inode && newInode) {
                isSameFile = pending.entry.inode === newInode;
              } else if (pending.entry.checksum) {
                const content = await readFile(newFullPath).catch(() => null);
                if (content) {
                  const newChecksum = await calculateChecksum(content);
                  isSameFile = newChecksum === pending.entry.checksum;
                }
              } else {
                // No inode and no checksum to compare — accept the heuristic
                isSameFile = true;
              }

              if (!isSameFile) {
                console.log(`[SYNC] Watcher: Identity mismatch for ${oldPath} → ${normalizedPath}, treating as delete+add`);
                try {
                  self.pendingActions.add(`delete:${pending.nodeId}`);
                  await deleteFileOnServer(self.serverUrl, self.apiKey, parseInt(pending.nodeId));
                  self.nodeMap.delete(pending.nodeId);
                  await nodeMap.save(self.syncFolder, self.nodeMap);
                } catch (err) {
                  console.error(`[SYNC] Watcher: Failed to sync delete for ${oldPath}:`, err.message);
                }
                self.queueSync('add', normalizedPath);
                return;
              }

              try {
                if (isMove) {
                  const targetFolder = addDirname === '.' ? '' : addDirname;
                  console.log(`[SYNC] Watcher: Local move detected: ${oldPath} → ${normalizedPath}`);
                  self.pendingActions.add(`move:${pending.nodeId}`);
                  await moveFileOnServer(self.serverUrl, self.apiKey, parseInt(pending.nodeId), targetFolder);
                } else if (isRename) {
                  const newName = addBasename.replace(/\.html$/, '');
                  console.log(`[SYNC] Watcher: Local rename detected: ${oldPath} → ${normalizedPath}`);
                  self.pendingActions.add(`rename:${pending.nodeId}`);
                  await renameFileOnServer(self.serverUrl, self.apiKey, parseInt(pending.nodeId), newName);
                } else {
                  const newName = addBasename.replace(/\.html$/, '');
                  const targetFolder = addDirname === '.' ? '' : addDirname;
                  console.log(`[SYNC] Watcher: Local move+rename detected: ${oldPath} → ${normalizedPath}`);
                  self.pendingActions.add(`rename:${pending.nodeId}`);
                  await renameFileOnServer(self.serverUrl, self.apiKey, parseInt(pending.nodeId), newName);
                  self.pendingActions.add(`move:${pending.nodeId}`);
                  await moveFileOnServer(self.serverUrl, self.apiKey, parseInt(pending.nodeId), targetFolder);
                }

                self.nodeMap.set(pending.nodeId, { path: normalizedPath, checksum: pending.entry.checksum, inode: newInode });
                await nodeMap.save(self.syncFolder, self.nodeMap);
              } catch (err) {
                console.error(`[SYNC] Watcher: Failed to sync ${isMove ? 'move' : isRename ? 'rename' : 'move+rename'} for ${oldPath}:`, err.message);
              }
            })();
            break;
          }
        }

        if (!correlated) {
          console.log(`[SYNC] File added: ${normalizedPath}`);
          this.queueSync('add', normalizedPath);

          const fileId = normalizedPath.replace(/\.html$/, '');
          if (!liveSync.wasBrowserSave(fileId)) {
            liveSync.notify(fileId, {
              msgType: 'info',
              msg: 'New file created',
              action: 'reload'
            });
          }
        }
      })
      .on('change', filename => {
        const normalizedPath = path.normalize(filename);
        console.log(`[SYNC] File changed: ${normalizedPath}`);
        this.queueSync('change', normalizedPath);

        const fileId = normalizedPath.replace(/\.html$/, '');
        if (!liveSync.wasBrowserSave(fileId)) {
          liveSync.notify(fileId, {
            msgType: 'warning',
            msg: 'File changed on disk',
            action: 'reload',
            persistent: true
          });
        }
      })
      .on('unlink', filename => {
        const normalizedPath = path.normalize(filename);

        // Build reverse map to find nodeId
        let foundNodeId = null;
        let foundEntry = null;
        for (const [nid, entry] of this.nodeMap) {
          if (entry.path === normalizedPath) {
            foundNodeId = nid;
            foundEntry = entry;
            break;
          }
        }

        if (!foundNodeId) {
          console.log(`[SYNC] File deleted locally (not tracked): ${normalizedPath}`);
          return;
        }

        // Wait for a matching add event before deciding this is a delete
        const timerId = setTimeout(async () => {
          this.pendingUnlinks.delete(normalizedPath);
          console.log(`[SYNC] Watcher: Local delete detected: ${normalizedPath} (nodeId ${foundNodeId})`);
          try {
            this.pendingActions.add(`delete:${foundNodeId}`);
            await deleteFileOnServer(this.serverUrl, this.apiKey, parseInt(foundNodeId));
            this.nodeMap.delete(foundNodeId);
            await nodeMap.save(this.syncFolder, this.nodeMap);
          } catch (err) {
            console.error(`[SYNC] Watcher: Failed to sync delete for ${normalizedPath}:`, err.message);
          }
        }, UNLINK_GRACE_PERIOD);

        this.pendingUnlinks.set(normalizedPath, { timerId, nodeId: foundNodeId, entry: foundEntry });
      })
      .on('error', error => {
        console.error('[SYNC] Watcher error:', error);
        this.stats.errors.push(formatErrorForLog(error, { action: 'watcher' }));

        // Log watcher error
        if (this.logger) {
          this.logger.error('WATCHER', 'File watcher error', { error });
        }
      });

    console.log('[SYNC] File watcher started (watching recursively)');

    // Log watcher start
    if (this.logger) {
      this.logger.info('WATCHER', 'File watcher started', {
        syncFolder: this.logger.sanitizePath(this.syncFolder)
      });
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
            await this.downloadUploadFile(serverUpload.path);
            this.stats.uploadsDownloaded++;
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
              continue;
            }

            // Check if local is newer
            if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer`);
              this.stats.uploadsProtected++;
              continue;
            }

            // Check checksums
            const localContent = await readFileBuffer(localPath);
            const localChecksum = calculateBufferChecksum(localContent);

            if (localChecksum === serverUpload.checksum) {
              console.log(`[SYNC] SKIP upload ${serverUpload.path} - checksums match`);
              this.stats.uploadsSkipped++;
              continue;
            }

            // Server is newer, download it
            await this.downloadUploadFile(serverUpload.path);
            this.stats.uploadsDownloaded++;
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
  async downloadUploadFile(serverPath) {
    try {
      const { content, modifiedAt } = await downloadUpload(
        this.serverUrl,
        this.apiKey,
        serverPath
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

      // Upload to server
      await uploadUploadToServer(
        this.serverUrl,
        this.apiKey,
        relativePath,
        content,
        stat.mtime
      );

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

  /**
   * Start watching upload files
   */
  startUploadWatcher() {
    this.uploadWatcher = chokidar.watch('**/*', {
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
        '**/*.html',
        '**/.sync-meta/**',
        '**/.trash/**'
      ],
      awaitWriteFinish: SYNC_CONFIG.FILE_STABILIZATION
    });

    this.uploadWatcher
      .on('add', filename => {
        const normalizedPath = path.normalize(filename);
        console.log(`[SYNC] Upload added: ${normalizedPath}`);
        this.queueUploadSync('add', normalizedPath);
      })
      .on('change', filename => {
        const normalizedPath = path.normalize(filename);
        console.log(`[SYNC] Upload changed: ${normalizedPath}`);
        this.queueUploadSync('change', normalizedPath);
      })
      .on('unlink', filename => {
        console.log(`[SYNC] Upload deleted locally (not syncing): ${filename}`);
      })
      .on('error', error => {
        console.error('[SYNC] Upload watcher error:', error);
        this.stats.errors.push(formatErrorForLog(error, { action: 'upload-watcher' }));
      });

    console.log('[SYNC] Upload watcher started');

    if (this.logger) {
      this.logger.info('WATCHER', 'Upload watcher started', {
        syncFolder: this.logger.sanitizePath(this.syncFolder)
      });
    }
  }

  /**
   * Queue an upload file for sync
   */
  queueUploadSync(type, filename) {
    if (!this.isRunning) return;

    // Silently skip hidden files/folders (e.g. .git, .DS_Store)
    if (hasHiddenSegment(filename)) return;

    // Validate before queueing
    const validationResult = validateUploadPath(filename);
    if (!validationResult.valid) {
      console.error(`[SYNC] Cannot queue upload ${filename}: ${validationResult.error}`);
      this.emit('sync-error', {
        file: filename,
        error: validationResult.error,
        type: 'validation',
        priority: ERROR_PRIORITY.HIGH,
        canRetry: false
      });
      return;
    }

    // Add to queue with 'upload:' prefix to distinguish from sites
    const queueKey = `upload:${filename}`;
    if (!this.syncQueue.add(type, queueKey)) {
      return;
    }

    this.syncQueue.setQueueTimer(() => {
      if (this.isRunning) {
        this.processQueue();
      }
    });
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

    this.sseConnection.onmessage = async (event) => {
      if (!this.isRunning) return;

      // Track activity for watchdog (includes ping comments)
      this.lastSseActivity = Date.now();

      try {
        const data = JSON.parse(event.data);

        // Handle message type - default to live-sync for backward compatibility
        const type = data.type || 'live-sync';

        if (type === 'live-sync') {
          // Live-sync: relay snapshot HTML to local browsers (no disk write)
          const { file, html, sender } = data;

          // Skip our own changes (avoid echo from what we just uploaded)
          if (sender === this.deviceId) {
            console.log(`[SYNC] SSE: Ignoring own live-sync for ${file}`);
            return;
          }

          console.log(`[SYNC] SSE: Received live-sync for ${file} from ${sender}`);

          // Relay to local live-sync for browser-to-browser sync
          liveSync.broadcast(file, { html, sender });

          if (this.logger) {
            this.logger.success('SSE', 'Relayed live-sync to local browsers', { file });
          }

        } else if (type === 'file-saved') {
          const { file, content, checksum, modifiedAt, nodeId } = data;

          console.log(`[SYNC] SSE: Received file-saved for ${file}`);

          await this.handleFileSaved(file, content, checksum, modifiedAt, nodeId);

          if (this.logger) {
            this.logger.success('SSE', 'Handled file-saved', { file });
          }

        } else if (type === 'file-renamed') {
          const { nodeId, oldName, newName } = data;
          const renameKey = `rename:${nodeId}`;
          if (this.pendingActions.has(renameKey)) {
            this.pendingActions.delete(renameKey);
            console.log(`[SYNC] SSE: Skipping self-initiated rename for nodeId ${nodeId}`);
          } else {
            console.log(`[SYNC] SSE: Received file-renamed: ${oldName} → ${newName}`);
            await this.handleFileRenamed(nodeId, oldName, newName);
          }

        } else if (type === 'file-moved') {
          const { nodeId, file, fromPath, toPath } = data;
          const moveKey = `move:${nodeId}`;
          if (this.pendingActions.has(moveKey)) {
            this.pendingActions.delete(moveKey);
            console.log(`[SYNC] SSE: Skipping self-initiated move for nodeId ${nodeId}`);
          } else {
            console.log(`[SYNC] SSE: Received file-moved: ${fromPath} → ${toPath}`);
            await this.handleFileMoved(nodeId, file, fromPath, toPath);
          }

        } else if (type === 'file-deleted') {
          const { nodeId, file } = data;
          const deleteKey = `delete:${nodeId}`;
          if (this.pendingActions.has(deleteKey)) {
            this.pendingActions.delete(deleteKey);
            console.log(`[SYNC] SSE: Skipping self-initiated delete for nodeId ${nodeId}`);
          } else {
            console.log(`[SYNC] SSE: Received file-deleted: ${file}`);
            await this.handleFileDeleted(nodeId, file);
          }
        }
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
        const relativePath = serverFile.path || `${serverFile.filename}.html`;
        const localPath = path.join(this.syncFolder, relativePath);
        const localExists = localFiles.has(relativePath);

        if (!localExists) {
          // New file on server
          await this.downloadFile(serverFile.filename, relativePath);
          this.stats.filesDownloaded++;
          changesFound = true;
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
              await this.downloadFile(serverFile.filename, relativePath);
              this.stats.filesDownloaded++;
              changesFound = true;
            }
          }
        }
      }

      // Also check for upload changes
      if (!this.isRunning) return;

      const serverUploads = await this.fetchAndCacheServerUploads(true);
      const localUploads = await getLocalUploads(this.syncFolder);

      for (const serverUpload of serverUploads) {
        if (!this.isRunning) return;

        const localPath = path.join(this.syncFolder, serverUpload.path);
        const localExists = localUploads.has(serverUpload.path);

        if (!localExists) {
          await this.downloadUploadFile(serverUpload.path);
          this.stats.uploadsDownloaded++;
          changesFound = true;
        } else {
          const localInfo = localUploads.get(serverUpload.path);
          const localContent = await readFileBuffer(localPath);
          const localChecksum = calculateBufferChecksum(localContent);

          if (localChecksum !== serverUpload.checksum) {
            if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer`);
              this.stats.uploadsProtected++;
            } else {
              await this.downloadUploadFile(serverUpload.path);
              this.stats.uploadsDownloaded++;
              changesFound = true;
            }
          }
        }
      }

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

    // Stop file watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log('[SYNC] File watcher closed');
    }

    // Stop upload watcher
    if (this.uploadWatcher) {
      await this.uploadWatcher.close();
      this.uploadWatcher = null;
      console.log('[SYNC] Upload watcher closed');
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
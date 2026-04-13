/**
 * SSE transport + remote event handlers + fallback polling.
 *
 * The server tells us about remote state changes via SSE; this module owns
 * the connection, the dispatch into per-op handlers, and the watchdog that
 * falls back to polling if the stream goes quiet. Methods are installed onto
 * SyncEngine.prototype.
 */

const path = require('upath');
const { EventSource } = require('eventsource');
const { liveSync } = require('livesync-hyperclay');
const { createBackupIfExists, createBinaryBackupIfExists } = require('../main/utils/backup');
const { classifyError, formatErrorForLog } = require('./error-handler');
const {
  getLocalFiles,
  readFile,
  writeFile,
  fileExists,
  ensureDirectory,
  moveFile,
  getLocalUploads,
  readFileBuffer,
  writeFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
const { getNodeContent } = require('./api-client');
const { calculateChecksum, isLocalNewer } = require('./utils');
const { SYNC_CONFIG } = require('./constants');
const { toFileId } = require('./path-helpers');
const nodeMap = require('./node-map');

module.exports = {
  async _applyRemoteFsChange(paths, fn) {
    this.cascade.mark(paths);
    return fn();
  },

  _skipIfEcho(actionType, nodeId) {
    if (this.outbox.consumeIfInFlight(actionType, nodeId)) {
      console.log(`[SYNC] SSE: Skipping self-initiated ${actionType} for nodeId ${nodeId}`);
      return true;
    }
    return false;
  },

  async handleNodeSaved(data) {
    if (this._skipIfEcho('save', data.nodeId)) return;

    this.echoWindow.mark(data.nodeType, data.nodeId);

    console.log(`[SYNC] SSE: node-saved (${data.nodeType}) for ${data.path} (nodeId ${data.nodeId})`);

    try {
      if (data.nodeType === 'site') {
        await this._applyNodeSavedSite(data);
      } else if (data.nodeType === 'upload') {
        await this._applyNodeSavedUpload(data);
      } else if (data.nodeType === 'folder') {
        await this._applyNodeSavedFolder(data);
      } else {
        console.warn(`[SYNC] SSE: Unknown nodeType in node-saved: ${data.nodeType}`);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-saved for ${data.path}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-saved', { path: data.path, error });
      }
      const errorInfo = classifyError(error, { filename: data.path, action: 'sse-node-saved' });
      this.stats.errors.push(formatErrorForLog(error, { filename: data.path, action: 'sse-node-saved' }));
      this.emit('sync-error', errorInfo);
    }
  },

  async _applyNodeSavedSite(data) {
    const localFilename = data.path;
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);

    if (typeof data.content !== 'string') {
      throw new Error(`node-saved for site ${data.nodeId} missing inline content`);
    }

    try {
      const localContent = await readFile(localPath);
      const localChecksum = await calculateChecksum(localContent);
      if (localChecksum === data.checksum) {
        console.log(`[SYNC] SSE node-saved: ${data.path} already up to date`);
        const inode = await nodeMap.getInode(localPath);
        await this.repo.set(data.nodeId, {
          type: 'site',
          path: localFilename,
          checksum: localChecksum,
          inode
        });
        return;
      }
    } catch (e) {
      // File doesn't exist locally yet — fall through to write
    }

    const siteName = localFilename.replace(/\.(html|htmlclay)$/i, '');
    await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this), this.logger);

    await ensureDirectory(path.dirname(localPath));

    const fileId = localFilename.replace(/\.(html|htmlclay)$/, '');
    liveSync.markBrowserSave(fileId);

    await writeFile(localPath, data.content, new Date(data.modifiedAt));

    const inode = await nodeMap.getInode(localPath);
    const cs = await calculateChecksum(data.content);
    await this.repo.set(data.nodeId, {
      type: 'site',
      path: localFilename,
      checksum: cs,
      inode
    });

    console.log(`[SYNC] SSE node-saved: Wrote site ${localFilename}`);
    this.stats.filesDownloaded++;

    this.emit('file-synced', {
      file: localFilename,
      action: 'download',
      source: 'sse',
      type: 'site'
    });
  },

  async _applyNodeSavedUpload(data) {
    const localFilename = data.path;
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);

    try {
      const localContent = await readFileBuffer(localPath);
      const localChecksum = calculateBufferChecksum(localContent);
      if (localChecksum === data.checksum) {
        console.log(`[SYNC] SSE node-saved: upload ${data.path} already up to date`);
        const inode = await nodeMap.getInode(localPath);
        await this.repo.set(data.nodeId, {
          type: 'upload',
          path: localFilename,
          checksum: localChecksum,
          inode
        });
        return;
      }
    } catch (e) {
      // File doesn't exist locally — fall through to fetch
    }

    console.log(`[SYNC] SSE node-saved: fetching upload content for nodeId ${data.nodeId}`);
    const fetched = await getNodeContent(this.serverUrl, this.apiKey, data.nodeId);

    await createBinaryBackupIfExists(localPath, localFilename, this.syncFolder, this.emit.bind(this), this.logger);

    await writeFileBuffer(localPath, fetched.content, fetched.modifiedAt);

    const inode = await nodeMap.getInode(localPath);
    await this.repo.set(data.nodeId, {
      type: 'upload',
      path: localFilename,
      checksum: fetched.checksum,
      inode
    });

    console.log(`[SYNC] SSE node-saved: Wrote upload ${localFilename}`);
    this.stats.uploadsDownloaded++;

    this.emit('file-synced', {
      file: localFilename,
      action: 'download',
      source: 'sse',
      type: 'upload'
    });
  },

  async _applyNodeSavedFolder(data) {
    if (this.repo.has(data.nodeId)) {
      console.log(`[SYNC] SSE node-saved: folder ${data.path} already tracked, no-op`);
      return;
    }

    const localFolderPath = data.path;
    this.resolveContainedPath(localFolderPath);
    const localPath = path.join(this.syncFolder, localFolderPath);

    await this._applyRemoteFsChange([localFolderPath], () => ensureDirectory(localPath));

    const inode = await nodeMap.getInode(localPath);
    await this.repo.set(data.nodeId, {
      type: 'folder',
      path: localFolderPath,
      parentId: data.parentId,
      inode
    });

    console.log(`[SYNC] SSE node-saved: Created folder ${localFolderPath}`);
    this.emit('file-synced', {
      file: localFolderPath,
      action: 'create',
      source: 'sse',
      type: 'folder'
    });
  },

  async handleNodeRenamed(data) {
    if (this._skipIfEcho('rename', data.nodeId)) return;

    console.log(`[SYNC] SSE: node-renamed (${data.nodeType}): ${data.oldPath} → ${data.newPath}`);

    try {
      if (data.nodeType === 'folder') {
        await this._applyFolderRelocate(data.nodeId, data.oldPath, data.newPath);
      } else {
        await this._applyFileRelocate(data.nodeId, data.oldPath, data.newPath, data.nodeType);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-renamed for ${data.oldPath}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-renamed', { path: data.oldPath, error });
      }
      this.emit('sync-error', classifyError(error, { filename: data.oldPath, action: 'sse-node-renamed' }));
    }
  },

  async handleNodeMoved(data) {
    if (this._skipIfEcho('move', data.nodeId)) return;

    console.log(`[SYNC] SSE: node-moved (${data.nodeType}): ${data.oldPath} → ${data.newPath}`);

    try {
      if (data.nodeType === 'folder') {
        await this._applyFolderRelocate(data.nodeId, data.oldPath, data.newPath);
      } else {
        await this._applyFileRelocate(data.nodeId, data.oldPath, data.newPath, data.nodeType);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-moved for ${data.oldPath}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-moved', { path: data.oldPath, error });
      }
      this.emit('sync-error', classifyError(error, { filename: data.oldPath, action: 'sse-node-moved' }));
    }
  },

  async handleNodeDeleted(data) {
    if (this._skipIfEcho('delete', data.nodeId)) return;

    console.log(`[SYNC] SSE: node-deleted (${data.nodeType}): ${data.path}`);

    try {
      if (data.nodeType === 'folder') {
        await this._applyFolderDelete(data.nodeId, data.path);
      } else {
        await this._applyFileDelete(data.nodeId, data.path, data.nodeType);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-deleted for ${data.path}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-deleted', { path: data.path, error });
      }
      this.emit('sync-error', classifyError(error, { filename: data.path, action: 'sse-node-deleted' }));
    }
  },

  async _applyFileDelete(nodeId, fullPath, nodeType) {
    const entry = this.repo.get(nodeId);
    const localFilename = entry?.path || fullPath;
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);
    const trashPath = path.join(this.syncFolder, '.trash', localFilename);

    const exists = await fileExists(localPath);
    if (!exists) {
      console.log(`[SYNC] SSE node-deleted: ${localFilename} not found locally`);
      await this.repo.delete(nodeId);
      return;
    }

    await ensureDirectory(path.dirname(trashPath));

    if (nodeType === 'site') {
      liveSync.markBrowserSave(toFileId(localFilename));
    }

    await this._applyRemoteFsChange([localFilename], () => moveFile(localPath, trashPath));

    await this.repo.delete(nodeId);

    console.log(`[SYNC] SSE node-deleted: Trashed ${localFilename}`);
    this.emit('file-synced', { file: localFilename, action: 'trash', source: 'sse', type: nodeType });
  },

  async _applyFolderDelete(nodeId, fullPath) {
    const entry = this.repo.get(nodeId);
    const localFolderPath = entry?.path || fullPath;
    this.resolveContainedPath(localFolderPath);
    const localPath = path.join(this.syncFolder, localFolderPath);
    const trashPath = path.join(this.syncFolder, '.trash', localFolderPath);

    const descendants = this.repo.walkDescendants(localFolderPath);

    const oldSidePaths = [
      localFolderPath,
      ...descendants.map(({ entry: e }) => e.path)
    ];
    const exists = await fileExists(localPath);
    if (!exists) {
      console.log(`[SYNC] SSE node-deleted: folder ${localFolderPath} not found locally, cleaning nodeMap only`);
      await this.repo.apply(async (map) => {
        for (const { nodeId: descId } of descendants) {
          map.delete(descId);
        }
        map.delete(String(nodeId));
      });
      return;
    }

    await ensureDirectory(path.dirname(trashPath));

    await this._applyRemoteFsChange(oldSidePaths, async () => {
      try {
        await moveFile(localPath, trashPath);
      } catch (error) {
        const timestampedTrashPath = `${trashPath}.${Date.now()}`;
        console.warn(`[SYNC] SSE node-deleted: trash collision, using ${timestampedTrashPath}`);
        await moveFile(localPath, timestampedTrashPath);
      }
    });

    await this.repo.apply(async (map) => {
      for (const { nodeId: descId } of descendants) {
        map.delete(descId);
      }
      map.delete(String(nodeId));
    });

    console.log(`[SYNC] SSE node-deleted: Trashed folder ${localFolderPath} (${descendants.length} descendant(s))`);
    this.emit('file-synced', { file: localFolderPath, action: 'trash', source: 'sse', type: 'folder' });
  },

  async _applyFileRelocate(nodeId, oldPath, newPath, nodeType) {
    this.resolveContainedPath(newPath);
    const entry = this.repo.get(nodeId);
    const currentPath = entry?.path || oldPath;
    const localPath = path.join(this.syncFolder, currentPath);
    const newLocalPath = path.join(this.syncFolder, newPath);

    const exists = await fileExists(localPath);
    if (!exists) {
      const alreadyMoved = await fileExists(newLocalPath);
      if (alreadyMoved) {
        console.log(`[SYNC] SSE node-relocated: ${newPath} already in place`);
      } else {
        console.log(`[SYNC] SSE node-relocated: ${currentPath} not found locally`);
      }
      const inode = await nodeMap.getInode(newLocalPath);
      await this.repo.set(nodeId, {
        type: nodeType,
        path: newPath,
        checksum: entry?.checksum || null,
        inode
      });
      return;
    }

    if (nodeType === 'site') {
      liveSync.markBrowserSave(toFileId(currentPath));
      liveSync.markBrowserSave(toFileId(newPath));
    }

    this.cascade.mark([currentPath, newPath]);

    await ensureDirectory(path.dirname(newLocalPath));
    await moveFile(localPath, newLocalPath);

    const inode = await nodeMap.getInode(newLocalPath);
    await this.repo.set(nodeId, {
      type: nodeType,
      path: newPath,
      checksum: entry?.checksum || null,
      inode
    });

    console.log(`[SYNC] SSE node-relocated: ${currentPath} → ${newPath}`);
  },

  async _applyFolderRelocate(nodeId, oldPath, newPath) {
    this.resolveContainedPath(newPath);
    const entry = this.repo.get(nodeId);
    if (!entry || entry.type !== 'folder') {
      console.warn(`[SYNC] SSE node-relocated: folder nodeId ${nodeId} not in nodeMap or wrong type`);
    }

    const localOldPath = path.join(this.syncFolder, oldPath);
    const localNewPath = path.join(this.syncFolder, newPath);

    const descendants = this.repo.walkDescendants(oldPath);

    const oldToNew = new Map();
    for (const { nodeId: descId, entry: descEntry } of descendants) {
      const newDescPath = newPath + descEntry.path.substring(oldPath.length);
      oldToNew.set(descId, { newPath: newDescPath, entry: descEntry });
    }

    const allSuppressedPaths = [
      oldPath,
      newPath,
      ...descendants.map(({ entry: e }) => e.path),
      ...Array.from(oldToNew.values()).map(v => v.newPath)
    ];
    this.cascade.mark(allSuppressedPaths);

    const exists = await fileExists(localOldPath);
    if (!exists) {
      console.log(`[SYNC] SSE node-relocated: folder ${oldPath} not found locally, updating nodeMap only`);
      await this.repo.apply(async (map) => {
        this._applyFolderRelocateNodeMapUpdates(map, nodeId, newPath, oldToNew);
      });
      return;
    }

    const collision = await fileExists(localNewPath);
    if (collision) {
      console.warn(`[SYNC] SSE node-relocated: ${newPath} already exists locally; cannot apply rename`);
      return;
    }

    await ensureDirectory(path.dirname(localNewPath));

    await moveFile(localOldPath, localNewPath);

    await this.repo.apply(async (map) => {
      this._applyFolderRelocateNodeMapUpdates(map, nodeId, newPath, oldToNew);
    });

    console.log(`[SYNC] SSE node-relocated: folder ${oldPath} → ${newPath} (${descendants.length} descendant(s) updated)`);

    this.emit('file-synced', {
      file: newPath,
      action: 'relocate',
      source: 'sse',
      type: 'folder'
    });
  },

  _applyFolderRelocateNodeMapUpdates(map, folderNodeId, newPath, oldToNew) {
    for (const [descId, { newPath: descNewPath, entry: descEntry }] of oldToNew) {
      map.set(descId, { ...descEntry, path: descNewPath });
    }

    const folderEntry = map.get(String(folderNodeId));
    if (folderEntry) {
      map.set(String(folderNodeId), { ...folderEntry, path: newPath });
    }
  },

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
      'node-saved':   async (data) => this.handleNodeSaved(data),
      'node-renamed': async (data) => this.handleNodeRenamed(data),
      'node-moved':   async (data) => this.handleNodeMoved(data),
      'node-deleted': async (data) => this.handleNodeDeleted(data)
    };

    this.sseConnection.onmessage = async (event) => {
      if (!this.isRunning) return;
      this.lastSseActivity = Date.now();

      let parsedType = 'unknown';
      try {
        const data = JSON.parse(event.data);
        parsedType = data.type || 'live-sync';
        const handler = sseDispatch[parsedType];
        if (handler) await handler(data);
      } catch (error) {
        console.error('[SYNC] SSE: Error processing message:', error.message);
        if (this.logger) {
          this.logger.error('SSE', 'Error processing stream message', {
            error,
            messageType: parsedType,
            rawData: event.data ? event.data.substring(0, 200) : null
          });
        }
      }
    };

    this.sseConnection.onerror = (error) => {
      console.error('[SYNC] SSE stream error:', error.message || 'Connection error');
      if (this.logger) {
        this.logger.error('SSE', 'Stream error', {
          error: error.message || 'Connection error',
          willReconnect: this.isRunning && !this.sseReconnectTimer,
          reconnectDelayMs: 5000
        });
      }

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
  },

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
  },

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
  },

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
  },

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

      const serverFiles = await this.fetchAndCacheServerFiles(0);

      // Check if sync was stopped during the fetch
      if (!this.isRunning) {
        return;
      }

      const localFiles = await getLocalFiles(this.syncFolder);
      let changesFound = false;

      await this.repo.apply(async (map) => {
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
            await this.downloadFile(serverFile.nodeId);
            this.stats.filesDownloaded++;
            changesFound = true;
            if (serverFile.nodeId) {
              const inode = await nodeMap.getInode(path.join(this.syncFolder, relativePath));
              map.set(String(serverFile.nodeId), { path: relativePath, checksum: serverFile.checksum, inode });
            }
          } else {
            const localInfo = localFiles.get(relativePath);
            const localContent = await readFile(localPath);
            const localChecksum = await calculateChecksum(localContent);

            // Check if content is different
            if (localChecksum !== serverFile.checksum) {
              // Check if local is newer
              if (isLocalNewer(localInfo.mtime, serverFile.modifiedAt, this.clockOffset)) {
                console.log(`[SYNC] PRESERVE ${relativePath} - local is newer, uploading`);
                this.stats.filesProtected++;
                await this.uploadFile(relativePath);
              } else {
                // Download newer version from server
                await this.downloadFile(serverFile.nodeId);
                this.stats.filesDownloaded++;
                changesFound = true;
                if (serverFile.nodeId) {
                  const inode = await nodeMap.getInode(path.join(this.syncFolder, relativePath));
                  map.set(String(serverFile.nodeId), { path: relativePath, checksum: serverFile.checksum, inode });
                }
              }
            }
          }
        }
      });

      // Also check for upload changes
      if (!this.isRunning) return;

      const serverUploads = await this.fetchAndCacheServerUploads(10_000);
      const localUploads = await getLocalUploads(this.syncFolder);

      await this.repo.apply(async (map) => {
        for (const serverUpload of serverUploads) {
          if (!this.isRunning) return;

          const localPath = path.join(this.syncFolder, serverUpload.path);
          const localExists = localUploads.has(serverUpload.path);

          if (!localExists) {
            await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
            this.stats.uploadsDownloaded++;
            changesFound = true;
            if (serverUpload.nodeId) {
              map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
            }
          } else {
            const localInfo = localUploads.get(serverUpload.path);
            const localContent = await readFileBuffer(localPath);
            const localChecksum = calculateBufferChecksum(localContent);

            if (localChecksum !== serverUpload.checksum) {
              if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
                console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer, uploading`);
                this.stats.uploadsProtected++;
                await this.uploadUploadFile(serverUpload.path);
              } else {
                await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
                this.stats.uploadsDownloaded++;
                changesFound = true;
                if (serverUpload.nodeId) {
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
                }
              }
            }
          }
        }
      });

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
};

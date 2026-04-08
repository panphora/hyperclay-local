/**
 * Initial sync flow — runs once on boot to catch up with the server.
 *
 * Compares the server's view of nodes against the local disk and nodeMap,
 * downloads/uploads as needed, and detects structural changes (move, rename,
 * delete) that happened while offline. Methods here are installed onto
 * SyncEngine.prototype.
 */

const path = require('upath');
const { liveSync } = require('livesync-hyperclay');
const { classifyError, formatErrorForLog } = require('./error-handler');
const {
  getLocalFiles,
  readFile,
  fileExists,
  getFileStats,
  ensureDirectory,
  moveFile,
  getLocalUploads,
  readFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
const {
  renameNode,
  moveNode,
  deleteNode
} = require('./api-client');
const { calculateChecksum, isLocalNewer, isFutureFile } = require('./utils');
const { ERROR_PRIORITY } = require('./constants');
const nodeMap = require('./node-map');

module.exports = {
  /**
   * Perform initial sync - download files from server but preserve newer local files
   */
  async performInitialSync() {
    console.log('[SYNC] Starting initial sync...');
    this.emit('sync-start', { type: 'initial' });

    try {
      const serverFiles = await this.fetchAndCacheServerFiles(true);
      const localFiles = await getLocalFiles(this.syncFolder);

      await this.repo.apply(async (map) => {
        for (const serverFile of serverFiles) {
          await this.reconcileServerFile(serverFile, localFiles, map);
        }
      });

      // Detect server-side deletes: nodeIds in our map but NOT in the server's file list
      // Skip entirely on first-ever sync (no baseline to compare against)
      if (this.lastSyncedAt) {
        const serverNodeIds = new Set(serverFiles.map(f => String(f.nodeId)));
        await this.repo.apply(async (map) => {
          for (const [nid, entry] of map) {
            const localRelPath = entry.path;
            if (!serverNodeIds.has(nid)) {
              const fullPath = path.join(this.syncFolder, localRelPath);
              const exists = await fileExists(fullPath);
              if (exists) {
                const stats = await getFileStats(fullPath);
                if (stats.mtime > this.lastSyncedAt) {
                  console.log(`[SYNC] Skipping trash for ${localRelPath} — local file is newer than last sync (edited while offline)`);
                  map.delete(nid);
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
              map.delete(nid);
            }
          }
        });
      }

      // Detect local structural changes (delete/move/rename) that happened while offline
      if (this.lastSyncedAt) {
        await this.detectLocalChanges(serverFiles, localFiles);
      }

      await this.uploadLocalOnlyFiles(localFiles, serverFiles);

      this.lastSyncedAt = Date.now();
      await this.repo.saveState({ lastSyncedAt: this.lastSyncedAt });
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
  },

  /**
   * Reconcile a single server file against local state: move, download, or skip.
   * Mutates localFiles map when a file is moved.
   */
  async reconcileServerFile(serverFile, localFiles, map) {
    const relativePath = serverFile.path || serverFile.filename;
    this.resolveContainedPath(relativePath);
    const localPath = path.join(this.syncFolder, relativePath);
    let localExists = localFiles.has(relativePath);

    if (!localExists && serverFile.nodeId) {
      const knownEntry = map.get(String(serverFile.nodeId));
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

    const existingEntry = map.get(String(serverFile.nodeId)) || {};
    map.set(String(serverFile.nodeId), { path: relativePath, checksum: existingEntry.checksum || null, inode: existingEntry.inode || null });

    if (!localExists) {
      try {
        await this.downloadFile(serverFile.nodeId);
        this.stats.filesDownloaded++;
        const inode = await nodeMap.getInode(localPath);
        const content = await readFile(localPath).catch(() => null);
        const cs = content ? await calculateChecksum(content) : null;
        map.set(String(serverFile.nodeId), { path: relativePath, checksum: cs, inode });
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
      map.set(String(serverFile.nodeId), { path: relativePath, checksum: localChecksum, inode });

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

      await this.downloadFile(serverFile.nodeId);
      this.stats.filesDownloaded++;
      const dlContent = await readFile(localPath).catch(() => null);
      const dlChecksum = dlContent ? await calculateChecksum(dlContent) : null;
      const dlInode = await nodeMap.getInode(localPath);
      map.set(String(serverFile.nodeId), { path: relativePath, checksum: dlChecksum, inode: dlInode });
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
  },

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
  },

  /**
   * Detect local structural changes (delete/move/rename) that happened while offline.
   * Runs during performInitialSync after server-side reconciliation.
   */
  async detectLocalChanges(serverFiles, localFiles) {
    const serverNodeIds = new Set(serverFiles.map(f => String(f.nodeId)));
    const serverFilesByNodeId = new Map(serverFiles.map(f => [String(f.nodeId), f]));

    // Build reverse map: localPath → nodeId
    const reverseMap = new Map();
    for (const [nid, entry] of this.repo) {
      reverseMap.set(entry.path, nid);
    }

    // Track local files not in nodeMap (candidates for rename/move targets)
    const localOnlySet = new Set();
    for (const [relPath] of localFiles) {
      if (!reverseMap.has(relPath)) {
        localOnlySet.add(relPath);
      }
    }

    await this.repo.apply(async (map) => {
    for (const [nid, entry] of [...map]) {
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
          pendingOp: 'move',
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
          pendingOp: 'rename',
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
          pendingOp: 'rename',
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
              this.outbox.markInFlight(strategy.pendingOp, nid);
              const newEntry = await strategy.apply(localFile);
              this.invalidateServerFilesCache();
              map.set(nid, newEntry);
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
          await this.downloadFile(serverFile.nodeId);
        } catch (err) {
          console.error(`[SYNC] Failed to re-download ${serverPath} after delete conflict:`, err.message);
        }
        continue;
      }

      try {
        console.log(`[SYNC] Local delete detected: ${entry.path} (nodeId ${nid})`);
        this.outbox.markInFlight('delete', nid);
        await deleteNode(this.serverUrl, this.apiKey, parseInt(nid));
        this.invalidateServerFilesCache();
        map.delete(nid);
      } catch (err) {
        console.error(`[SYNC] Failed to sync local delete for nodeId ${nid}:`, err.message);
      }
    }
    }); // end repo.apply
  },

  /**
   * Perform initial sync for uploads
   */
  async performInitialUploadSync() {
    console.log('[SYNC] Starting initial upload sync...');
    this.emit('sync-start', { type: 'initial-uploads' });

    try {
      const serverUploads = await this.fetchAndCacheServerUploads(true);
      const localUploads = await getLocalUploads(this.syncFolder);

      await this.repo.apply(async (map) => {
        // Download server uploads not present locally
        for (const serverUpload of serverUploads) {
          const localPath = path.join(this.syncFolder, serverUpload.path);
          const localExists = localUploads.has(serverUpload.path);

          if (!localExists) {
            try {
              await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
              this.stats.uploadsDownloaded++;
              if (serverUpload.nodeId) {
                map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
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
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: null, inode: null });
                }
                continue;
              }

              // Check if local is newer
              if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
                console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer`);
                this.stats.uploadsProtected++;
                if (serverUpload.nodeId) {
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: null, inode: null });
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
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: localChecksum, inode: null });
                }
                continue;
              }

              // Server is newer, download it
              await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
              this.stats.uploadsDownloaded++;
              if (serverUpload.nodeId) {
                map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null });
              }
            } catch (error) {
              console.error(`[SYNC] Failed to process upload ${serverUpload.path}:`, error.message);
              this.stats.errors.push(formatErrorForLog(error, { filename: serverUpload.path, action: 'initial-upload-check' }));
            }
          }
        }

        // Upload local files not on server
        for (const [relativePath] of localUploads) {
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
      });

      console.log('[SYNC] Initial upload sync complete');
      this.emit('sync-complete', { type: 'initial-uploads', stats: this.stats });

    } catch (error) {
      console.error('[SYNC] Initial upload sync failed:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'initial-upload-sync' }));
      // Don't throw - allow sync to continue even if upload sync fails
    }
  },

  async populateFolderNodeMap() {
    console.log('[SYNC] Populating folder nodeMap entries...');

    const nodes = await this.fetchAndCacheServerNodes(true);
    const folders = nodes.filter(n => n.type === 'folder');

    let added = 0;
    await this.repo.apply(async (map) => {
      for (const folder of folders) {
        const fullPath = folder.path ? `${folder.path}/${folder.name}` : folder.name;
        const localPath = path.join(this.syncFolder, fullPath);

        try {
          await ensureDirectory(localPath);
        } catch (error) {
          console.warn(`[SYNC] Could not create local folder ${fullPath}:`, error.message);
        }

        const inode = await nodeMap.getInode(localPath);
        map.set(String(folder.id), {
          type: 'folder',
          path: fullPath,
          parentId: folder.parentId,
          inode
        });
        added++;
      }
    });
    console.log(`[SYNC] Added ${added} folder(s) to nodeMap`);
  }
};

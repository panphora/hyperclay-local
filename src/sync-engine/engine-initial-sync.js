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
  getLocalFolders,
  readFile,
  fileExists,
  getFileStats,
  ensureDirectory,
  moveFile,
  getLocalUploads,
  readFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
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
      // Fetch and cache server files — also warms serverNodesCache and serverFilesCache
      // so that downloadFile() can resolve nodeId → path without a separate lookup.
      const serverFiles = await this.fetchAndCacheServerFiles(30_000);
      const allServerNodes = this.serverNodesCache;

      const localFiles = await getLocalFiles(this.syncFolder, this.logger);

      await this.repo.apply(async (map) => {
        for (const serverFile of serverFiles) {
          await this.reconcileServerFile(serverFile, localFiles, map);
        }
      });

      // Detect server-side deletes: nodeIds in our map but NOT in the server's node list.
      // Skip entirely on first-ever sync (no baseline to compare against).
      if (this.lastSyncedAt) {
        const serverNodeIds = new Set(allServerNodes.map(n => String(n.id)));
        await this.repo.apply(async (map) => {
          for (const [nid, entry] of map) {
            if (serverNodeIds.has(nid)) continue;

            if (entry.type === 'folder') {
              // Folder deleted on server while offline.
              // Don't trash the local directory — it may contain unsynced local content.
              // Remove folder and all descendants from repo; watcher re-creates if still local.
              const descendants = this.repo.walkDescendants(entry.path);
              for (const { nodeId: descId } of descendants) {
                map.delete(descId);
              }
              map.delete(nid);
              console.log(`[SYNC] Folder removed from server while offline, cleared from nodeMap: ${entry.path} (nodeId ${nid})`);
              continue;
            }

            const localRelPath = entry.path;
            const fullPath = path.join(this.syncFolder, localRelPath);
            const exists = await fileExists(fullPath);
            if (exists) {
              const stats = await getFileStats(fullPath);
              const entrySyncedAt = entry.syncedAt ?? this.lastSyncedAt;
              if (stats.mtime > entrySyncedAt) {
                console.log(`[SYNC] Skipping trash for ${localRelPath} — local file is newer than last sync (edited while offline)`);
                map.delete(nid);
                continue;
              }

              const trashPath = path.join(this.syncFolder, '.trash', localRelPath);
              await ensureDirectory(path.dirname(trashPath));
              // Full path + extension — matches wasBrowserSave in engine-watcher.
              liveSync.markBrowserSave(localRelPath);
              await moveFile(fullPath, trashPath);
              localFiles.delete(localRelPath);
              console.log(`[SYNC] Trashed ${localRelPath} (deleted on server while offline, nodeId ${nid})`);
              this.emit('file-synced', { file: localRelPath, action: 'trash', source: 'initial-sync' });
            }
            map.delete(nid);
          }
        });
      }

      // Detect local structural changes (delete/move/rename) that happened while offline
      if (this.lastSyncedAt) {
        await this.detectLocalChanges(allServerNodes, localFiles);
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
        try {
          liveSync.markBrowserSave(relativePath);
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
    map.set(String(serverFile.nodeId), { path: relativePath, checksum: existingEntry.checksum || null, inode: existingEntry.inode || null, syncedAt: existingEntry.syncedAt });

    if (!localExists) {
      // Offline-rename pre-check: if the existing entry has an inode and a local
      // file with that inode is present elsewhere on disk, the user renamed the
      // file while offline. Skip the download and let detectLocalChanges correlate
      // the rename against the preserved inode. Downloading first would overwrite
      // the entry's inode with the new file's inode, breaking the inode-match
      // strategy and producing a duplicate node + orphan file.
      if (existingEntry.inode) {
        let inodeMatchPath = null;
        for (const [candidatePath] of localFiles) {
          const candidateFullPath = path.join(this.syncFolder, candidatePath);
          const candidateInode = await nodeMap.getInode(candidateFullPath);
          if (candidateInode && candidateInode === existingEntry.inode) {
            inodeMatchPath = candidatePath;
            break;
          }
        }
        if (inodeMatchPath) {
          console.log(`[SYNC] Deferring download of ${relativePath} to detectLocalChanges — inode match at ${inodeMatchPath} (likely offline rename)`);
          if (this.logger) {
            this.logger.info('SYNC', 'Deferring download — inode match suggests offline rename', {
              file: relativePath,
              inodeMatchAt: inodeMatchPath,
              inode: existingEntry.inode
            });
          }
          return;
        }
      }

      try {
        await this.downloadFile(serverFile.nodeId);
        this.stats.filesDownloaded++;
        const inode = await nodeMap.getInode(localPath);
        const content = await readFile(localPath).catch(() => null);
        const cs = content ? await calculateChecksum(content) : null;
        map.set(String(serverFile.nodeId), { path: relativePath, checksum: cs, inode, syncedAt: Date.now() });
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
      map.set(String(serverFile.nodeId), { path: relativePath, checksum: localChecksum, inode, syncedAt: Date.now() });

      if (isFutureFile(localStat.mtime, this.clockOffset)) {
        console.log(`[SYNC] PRESERVE ${relativePath} - future-dated file`);
        this.stats.filesProtected++;
        if (this.logger) {
          this.logger.warn('SYNC', 'Site skipped - future-dated local file', {
            file: relativePath,
            localMtime: localStat.mtime,
            clockOffset: this.clockOffset
          });
        }
        return;
      }

      if (isLocalNewer(localStat.mtime, serverFile.modifiedAt, this.clockOffset)) {
        console.log(`[SYNC] PRESERVE ${relativePath} - local is newer, uploading`);
        this.stats.filesProtected++;
        if (this.logger) {
          this.logger.info('SYNC', 'Site local is newer than server - uploading', {
            file: relativePath,
            localMtime: localStat.mtime,
            serverModifiedAt: serverFile.modifiedAt,
            clockOffset: this.clockOffset
          });
        }
        await this.uploadFile(relativePath);
        return;
      }

      if (localChecksum === serverFile.checksum) {
        console.log(`[SYNC] SKIP ${relativePath} - checksums match`);
        this.stats.filesDownloadedSkipped++;
        if (this.logger) {
          this.logger.info('SYNC', 'Site skipped - checksums match', {
            file: relativePath,
            checksum: localChecksum
          });
        }
        return;
      }

      await this.downloadFile(serverFile.nodeId);
      this.stats.filesDownloaded++;
      const dlContent = await readFile(localPath).catch(() => null);
      const dlChecksum = dlContent ? await calculateChecksum(dlContent) : null;
      const dlInode = await nodeMap.getInode(localPath);
      map.set(String(serverFile.nodeId), { path: relativePath, checksum: dlChecksum, inode: dlInode, syncedAt: Date.now() });
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
   */
  async uploadLocalOnlyFiles(localFiles, serverFiles) {
    for (const [relativePath, localInfo] of localFiles) {
      const serverFile = serverFiles.find(f =>
        (f.path === relativePath) || (f.filename === relativePath)
      );

      if (!serverFile) {
        console.log(`[SYNC] LOCAL ONLY: ${relativePath} - uploading`);
        try {
          const parentFolder = relativePath.split('/').slice(0, -1).join('/');
          if (parentFolder && !this.repo.getByPath(parentFolder)) {
            await this.createFolderOnServer(parentFolder);
          }
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
  async detectLocalChanges(allServerNodes, localFiles) {
    const serverNodeIds = new Set(allServerNodes.map(n => String(n.id)));
    const serverNodeById = new Map(allServerNodes.map(n => [String(n.id), n]));
    // Use server-declared type for routing — repo entries may not have a type field set.
    const serverSiteIds = new Set(
      allServerNodes.filter(n => n.type === 'site').map(n => String(n.id))
    );

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
      if (!serverSiteIds.has(nid)) continue; // uploads/folders: handled by their own detect functions

      const serverNode = serverNodeById.get(nid);
      const serverPath = serverNode
        ? (serverNode.path ? `${serverNode.path}/${serverNode.name}` : serverNode.name)
        : entry.path;

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
            // Folder names never carry .html/.htmlclay extensions (validator regex
            // forbids dots); the previous .replace() was a no-op for real data.
            const folderPath = targetFolder === '.' ? '' : targetFolder;
            const targetParentId = this.resolveParentIdByPath(folderPath);
            await this._apiMoveNode(nid, targetParentId);
            const inode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            const cs = content ? await calculateChecksum(content) : entry.checksum;
            return { path: localFile, checksum: cs, inode, syncedAt: Date.now() };
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
            await this._apiRenameNode(nid, newName);
            const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            return { path: localFile, checksum: entry.checksum, inode: localInode, syncedAt: Date.now() };
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
            await this._apiRenameNode(nid, newName);
            const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            const cs = content ? await calculateChecksum(content) : entry.checksum;
            return { path: localFile, checksum: cs, inode: localInode, syncedAt: Date.now() };
          }
        }
      ];

      let handled = false;
      for (const strategy of strategies) {
        for (const localFile of localOnlySet) {
          if (await strategy.match(localFile)) {
            try {
              console.log(`[SYNC] Local ${strategy.name} detected: ${entry.path} → ${localFile} (nodeId ${nid})`);
              const newEntry = await strategy.apply(localFile);
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
      // Check for delete conflict using per-entry syncedAt (falling back to the
      // global lastSyncedAt for legacy entries). The global timestamp alone is
      // stale for watcher-uploaded files and produces false-positive re-downloads
      // when a file is deleted while offline.
      const entrySyncedAt = entry.syncedAt ?? this.lastSyncedAt;
      if (serverNode.modifiedAt && new Date(serverNode.modifiedAt).getTime() > entrySyncedAt) {
        console.log(`[SYNC] Delete conflict: ${entry.path} deleted locally but modified on server — re-downloading`);
        if (this.logger) {
          this.logger.warn('SYNC', 'Delete conflict - local delete overridden by server change', {
            file: entry.path,
            serverModifiedAt: serverNode.modifiedAt,
            entrySyncedAt: new Date(entrySyncedAt).toISOString(),
            usedFallback: entry.syncedAt == null
          });
        }
        try {
          await this.downloadFile(serverNode.id);
        } catch (err) {
          console.error(`[SYNC] Failed to re-download ${serverPath} after delete conflict:`, err.message);
        }
        continue;
      }

      try {
        console.log(`[SYNC] Local delete detected: ${entry.path} (nodeId ${nid})`);
        await this._apiDeleteNode(nid);
        map.delete(nid);
      } catch (err) {
        console.error(`[SYNC] Failed to sync local delete for nodeId ${nid}:`, err.message);
      }
    }
    }); // end repo.apply
  },

  /**
   * Detect local structural changes (delete/move/rename) for uploads that happened while offline.
   */
  async detectLocalUploadChanges(allServerNodes, localUploads) {
    const serverNodeById = new Map(allServerNodes.map(n => [String(n.id), n]));
    // Route only upload nodes — use server-declared type, not local entry.type.
    const serverUploadIds = new Set(
      allServerNodes.filter(n => n.type === 'upload').map(n => String(n.id))
    );

    const reverseMap = new Map();
    for (const [nid, entry] of this.repo) {
      reverseMap.set(entry.path, nid);
    }

    const localUploadOnlySet = new Set();
    for (const [relPath] of localUploads) {
      if (!reverseMap.has(relPath)) localUploadOnlySet.add(relPath);
    }

    await this.repo.apply(async (map) => {
      for (const [nid, entry] of [...map]) {
        if (!serverUploadIds.has(nid)) continue; // not an upload node (or not on server)

        const serverNode = serverNodeById.get(nid);
        const serverPath = serverNode
          ? (serverNode.path ? `${serverNode.path}/${serverNode.name}` : serverNode.name)
          : entry.path;

        if (serverPath !== entry.path) continue; // server changed path — server wins
        if (localUploads.has(entry.path)) continue; // still at expected path

        const expectedBasename = path.basename(entry.path);

        const strategies = [
          {
            name: 'move',
            pendingOp: 'move',
            match: async (localFile) => path.basename(localFile) === expectedBasename,
            apply: async (localFile) => {
              const targetFolder = path.dirname(localFile);
              const folderPath = targetFolder === '.' ? '' : targetFolder;
              const targetParentId = this.resolveParentIdByPath(folderPath);
              await this._apiMoveNode(nid, targetParentId);
              const inode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
              const buf = await readFileBuffer(path.join(this.syncFolder, localFile)).catch(() => null);
              const cs = buf ? calculateBufferChecksum(buf) : entry.checksum;
              return { type: 'upload', path: localFile, checksum: cs, inode, syncedAt: Date.now() };
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
              await this._apiRenameNode(nid, newName);
              const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
              return { type: 'upload', path: localFile, checksum: entry.checksum, inode: localInode, syncedAt: Date.now() };
            }
          },
          {
            name: 'rename (checksum match)',
            pendingOp: 'rename',
            match: async (localFile) => {
              if (!entry.checksum) return false;
              const buf = await readFileBuffer(path.join(this.syncFolder, localFile)).catch(() => null);
              if (!buf) return false;
              return calculateBufferChecksum(buf) === entry.checksum;
            },
            apply: async (localFile) => {
              const newName = path.basename(localFile);
              await this._apiRenameNode(nid, newName);
              const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFile));
              const buf = await readFileBuffer(path.join(this.syncFolder, localFile)).catch(() => null);
              const cs = buf ? calculateBufferChecksum(buf) : entry.checksum;
              return { type: 'upload', path: localFile, checksum: cs, inode: localInode, syncedAt: Date.now() };
            }
          }
        ];

        let handled = false;
        for (const strategy of strategies) {
          for (const localFile of localUploadOnlySet) {
            if (await strategy.match(localFile)) {
              try {
                console.log(`[SYNC] Local upload ${strategy.name}: ${entry.path} → ${localFile} (nodeId ${nid})`);
                const newEntry = await strategy.apply(localFile);
                map.set(nid, newEntry);
                localUploadOnlySet.delete(localFile);
                handled = true;
                if (this.logger) {
                  this.logger.info('SYNC', `Upload ${strategy.name} synced to server`, {
                    from: entry.path,
                    to: localFile,
                    nodeId: nid
                  });
                }
              } catch (err) {
                console.error(`[SYNC] Failed to sync local upload ${strategy.name} for nodeId ${nid}:`, err.message);
                if (this.logger) {
                  this.logger.error('SYNC', `Failed to sync offline upload ${strategy.name}`, {
                    file: entry.path,
                    target: localFile,
                    nodeId: nid,
                    error: err.message
                  });
                }
              }
              break;
            }
          }
          if (handled) break;
        }
        if (handled) continue;

        // No match — local delete
        try {
          console.log(`[SYNC] Local upload delete detected: ${entry.path} (nodeId ${nid})`);
          await this._apiDeleteNode(nid);
          map.delete(nid);
          if (this.logger) {
            this.logger.info('SYNC', 'Upload delete synced to server', {
              file: entry.path,
              nodeId: nid
            });
          }
        } catch (err) {
          console.error(`[SYNC] Failed to sync local upload delete for nodeId ${nid}:`, err.message);
          if (this.logger) {
            this.logger.error('SYNC', 'Failed to sync offline upload delete', {
              file: entry.path,
              nodeId: nid,
              error: err.message
            });
          }
        }
      }
    });
  },

  /**
   * Perform initial sync for uploads
   */
  async performInitialUploadSync() {
    console.log('[SYNC] Starting initial upload sync...');
    this.emit('sync-start', { type: 'initial-uploads' });

    try {
      const serverUploads = await this.fetchAndCacheServerUploads(30_000);
      const localUploads = await getLocalUploads(this.syncFolder, this.logger);

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
                map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null, syncedAt: Date.now() });
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
                if (this.logger) {
                  this.logger.warn('SYNC', 'Upload skipped - future-dated local file', {
                    file: serverUpload.path,
                    localMtime: localInfo.mtime,
                    clockOffset: this.clockOffset
                  });
                }
                if (serverUpload.nodeId) {
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: null, inode: null });
                }
                continue;
              }

              // Check if local is newer
              if (isLocalNewer(localInfo.mtime, serverUpload.modifiedAt, this.clockOffset)) {
                console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local is newer, uploading`);
                this.stats.uploadsProtected++;
                if (this.logger) {
                  this.logger.info('SYNC', 'Upload local is newer than server - uploading', {
                    file: serverUpload.path,
                    localMtime: localInfo.mtime,
                    serverModifiedAt: serverUpload.modifiedAt,
                    clockOffset: this.clockOffset
                  });
                }
                if (serverUpload.nodeId) {
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: null, inode: null });
                }
                await this.uploadUploadFile(serverUpload.path);
                continue;
              }

              // Check checksums
              const localContent = await readFileBuffer(localPath);
              const localChecksum = calculateBufferChecksum(localContent);

              if (localChecksum === serverUpload.checksum) {
                console.log(`[SYNC] SKIP upload ${serverUpload.path} - checksums match`);
                this.stats.uploadsSkipped++;
                if (this.logger) {
                  this.logger.info('SYNC', 'Upload skipped - checksums match', {
                    file: serverUpload.path,
                    checksum: localChecksum
                  });
                }
                if (serverUpload.nodeId) {
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: localChecksum, inode: null, syncedAt: Date.now() });
                }
                continue;
              }

              // Server is newer, download it
              await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
              this.stats.uploadsDownloaded++;
              if (serverUpload.nodeId) {
                map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null, syncedAt: Date.now() });
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
              const parentFolder = relativePath.split('/').slice(0, -1).join('/');
              if (parentFolder && !this.repo.getByPath(parentFolder)) {
                await this.createFolderOnServer(parentFolder);
              }
              await this.uploadUploadFile(relativePath);
              // Note: uploadsUploaded is incremented inside uploadUploadFile
            } catch (error) {
              console.error(`[SYNC] Failed to upload ${relativePath}:`, error.message);
              this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'initial-upload-upload' }));
            }
          }
        }
      });

      if (this.lastSyncedAt) {
        const allServerNodes = await this.fetchAndCacheServerNodes(30_000); // reuse pipeline cache
        await this.detectLocalUploadChanges(allServerNodes, localUploads);
      }

      console.log('[SYNC] Initial upload sync complete');
      this.emit('sync-complete', { type: 'initial-uploads', stats: this.stats });

    } catch (error) {
      console.error('[SYNC] Initial upload sync failed:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'initial-upload-sync' }));
      // Don't throw - allow sync to continue even if upload sync fails
    }
  },

  async performInitialFolderSync() {
    console.log('[SYNC] Starting initial folder sync...');

    const allServerNodes = await this.fetchAndCacheServerNodes(0);
    const serverFolders = allServerNodes.filter(n => n.type === 'folder');
    const serverNodeIds = new Set(allServerNodes.map(n => String(n.id)));

    // Step 1: Ensure all server folders exist locally and are tracked in the repo.
    let added = 0;
    await this.repo.apply(async (map) => {
      for (const folder of serverFolders) {
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
    console.log(`[SYNC] Synced ${added} server folder(s) to local`);

    // Step 2: Detect structural changes (rename/move/delete) that happened while offline.
    // Only runs when we have a baseline to compare against (not first-ever sync).
    if (this.lastSyncedAt) {
      const localFolders = await getLocalFolders(this.syncFolder, this.logger);
      await this.detectLocalFolderChanges(allServerNodes, serverNodeIds, localFolders);
    }

    console.log('[SYNC] Initial folder sync complete');
  },

  /**
   * Detect local folder structural changes (rename/move/delete) that happened while offline.
   */
  async detectLocalFolderChanges(allServerNodes, serverNodeIds, localFolders) {
    const serverNodeById = new Map(allServerNodes.map(n => [String(n.id), n]));

    const trackedFolderPaths = new Map(); // relativePath → nid
    for (const [nid, entry] of this.repo) {
      if (entry.type === 'folder') trackedFolderPaths.set(entry.path, nid);
    }

    const localFolderOnlySet = new Set();
    for (const [relPath] of localFolders) {
      if (!trackedFolderPaths.has(relPath)) localFolderOnlySet.add(relPath);
    }

    const serverFolderIds = new Set(
      allServerNodes.filter(n => n.type === 'folder').map(n => String(n.id))
    );

    await this.repo.apply(async (map) => {
      for (const [nid, entry] of [...map]) {
        if (!serverFolderIds.has(nid)) continue; // not a folder node (or not on server)

        const serverNode = serverNodeById.get(nid);
        const serverPath = serverNode
          ? (serverNode.path ? `${serverNode.path}/${serverNode.name}` : serverNode.name)
          : entry.path;

        if (serverPath !== entry.path) continue; // server moved it — server wins
        if (localFolders.has(entry.path)) continue; // folder still at expected path

        // Folder is gone from its expected local path but still exists on server.
        // Find where it went using inode identity.
        let handled = false;

        for (const localFolder of localFolderOnlySet) {
          const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFolder));
          if (!localInode || !entry.inode || localInode !== entry.inode) continue;

          // Inode match — same folder, moved/renamed locally
          const oldBasename = path.basename(entry.path);
          const newBasename = path.basename(localFolder);
          const oldDirname = path.dirname(entry.path);
          const newDirname = path.dirname(localFolder);
          const normalizeDir = d => (d === '.' ? '' : d);

          const isRename = newBasename !== oldBasename && normalizeDir(newDirname) === normalizeDir(oldDirname);
          const isMove   = newBasename === oldBasename && normalizeDir(newDirname) !== normalizeDir(oldDirname);
          const shape    = isRename ? 'rename' : isMove ? 'move' : 'move+rename';

          try {
            console.log(`[SYNC] Local folder ${shape} detected: ${entry.path} → ${localFolder} (nodeId ${nid})`);

            if (shape === 'rename') {
              await this._apiRenameNode(nid, newBasename);
            } else if (shape === 'move') {
              const targetParentId = this.resolveParentIdByPath(normalizeDir(newDirname));
              await this._apiMoveNode(nid, targetParentId);
            } else {
              const targetParentId = this.resolveParentIdByPath(normalizeDir(newDirname));
              await this._apiMoveNode(nid, targetParentId, newBasename);
            }

            // Update repo: this folder and all descendants
            const descendants = this.repo.walkDescendants(entry.path);
            for (const { nodeId: descId, entry: descEntry } of descendants) {
              const newPath = localFolder + descEntry.path.slice(entry.path.length);
              map.set(descId, { ...descEntry, path: newPath });
            }
            map.set(nid, { type: 'folder', path: localFolder, parentId: entry.parentId, inode: localInode });

            localFolderOnlySet.delete(localFolder);
            handled = true;
            if (this.logger) {
              this.logger.info('SYNC', `Folder ${shape} synced to server`, {
                from: entry.path,
                to: localFolder,
                nodeId: nid,
                descendantsUpdated: descendants.length
              });
            }
          } catch (err) {
            console.error(`[SYNC] Failed to sync local folder ${shape} for nodeId ${nid}:`, err.message);
            if (this.logger) {
              this.logger.error('SYNC', `Failed to sync offline folder ${shape}`, {
                from: entry.path,
                to: localFolder,
                nodeId: nid,
                error: err.message
              });
            }
          }
          break;
        }

        if (handled) continue;

        // No inode match — folder was deleted locally while offline.
        // Cascade=true tells the server to soft-delete every descendant first,
        // which the platform requires before removing a non-empty folder.
        try {
          console.log(`[SYNC] Local folder delete detected: ${entry.path} (nodeId ${nid})`);
          await this._apiDeleteNode(nid, { cascade: true });

          const descendants = this.repo.walkDescendants(entry.path);
          for (const { nodeId: descId } of descendants) {
            map.delete(descId);
          }
          map.delete(nid);
          if (this.logger) {
            this.logger.info('SYNC', 'Folder delete synced to server', {
              folder: entry.path,
              nodeId: nid,
              descendantsDeleted: descendants.length
            });
          }
        } catch (err) {
          console.error(`[SYNC] Failed to sync local folder delete for nodeId ${nid}:`, err.message);
          if (this.logger) {
            this.logger.error('SYNC', 'Failed to sync offline folder delete', {
              folder: entry.path,
              nodeId: nid,
              error: err.message
            });
          }
        }
      }
    });
  }
};

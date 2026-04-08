/**
 * Local filesystem watcher and reaction to local changes.
 *
 * Covers the chokidar setup, the raw event shims, rename/move correlation
 * via pending-unlink tracking, folder cascade suppression, folder identity
 * waits, and per-type handlers that forward into the queue or folder create.
 * Methods are installed onto SyncEngine.prototype.
 */

const path = require('upath');
const chokidar = require('chokidar');
const { liveSync } = require('livesync-hyperclay');
const { formatErrorForLog } = require('./error-handler');
const {
  readFile,
  readFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
const {
  renameNode,
  moveNode,
  deleteNode
} = require('./api-client');
const { calculateChecksum } = require('./utils');
const { SYNC_CONFIG } = require('./constants');
const { classifyPath } = require('./path-helpers');
const nodeMap = require('./node-map');

module.exports = {
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
  },

  // --- Event handler shims ---

  _onAdd(filename) {
    const normalizedPath = path.normalize(filename);

    if (this.cascade.consume(normalizedPath)) {
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
  },

  _onAddDir(dirname) {
    const normalizedPath = path.normalize(dirname);

    if (!normalizedPath || normalizedPath === '' || normalizedPath === '.') return;

    if (this.cascade.consume(normalizedPath)) {
      console.log(`[SYNC] Watcher: Suppressed cascade event for ${normalizedPath}`);
      return;
    }

    if (this._tryCorrelatePendingUnlink(normalizedPath, 'folder')) {
      return;
    }

    this._handleFolderAdd(normalizedPath);
  },

  _onChange(filename) {
    const normalizedPath = path.normalize(filename);

    if (this.cascade.consume(normalizedPath)) return;

    const type = classifyPath(normalizedPath, 'change');
    if (type === 'site') {
      this._handleSiteChange(normalizedPath);
    } else if (type === 'upload') {
      this._handleUploadChange(normalizedPath);
    }
  },

  _onUnlink(filename) {
    const normalizedPath = path.normalize(filename);

    if (this.cascade.consume(normalizedPath)) return;

    const type = classifyPath(normalizedPath, 'unlink');
    this._registerPendingUnlink(normalizedPath, type);
  },

  _onUnlinkDir(dirname) {
    const normalizedPath = path.normalize(dirname);

    if (!normalizedPath || normalizedPath === '' || normalizedPath === '.') return;

    if (this.cascade.consume(normalizedPath)) return;

    this._registerPendingUnlink(normalizedPath, 'folder');
  },

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
        this.outbox.markInFlight('delete', foundNodeId);
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
  },

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
  },

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
        this.outbox.markInFlight('delete', pending.nodeId);
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
        this.outbox.markInFlight('move', pending.nodeId);
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await moveNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), targetParentId);
      } else if (shape === 'rename') {
        console.log(`[SYNC] Watcher: Local ${type} rename detected: ${oldPath} → ${newPath}`);
        this.outbox.markInFlight('rename', pending.nodeId);
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
      } else {
        console.log(`[SYNC] Watcher: Local ${type} move+rename detected: ${oldPath} → ${newPath}`);
        this.outbox.markInFlight('rename', pending.nodeId);
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
        this.outbox.markInFlight('move', pending.nodeId);
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
  },

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
        this.outbox.markInFlight('delete', pending.nodeId);
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
    this.cascade.mark([newPath, ...expectedNewPaths]);

    const addBasename = path.basename(newPath);
    const newDirname = path.dirname(newPath);
    const newFolderPath = newDirname === '.' ? '' : newDirname;

    try {
      if (shape === 'move') {
        console.log(`[SYNC] Watcher: Local folder move detected: ${oldPath} → ${newPath}`);
        this.outbox.markInFlight('move', pending.nodeId);
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await moveNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), targetParentId);
      } else if (shape === 'rename') {
        console.log(`[SYNC] Watcher: Local folder rename detected: ${oldPath} → ${newPath}`);
        this.outbox.markInFlight('rename', pending.nodeId);
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
      } else {
        console.log(`[SYNC] Watcher: Local folder move+rename detected: ${oldPath} → ${newPath}`);
        this.outbox.markInFlight('rename', pending.nodeId);
        await renameNode(this.serverUrl, this.apiKey, parseInt(pending.nodeId), addBasename);
        this.outbox.markInFlight('move', pending.nodeId);
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
  },

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
  },

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
  },

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
  },

  async _handleSiteChange(normalizedPath) {
    const fileId = normalizedPath.replace(/\.(html|htmlclay)$/, '');

    // Walk nodeMap once for both checksum comparison AND nodeId resolution
    let storedChecksum = null;
    let foundNodeId = null;
    for (const [nid, entry] of this.nodeMap) {
      if (entry.path === normalizedPath && entry.type === 'site') {
        storedChecksum = entry.checksum;
        foundNodeId = nid;
        break;
      }
    }

    // Content comparison: skip if file content hasn't actually changed
    try {
      const localPath = path.join(this.syncFolder, normalizedPath);
      const content = await readFile(localPath);
      const newChecksum = await calculateChecksum(content);

      if (storedChecksum && storedChecksum === newChecksum) {
        console.log(`[SYNC] File changed but content identical (skipping): ${normalizedPath}`);
        return;
      }
    } catch (e) {
      // File read failed — fall through
    }

    console.log(`[SYNC] Site changed: ${normalizedPath}`);
    this.queueSync('change', normalizedPath);

    // Toast suppression: don't notify the browser if this change is the local
    // observation of an SSE-driven save we just applied.
    const recentSseSave = foundNodeId && this.recentSseNodeSaves.has(`site:${foundNodeId}`);
    if (!liveSync.wasBrowserSave(fileId) && !recentSseSave) {
      liveSync.notify(fileId, {
        msgType: 'warning',
        msg: 'File changed on disk',
        action: 'reload',
        persistent: true
      });
    } else if (recentSseSave) {
      console.log(`[SYNC] Suppressing toast for ${fileId} (recent SSE node-saved)`);
    }
  },

  _handleUploadAdd(normalizedPath) {
    console.log(`[SYNC] Upload added: ${normalizedPath}`);
    this.queueSync('add', normalizedPath);
  },

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
  },

  _handleFolderAdd(normalizedPath) {
    console.log(`[SYNC] Folder added: ${normalizedPath}`);
    this.createFolderOnServer(normalizedPath).catch(err => {
      console.error(`[SYNC] Failed to create folder ${normalizedPath}:`, err.message);
    });
  }
};

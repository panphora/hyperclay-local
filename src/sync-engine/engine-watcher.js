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
const { calculateChecksum } = require('./utils');
const { SYNC_CONFIG } = require('./constants');
const { classifyPath, ancestorPaths } = require('./path-helpers');
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
    // Grace period before committing a local delete to the server. During this
    // window, a matching `add` with a different name/location will be correlated
    // as a rename/move rather than delete+create. Bumped from 1500 to 3000ms
    // because slow rename tools (rsync, cloud sync daemons, some editors) can
    // exceed 1.5s between unlink and add — and for folders a misclassification
    // causes a cascading delete of every descendant on the server.
    const UNLINK_GRACE_PERIOD = 3000;

    let foundNodeId = null;
    let foundEntry = null;
    for (const [nid, entry] of this.repo) {
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

    // If an ancestor folder already has a pending unlink, this delete is part
    // of its cascade (either a folder rename/move which `_correlateFolderUnlinkAdd`
    // will handle, or a folder delete whose server-side cascade will clean up
    // descendants automatically). Don't arm our own timer — otherwise it would
    // fire against an already-cascaded node and produce a spurious 404.
    const ancestors = ancestorPaths(normalizedPath);
    for (const ancestorPath of ancestors) {
      const ancestor = this.pendingUnlinks.get(ancestorPath);
      if (ancestor && ancestor.type === 'folder') {
        console.log(`[SYNC] Watcher: Skipping pending unlink for ${normalizedPath} — covered by ancestor folder unlink at ${ancestorPath}`);
        return;
      }
    }

    // Conversely, if this unlink is itself a folder, cancel any existing
    // pending unlinks for descendants that chokidar may have already reported.
    // They're covered by our cascade (rename correlation or server delete
    // cascade) and firing their individual timers would produce spurious 404s.
    if (type === 'folder') {
      const prefix = normalizedPath + '/';
      const cancelled = [];
      for (const [entryPath, pendingEntry] of this.pendingUnlinks) {
        if (entryPath.startsWith(prefix)) {
          clearTimeout(pendingEntry.timerId);
          this.pendingUnlinks.delete(entryPath);
          cancelled.push(entryPath);
        }
      }
      if (cancelled.length > 0 && this.logger) {
        this.logger.info('WATCHER', 'Cancelled existing descendant pending-unlinks under newly-registered folder unlink', {
          folder: normalizedPath,
          cancelledCount: cancelled.length,
          cancelled
        });
      }
    }

    const timerId = setTimeout(async () => {
      this.pendingUnlinks.delete(normalizedPath);
      console.log(`[SYNC] Watcher: Local ${type} delete detected: ${normalizedPath} (nodeId ${foundNodeId})`);
      try {
        await this._apiDeleteNode(foundNodeId);

        await this.repo.apply(async (map) => {
          if (type === 'folder') {
            const descendants = this.repo.walkDescendants(normalizedPath);
            if (this.logger) {
              this.logger.info('WATCHER', 'Folder deleted - removing descendants from nodeMap', {
                folder: normalizedPath,
                nodeId: foundNodeId,
                descendantsRemoved: descendants.length
              });
            }
            for (const { nodeId: descId } of descendants) {
              map.delete(descId);
            }
          }
          map.delete(foundNodeId);
        });
      } catch (err) {
        console.error(`[SYNC] Watcher: Failed to sync ${type} delete for ${normalizedPath}:`, err.message);
        if (this.logger) {
          this.logger.error('WATCHER', `Failed to sync ${type} delete`, {
            path: normalizedPath,
            nodeId: foundNodeId,
            error: err.message
          });
        }
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
        await this._apiDeleteNode(pending.nodeId);
        await this.repo.delete(pending.nodeId);
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
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await this._apiMoveNode(pending.nodeId, targetParentId);
      } else if (shape === 'rename') {
        console.log(`[SYNC] Watcher: Local ${type} rename detected: ${oldPath} → ${newPath}`);
        await this._apiRenameNode(pending.nodeId, addBasename);
      } else {
        // Atomic move+rename. We issue a single moveNode call with newName so
        // the server can check uniqueness at the target parent against the
        // final name, not the intermediate state. Splitting this into
        // rename-then-move (or move-then-rename) would fail on perfectly valid
        // operations whenever the interim name collides at the source or target.
        console.log(`[SYNC] Watcher: Local ${type} move+rename detected: ${oldPath} → ${newPath}`);
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await this._apiMoveNode(pending.nodeId, targetParentId, addBasename);
      }

      await this.repo.set(pending.nodeId, {
        type,
        path: newPath,
        checksum: pending.entry.checksum,
        inode: newInode
      });
    } catch (err) {
      console.error(`[SYNC] Watcher: Failed to sync ${shape} for ${oldPath}:`, err.message);
    }
  },

  // --- Folder identity (S5-Q2) ---

  async _correlateFolderUnlinkAdd(oldPath, newPath, pending, shape) {
    const plan = this._planFolderRelocate(oldPath, newPath, pending);
    this._cancelDescendantPendingUnlinks(plan);
    this._suppressFolderOpCascade(plan);
    this.repo.setProvisional(plan.pending.nodeId, plan.provisionalEntry);

    const identity = await this._decideFolderIdentity(plan);
    console.log(`[SYNC] Watcher: Folder identity for ${oldPath} → ${newPath}: ${identity.confirmed ? 'CONFIRMED' : 'REJECTED'} (${identity.reason})`);

    if (!identity.confirmed) {
      return this._rejectFolderIdentity(plan, identity);
    }
    return this._commitFolderRelocate(plan, identity, shape);
  },

  /**
   * Gather everything a folder relocate needs: descendants, old/new path
   * pairings, and the provisional entry we'll publish immediately so downstream
   * lookups see the new location.
   */
  _planFolderRelocate(oldPath, newPath, pending) {
    const oldDescendants = this.repo.walkDescendants(oldPath);
    const expectedNewPaths = oldDescendants.map(({ entry }) =>
      newPath + entry.path.substring(oldPath.length)
    );
    const oldDescendantPaths = oldDescendants.map(({ entry }) => entry.path);
    return {
      oldPath,
      newPath,
      pending,
      oldDescendants,
      expectedNewPaths,
      oldDescendantPaths,
      newFullPath: path.join(this.syncFolder, newPath),
      provisionalEntry: {
        type: 'folder',
        path: newPath,
        parentId: pending.entry.parentId,
        inode: null
      }
    };
  },

  /**
   * Any descendant whose unlink already armed a pending-delete timer must be
   * cancelled — its corresponding `add` at the new path will be cascade-
   * suppressed and therefore can't correlate. Without this cancel, each
   * descendant's timer would fire `_apiDeleteNode` against a node we just
   * moved on the server. Defense-in-depth alongside the register-time ancestor
   * check in `_registerPendingUnlink`.
   */
  _cancelDescendantPendingUnlinks(plan) {
    const cancelled = [];
    for (const { entry } of plan.oldDescendants) {
      const pendingEntry = this.pendingUnlinks.get(entry.path);
      if (pendingEntry) {
        clearTimeout(pendingEntry.timerId);
        this.pendingUnlinks.delete(entry.path);
        cancelled.push(entry.path);
      }
    }
    if (cancelled.length > 0 && this.logger) {
      this.logger.info('WATCHER', 'Cancelled pending unlinks for folder-op descendants', {
        oldPath: plan.oldPath,
        newPath: plan.newPath,
        cancelledCount: cancelled.length,
        cancelled
      });
    }
  },

  /**
   * Mark BOTH old and new paths (folder + every descendant) so chokidar events
   * fired as a side-effect of the folder op get silently consumed. Old paths
   * matter because chokidar can deliver descendant unlinks at old paths AFTER
   * this correlation has already cleared the folder's pending-unlink — by then
   * the register-time ancestor-skip in `_registerPendingUnlink` can't catch
   * them. Mirrors `_applyFolderRelocate` (engine-sse.js) for SSE-driven renames.
   */
  _suppressFolderOpCascade(plan) {
    this.cascade.mark([
      plan.newPath,
      plan.oldPath,
      ...plan.expectedNewPaths,
      ...plan.oldDescendantPaths
    ]);
  },

  /**
   * Decide whether the `addDir` at newPath really is the same folder that was
   * just unlinked at oldPath (as opposed to a user happening to create a new
   * folder with the same target name right after deleting the original).
   * Three-way check, in order of confidence:
   *   1. inode-match — strongest signal; same filesystem object.
   *   2. empty-folder — nothing to misattribute, treat as identity.
   *   3. descendant-name-match — wait briefly for the first descendant `add`
   *      at the new path and check its basename against the known set.
   */
  async _decideFolderIdentity(plan) {
    const newInode = await nodeMap.getInode(plan.newFullPath);
    const oldInode = plan.pending.entry.inode;

    if (oldInode && newInode && oldInode === newInode) {
      return { confirmed: true, reason: 'inode-match', newInode };
    }

    const knownDescendantBasenames = new Set(
      plan.oldDescendants.map(({ entry }) => path.basename(entry.path))
    );

    if (knownDescendantBasenames.size === 0) {
      return { confirmed: true, reason: 'empty-folder', newInode };
    }

    try {
      const firstAddBasename = await this._waitForFirstDescendantAdd(
        plan.newPath,
        this.FOLDER_IDENTITY_WAIT_MS
      );
      if (firstAddBasename && knownDescendantBasenames.has(firstAddBasename)) {
        return { confirmed: true, reason: 'descendant-name-match', newInode };
      }
      return {
        confirmed: false,
        reason: firstAddBasename ? 'descendant-mismatch' : 'no-descendant-in-window',
        newInode
      };
    } catch (e) {
      return { confirmed: false, reason: 'identity-wait-error', newInode };
    }
  },

  /**
   * Identity failed — treat the oldPath folder as gone and the newPath as a
   * fresh folder. Delete server copy (which cascades descendants server-side),
   * prune the repo, then re-enter the normal `addDir` handler for newPath.
   */
  async _rejectFolderIdentity(plan, identity) {
    if (this.logger) {
      this.logger.error('WATCHER', 'Folder identity rejected - deleting server copy and all descendants', {
        oldPath: plan.oldPath,
        newPath: plan.newPath,
        reason: identity.reason,
        oldInode: plan.pending.entry.inode,
        newInode: identity.newInode,
        descendantsToDelete: plan.oldDescendants.length,
        descendantPaths: plan.oldDescendants.map(d => d.entry.path)
      });
    }
    try {
      await this._apiDeleteNode(plan.pending.nodeId);
      await this.repo.apply(async (map) => {
        for (const { nodeId: descId } of plan.oldDescendants) {
          map.delete(descId);
        }
        map.delete(plan.pending.nodeId);
      });
    } catch (err) {
      console.error(`[SYNC] Watcher: Failed to sync folder delete for ${plan.oldPath}:`, err.message);
    }
    this._handleFolderAdd(plan.newPath);
  },

  /**
   * Identity confirmed — issue the matching server API call (rename / move /
   * move+rename) and persist the new paths for the folder and every descendant
   * into the repo in a single batch. Named `_commit` (not `_apply`) to avoid
   * colliding with engine-sse.js's existing `_applyFolderRelocate`.
   */
  async _commitFolderRelocate(plan, identity, shape) {
    const addBasename = path.basename(plan.newPath);
    const newDirname = path.dirname(plan.newPath);
    const newFolderPath = newDirname === '.' ? '' : newDirname;

    try {
      if (shape === 'move') {
        console.log(`[SYNC] Watcher: Local folder move detected: ${plan.oldPath} → ${plan.newPath}`);
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await this._apiMoveNode(plan.pending.nodeId, targetParentId);
      } else if (shape === 'rename') {
        console.log(`[SYNC] Watcher: Local folder rename detected: ${plan.oldPath} → ${plan.newPath}`);
        await this._apiRenameNode(plan.pending.nodeId, addBasename);
      } else {
        // Atomic move+rename — see _correlateFileUnlinkAdd for rationale.
        console.log(`[SYNC] Watcher: Local folder move+rename detected: ${plan.oldPath} → ${plan.newPath}`);
        const targetParentId = this.resolveParentIdByPath(newFolderPath);
        await this._apiMoveNode(plan.pending.nodeId, targetParentId, addBasename);
      }

      await this.repo.apply(async (map) => {
        for (const { nodeId: descId, entry } of plan.oldDescendants) {
          const newEntryPath = plan.newPath + entry.path.substring(plan.oldPath.length);
          map.set(descId, { ...entry, path: newEntryPath });
        }
        map.set(String(plan.pending.nodeId), {
          type: 'folder',
          path: plan.newPath,
          parentId: plan.pending.entry.parentId,
          inode: identity.newInode
        });
      });
    } catch (err) {
      console.error(`[SYNC] Watcher: Failed to sync folder ${shape} for ${plan.oldPath}:`, err.message);
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

    // Walk repo once for both checksum comparison AND nodeId resolution
    let storedChecksum = null;
    let foundNodeId = null;
    for (const [nid, entry] of this.repo) {
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
    const recentSseSave = foundNodeId && this.echoWindow.isRecent('site', foundNodeId);
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
      for (const [, entry] of this.repo) {
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
    this.queueSync('addDir', normalizedPath);
  }
};

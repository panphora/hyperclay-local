/**
 * Initial sync flow — runs once on boot to catch up with the server.
 *
 * Compares the server's view of nodes against the local disk and nodeMap,
 * downloads/uploads as needed, and detects structural changes (move, rename,
 * delete) that happened while offline. Methods here are installed onto
 * SyncEngine.prototype.
 *
 * C3: path correlation (which node a path belongs to) stays where it was. Once
 * the node is known, the content decision is `decide`'s (reconcile/decide.js)
 * and the write is `executeDecision`'s (reconcile/execute.js) — nothing here
 * chooses content by mtime any more.
 */

const path = require('upath');
const { classifyError, formatErrorForLog } = require('./error-handler');
const {
  getLocalFiles,
  getLocalFolders,
  readFile,
  fileExists,
  moveFile,
  getLocalUploads,
  readFileBuffer,
  calculateBufferChecksum,
  getFileStats
} = require('./file-operations');
const { calculateChecksum, calculateFileChecksum } = require('./utils');
const { ERROR_PRIORITY } = require('./constants');
const { decide, decideFolder, A } = require('./reconcile/decide');
const { ancestorPaths } = require('./path-helpers');
const { executeDecision } = require('./reconcile/execute');
const { classifyError: classifySyncError } = require('./reconcile/classify-error');
const nodeMap = require('./node-map');

const SITE_PATTERN = /\.(html|htmlclay)$/i;

// The failure kinds that belong to the session rather than to the file they hit.
const SESSION_KINDS = new Set(['pause-all', 'pause', 'rediscover', 'offline', 'backoff']);

// The order one pass executes in (C3 §5.5): folders created, content, local
// trashes, remote deletes, folders deleted. The folder pass runs its own plan
// first (reconcileAll), then the site and upload passes run theirs.
const CONTENT_RANK = 2;
const RANK_BY_ACTION = Object.freeze({
  [A.UPLOAD]: CONTENT_RANK,
  [A.DOWNLOAD]: CONTENT_RANK,
  [A.ADOPT]: CONTENT_RANK,
  [A.CONFLICT]: CONTENT_RANK,
  [A.NOOP]: CONTENT_RANK,
  [A.DEFER]: CONTENT_RANK,
  [A.TRASH_LOCAL]: 3,
  [A.DELETE_REMOTE]: 4,
  [A.FORGET]: 5
});

function rankOf(item) {
  const action = item.decision.action;
  if (action === A.CREATE_REMOTE) return item.type === 'folder' ? 0 : 1;
  if (action === A.FORGET) return item.type === 'folder' ? 6 : 5;
  return RANK_BY_ACTION[action] ?? 5;
}

function relPathOf(node) {
  return node.path ? `${node.path}/${node.name}` : node.name;
}

function dirOf(rel) {
  const dir = path.dirname(rel);
  return dir === '.' ? '' : dir;
}

function typeFor(entry, rel) {
  if (entry && entry.type) return entry.type;
  return SITE_PATTERN.test(rel) ? 'site' : 'upload';
}

module.exports = {
  /**
   * The remote view decide reads for a listed node: the etag (the server's etag
   * and its checksum are the same digest) plus the structural fields the
   * executor needs for a node the baseline does not know yet.
   */
  remoteViewOf(node) {
    return {
      id: node.id,
      etag: node.etag ?? node.checksum ?? null,
      path: relPathOf(node),
      type: node.type,
      parentId: node.parentId ?? null,
      structureVersion: node.structureVersion ?? null
    };
  },

  /**
   * The inventory is evidence only about what it lists. A legacy (protocol 1)
   * list has no `complete` field, so decide turns every node it omits into
   * `defer` and an unproven list can never trash a local file. A node with no
   * baseline and no remote entry has nothing a delete could protect: it is a
   * new local file, and deciding it as `complete` is what lets it be created
   * instead of deferred on every pass.
   */
  completeForNode(remote, baseline) {
    if (this.serverNodesComplete === true) return true;
    if (remote) return false;
    return !(baseline && baseline.localChecksum);
  },

  /** The bytes decide compares against the baseline. */
  async localView(rel) {
    return { checksum: await calculateFileChecksum(path.join(this.syncFolder, rel)) };
  },

  /**
   * Build `{ baseline, local, remote, complete }` for one node, call `decide`,
   * and return the item the pass executes: the decision plus the context the
   * executor needs when the baseline has no entry for the node.
   */
  async decideNode({ nodeId, rel, entry, remote, localPresent, complete, type }) {
    const nodeType = type || (remote && remote.type) || typeFor(entry, rel);
    const baseline = nodeId === null || nodeId === undefined ? null : this.repo.getBaseline(nodeId);
    const key = nodeId === null || nodeId === undefined ? null : String(nodeId);
    const decision = key && this.pathUnresolved && this.pathUnresolved.has(key) ? { action: A.DEFER } : decide({
      baseline,
      local: localPresent ? await this.localView(rel) : null,
      remote: remote ? { etag: remote.etag } : null,
      complete: complete === undefined ? this.completeForNode(remote, baseline) : complete,
      // A bootstrap pass (a legacy import, a lost map) must not delete on the
      // server: a node the local disk lost is downloaded instead. Nor may a pass
      // delete anything under a folder it is restoring.
      bootstrap: this.bootstrapPass === true || this.isUnderRestoredFolder(rel) ||
        (key !== null && this.movedRemotely && this.movedRemotely.has(key))
    });

    return {
      nodeId: nodeId === undefined ? null : nodeId,
      type: nodeType,
      path: rel,
      decision,
      context: {
        path: rel,
        type: nodeType,
        parentId: remote && remote.parentId !== null && remote.parentId !== undefined
          ? remote.parentId
          : entry && entry.parentId !== undefined ? entry.parentId : undefined,
        etag: remote ? remote.etag : undefined,
        structureVersion: remote ? remote.structureVersion : undefined
      }
    };
  },

  /**
   * Execute one pass's decisions in the fixed order. A failure is logged with
   * the classifier's kind and the pass moves on with the next node: pausing,
   * backoff and conflict records after a refusal belong to the session state
   * machine (C3.6), not to the pass.
   */
  async runPlan(plan) {
    const pass = { inventory: null, refreshed: new Set() };
    const ordered = [...plan].sort((a, b) => rankOf(a) - rankOf(b));

    for (const item of ordered) {
      // A pause or a restart while the pass runs stops it before the next
      // write; the executor's own generation check stops the one in flight.
      if (this.sessionStale()) return;
      await this.runPlanItem(item, pass);
    }
  },

  async runPlanItem(item, pass, isRetry = false) {
    this.countDecision(item);
    if (item.decision.action === A.NOOP || item.decision.action === A.DEFER) return;

    try {
      if (item.decision.action === A.CREATE_REMOTE) await this.createMissingParentFolders(item.path);
      await executeDecision(this, item.nodeId, item.decision, item.context);
    } catch (error) {
      const { kind } = classifySyncError(error);
      console.error(`[SYNC] ${item.decision.action} failed for ${item.path} (${kind}):`, error.message);
      if (this.logger) {
        this.logger.error('SYNC', 'Reconcile action failed', {
          file: item.path,
          action: item.decision.action,
          kind,
          error: error.message
        });
      }
      this.stats.errors.push(formatErrorForLog(error, { filename: item.path, action: 'reconcile' }));

      // A stale view of that node: re-list once for the whole pass (coalesced)
      // and decide it again. A second refusal for the same node is not retried.
      if (kind === 'refresh-node' && item.type !== 'folder' && !isRetry && !pass.refreshed.has(String(item.nodeId))) {
        pass.refreshed.add(String(item.nodeId));
        const inventory = await this.refreshInventory(pass);
        const again = await this.decideAgain(item, inventory);
        if (again) await this.runPlanItem(again, pass, true);
      }

      // Failures about the session, not the file, end the pass: the runner pauses, backs off or
      // goes offline instead of reporting a pass that silently skipped files.
      if (SESSION_KINDS.has(kind)) throw error;
    }
  },

  /**
   * A local-only file whose folder is not on the server yet needs the folder
   * created first ("folders created" before content). Folder creation stays on
   * the engine's own helper: every executor action carries content.
   */
  async createMissingParentFolders(rel) {
    const parent = dirOf(rel);
    if (!parent || this.repo.getByPath(parent)) return;
    await this.createFolderOnServer(parent);
  },

  /**
   * One re-list per pass, shared by every node that asked for one (coalesced).
   * The cache is dropped first: a list written in the same millisecond still
   * answers a maxAge of 0 from the cache that just went stale.
   */
  async refreshInventory(pass) {
    if (!pass.inventory) {
      this.invalidateServerNodesCache();
      pass.inventory = this.fetchAndCacheServerNodes(0);
    }
    return pass.inventory;
  },

  /** Decide a node again from the fresh inventory after a `refresh-node`. */
  async decideAgain(item, inventory) {
    const node = (inventory || []).find(n => String(n.id) === String(item.nodeId));
    if (!node) return null;
    const remote = this.remoteViewOf(node);
    return this.decideNode({
      nodeId: item.nodeId,
      rel: remote.path,
      entry: this.repo.get(item.nodeId) || null,
      remote,
      localPresent: await fileExists(path.join(this.syncFolder, remote.path)),
      type: item.type
    });
  },

  /**
   * Keep the counters the popover reads meaningful in decide's vocabulary: a
   * node already identical on both sides is a skip, and a conflict is counted
   * by the emit the executor already makes.
   */
  countDecision(item) {
    if (item.type === 'folder') return;
    const upload = item.type === 'upload';
    switch (item.decision.action) {
      case A.DOWNLOAD:
        if (upload) this.stats.uploadsDownloaded++; else this.stats.filesDownloaded++;
        break;
      case A.UPLOAD:
      case A.CREATE_REMOTE:
        if (upload) this.stats.uploadsUploaded++; else this.stats.filesUploaded++;
        break;
      case A.ADOPT:
      case A.NOOP:
        if (upload) this.stats.uploadsSkipped++; else this.stats.filesDownloadedSkipped++;
        break;
      default:
        break;
    }
  },

  /**
   * Perform initial sync: correlate every listed site to its node, decide each
   * one from the baseline, the disk and the inventory, then execute in the
   * fixed order. A local edit made offline is uploaded, never overwritten.
   */
  async performInitialSync() {
    const gen = this.generation;

    console.log('[SYNC] Starting initial sync...');
    this.emit('sync-start', { type: 'initial' });

    try {
      // Fetch and cache server files — also warms serverNodesCache so a decision
      // can read a node's etag without a separate lookup.
      const serverFiles = await this.fetchAndCacheServerFiles(30_000);
      if (gen !== this.generation) return;
      const allServerNodes = this.serverNodesCache;

      const localFiles = await getLocalFiles(this.syncFolder, this.logger);

      // Snapshot the nodeIds we already knew about BEFORE anything is applied,
      // so a node this pass created or downloaded never reads as a local delete
      // later in the same pass.
      const knownNodeIdsAtStart = new Set([...this.repo].map(([nid]) => nid));

      // Correlation only: which node a path belongs to. Server-side moves first,
      // then the inode/checksum strategies that recognise an offline rename.
      await this.repo.apply(async (map) => {
        for (const serverFile of serverFiles) {
          await this.correlateServerFile(serverFile, localFiles, map);
        }
      });

      const plan = [];
      let handled = new Set();
      if (this.lastSyncedAt) {
        handled = await this.detectLocalChanges(allServerNodes, localFiles, knownNodeIdsAtStart, plan);
      }

      // Every listed site, decided against the baseline and the disk.
      const listed = new Set();
      const listedPaths = new Set();
      for (const node of allServerNodes) {
        if (node.type !== 'site') continue;
        const nid = String(node.id);
        listed.add(nid);
        const remote = this.remoteViewOf(node);
        listedPaths.add(remote.path);
        if (handled.has(nid)) continue;

        plan.push(await this.decideNode({
          nodeId: nid,
          rel: remote.path,
          entry: this.repo.get(nid) || null,
          remote,
          localPresent: localFiles.has(remote.path)
        }));
      }

      // Every tracked node the inventory omitted: a file the server deleted
      // while we were offline, or a folder to forget (never to trash).
      if (this.lastSyncedAt) {
        for (const [nid, entry] of [...this.repo]) {
          if (listed.has(nid) || !entry.path) continue;

          if (typeFor(entry, entry.path) !== 'site') continue; // the upload pass owns uploads, the folder pass owns folders

          plan.push(await this.decideNode({
            nodeId: nid,
            rel: entry.path,
            entry,
            remote: null,
            localPresent: localFiles.has(entry.path)
          }));
        }
      }

      // Files on disk with no node id: a brand-new local file the inventory
      // could not have named, so it is decided against a complete view.
      for (const [rel] of localFiles) {
        if (listedPaths.has(rel) || this.repo.getByPath(rel)) continue;
        plan.push(await this.decideNode({
          nodeId: null,
          rel,
          entry: null,
          remote: null,
          localPresent: true,
          complete: true
        }));
      }

      await this.runPlan(plan);

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
   * Correlation for one listed file: a node whose baseline path is elsewhere on
   * disk is moved to the path the server reports and re-pointed there, so the
   * decision below reads the right path and the baseline keeps its checksums. A
   * node whose file is missing entirely is left to detectLocalChanges (inode
   * and checksum strategies) with the server's path as the expected one.
   */
  async correlateServerFile(serverFile, localFiles, map) {
    const relativePath = serverFile.path || serverFile.filename;
    this.resolveContainedPath(relativePath);
    if (!serverFile.nodeId) return;

    const nid = String(serverFile.nodeId);
    // Its folder's move failed this pass: the file stays where it is until the folder moves.
    if (this.pathUnresolved && this.pathUnresolved.has(nid)) return;
    const entry = map.get(nid);
    if (!entry || entry.path === relativePath) return;

    const knownPath = entry.path;
    // A teammate moved a node this disk no longer has at its old path: restore, never delete.
    if (!localFiles.has(knownPath)) (this.movedRemotely ||= new Set()).add(nid);
    if (localFiles.has(knownPath)) {
      const oldFullPath = path.join(this.syncFolder, knownPath);
      const newFullPath = path.join(this.syncFolder, relativePath);
      try {
        this.live.markBrowserSave(relativePath);
        if (localFiles.has(relativePath)) {
          const aside = await this._moveOccupantAside(relativePath);
          if (aside) {
            localFiles.set(aside, localFiles.get(relativePath));
            localFiles.delete(relativePath);
          }
        }
        await moveFile(oldFullPath, newFullPath);

        const localInfo = localFiles.get(knownPath);
        localFiles.delete(knownPath);
        localFiles.set(relativePath, localInfo);

        console.log(`[SYNC] MOVED ${knownPath} → ${relativePath} (nodeId ${nid})`);

        if (this.logger) {
          this.logger.info('SYNC', 'Moved file to match server path', {
            from: knownPath,
            to: relativePath
          });
        }
      } catch (error) {
        console.error(`[SYNC] Failed to move ${knownPath} → ${relativePath}:`, error.message);
        (this.movedRemotely ||= new Set()).add(nid);
      }
    }

    map.set(nid, { ...entry, path: relativePath });
  },

  /**
   * Detect local structural changes (delete/move/rename) that happened while
   * offline, correlate each one to its node, then decide what is left: a node
   * whose bytes are gone from disk is deleted remotely, or re-downloaded when a
   * teammate edited it after the local delete.
   *
   * performInitialSync passes a `plan` to fill and executes it afterwards;
   * called on its own it runs what it decided.
   */
  async detectLocalChanges(allServerNodes, localFiles, knownNodeIdsAtStart, plan = null) {
    const items = [];
    const correlated = new Set();
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
      if (!serverSiteIds.has(nid)) continue;
      if (knownNodeIdsAtStart && !knownNodeIdsAtStart.has(nid)) continue;

      const serverNode = serverNodeById.get(nid);
      const serverPath = relPathOf(serverNode);

      // Only run local change detection for nodeIds where the server hasn't changed the path
      // (server wins for move/rename conflicts); correlation has already repointed those.
      if (serverPath !== entry.path || (this.movedRemotely && this.movedRemotely.has(nid))) continue;
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
            const content = await readFile(path.join(this.syncFolder, localFile)).catch(() => null);
            const cs = content ? await calculateChecksum(content) : entry.checksum;
            return { path: localFile, checksum: cs, inode: localInode, syncedAt: Date.now() };
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
      if (handled) {
        correlated.add(nid);
        continue;
      }

      // No match: the bytes are gone from disk. decide says whether that is a
      // delete (the remote is unchanged since the baseline) or a restore (a
      // teammate edited the node after the local delete).
      items.push(await this.decideNode({
        nodeId: nid,
        rel: serverPath,
        entry,
        remote: this.remoteViewOf(serverNode),
        localPresent: false
      }));
    }
    }); // end repo.apply

    if (plan) {
      plan.push(...items);
    } else {
      await this.runPlan(items);
    }
    return new Set([...correlated, ...items.map(item => String(item.nodeId))]);
  },

  /**
   * Detect local structural changes (delete/move/rename) for uploads that
   * happened while offline, then decide the rest the same way as sites.
   */
  async detectLocalUploadChanges(allServerNodes, localUploads, knownNodeIdsAtStart, plan = null) {
    const items = [];
    const correlated = new Set();
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
        if (knownNodeIdsAtStart && !knownNodeIdsAtStart.has(nid)) continue; // created this pass — not a local-delete candidate

        const serverNode = serverNodeById.get(nid);
        const serverPath = relPathOf(serverNode);

        if (serverPath !== entry.path || (this.movedRemotely && this.movedRemotely.has(nid))) continue; // server changed path — server wins
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
              const buf = await readFileBuffer(path.join(this.syncFolder, localFile)).catch(() => null);
              const cs = buf ? calculateBufferChecksum(buf) : entry.checksum;
              return { type: 'upload', path: localFile, checksum: cs, inode: localInode, syncedAt: Date.now() };
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
        if (handled) {
          correlated.add(nid);
          continue;
        }

        // The upload is gone locally: decide between deleting it and restoring a
        // teammate's later edit instead of reading the remote's mtime.
        items.push(await this.decideNode({
          nodeId: nid,
          rel: serverPath,
          entry,
          remote: this.remoteViewOf(serverNode),
          localPresent: false,
          type: 'upload'
        }));
      }
    });

    if (plan) {
      plan.push(...items);
    } else {
      await this.runPlan(items);
    }
    return new Set([...correlated, ...items.map(item => String(item.nodeId))]);
  },

  /**
   * Perform initial sync for uploads: the same pass as sites, over the upload
   * nodes and the upload scan of the disk.
   */
  async performInitialUploadSync() {
    console.log('[SYNC] Starting initial upload sync...');
    this.emit('sync-start', { type: 'initial-uploads' });

    try {
      const serverUploads = await this.fetchAndCacheServerUploads(30_000);
      const allServerNodes = this.serverNodesCache;
      const localUploads = await getLocalUploads(this.syncFolder, this.logger);

      const knownNodeIdsAtStart = new Set([...this.repo].map(([nid]) => nid));

      // The same correlation the site pass runs: an upload the server moved or
      // renamed is moved on disk to the server's path before it is decided.
      await this.repo.apply(async (map) => {
        for (const serverUpload of serverUploads) {
          await this.correlateServerFile(serverUpload, localUploads, map);
        }
      });

      const plan = [];
      const handled = this.lastSyncedAt
        ? await this.detectLocalUploadChanges(allServerNodes, localUploads, knownNodeIdsAtStart, plan)
        : new Set();

      const listed = new Set();
      const listedPaths = new Set();
      for (const node of allServerNodes) {
        if (node.type !== 'upload') continue;
        const nid = String(node.id);
        listed.add(nid);
        const remote = this.remoteViewOf(node);
        listedPaths.add(remote.path);
        if (handled.has(nid)) continue;

        plan.push(await this.decideNode({
          nodeId: nid,
          rel: remote.path,
          entry: this.repo.get(nid) || null,
          remote,
          localPresent: localUploads.has(remote.path),
          type: 'upload'
        }));
      }

      if (this.lastSyncedAt) {
        for (const [nid, entry] of [...this.repo]) {
          if (listed.has(nid) || !entry.path) continue;
          if (typeFor(entry, entry.path) !== 'upload') continue; // the site pass owns the rest

          plan.push(await this.decideNode({
            nodeId: nid,
            rel: entry.path,
            entry,
            remote: null,
            localPresent: localUploads.has(entry.path),
            type: 'upload'
          }));
        }
      }

      // Uploads on disk with no node id: new local files to create remotely.
      for (const [rel] of localUploads) {
        if (listedPaths.has(rel) || this.repo.getByPath(rel)) continue;
        plan.push(await this.decideNode({
          nodeId: null,
          rel,
          entry: null,
          remote: null,
          localPresent: true,
          complete: true,
          type: 'upload'
        }));
      }

      await this.runPlan(plan);

      console.log('[SYNC] Initial upload sync complete');
      this.emit('sync-complete', { type: 'initial-uploads', stats: this.stats });

    } catch (error) {
      console.error('[SYNC] Initial upload sync failed:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'initial-upload-sync' }));
      // A failure about the session (auth, server down, offline) ends the pass like the
      // site pass does; anything else is logged and the session carries on.
      if (SESSION_KINDS.has(classifySyncError(error).kind)) throw error;
    }
  },

  /**
   * The folder pass: every tracked folder and every listed folder is decided
   * from `{ tracked, local, remote, complete }` (decideFolder) and executed
   * through the one executor in the fixed order. The disk is scanned before
   * anything is written to it, so a folder the user deleted while offline reads
   * as absent instead of being recreated first. A path the watcher is still
   * deciding (a pending unlink in its grace period) is the watcher's: it is
   * neither recreated nor deleted here.
   */
  async performInitialFolderSync(inventory = null) {
    console.log('[SYNC] Starting initial folder sync...');
    this.restoredFolders = [];
    this.movedRemotely = new Set();
    this.pathUnresolved = new Set();
    this.assertRootPresent();

    const allServerNodes = inventory || await this.fetchAndCacheServerNodes(0);
    const complete = this.serverNodesComplete === true || (Array.isArray(allServerNodes) && allServerNodes.complete === true);
    const listed = new Map();
    for (const node of allServerNodes) {
      if (node.type === 'folder') listed.set(String(node.id), node);
    }

    const localFolders = await getLocalFolders(this.syncFolder, this.logger);
    const firstPass = !this.lastSyncedAt;
    const bootstrap = this.bootstrapPass === true;
    const plan = [];
    const deleting = [];
    const restoring = [];
    const relocated = [];

    // Parents first, so a cascade delete covers its subtree and a child under a
    // folder already planned for delete is not sent on its own.
    const tracked = [...this.repo]
      .filter(([, entry]) => entry.type === 'folder' && entry.path)
      .sort(([, a], [, b]) => a.path.length - b.path.length);

    const localOnly = new Set();
    for (const [rel] of localFolders) {
      if (!this.repo.getByPath(rel)) localOnly.add(rel);
    }

    await this.repo.apply(async (map) => {
      for (const [nid, snapshot] of tracked) {
        // A folder under one relocated this pass already moved with it (or waits for the next pass).
        if (relocated.some((parent) => snapshot.path.startsWith(parent + '/'))) continue;
        // A parent the server moved was relocated above: read the path it has now.
        const entry = map.get(nid) || snapshot;
        if (this.hasPendingUnlink(entry.path)) continue;
        const node = listed.get(nid);

        if (!node) {
          plan.push(this.folderItem(nid, entry.path,
            decideFolder({ tracked: true, local: localFolders.has(entry.path), remote: false, complete }),
            { parentId: entry.parentId }));
          continue;
        }

        // Moved on the server: the directory moves with everything in it and every
        // descendant is repointed, the way a live frame applies it (applyRemotePath).
        // A directory this disk no longer has is restored at the server's path with its subtree.
        const remotePath = relPathOf(node);
        if (remotePath !== entry.path) {
          const missing = (await this.localDirState(entry.path)) === 'absent' && (await this.localDirState(remotePath)) === 'absent';
          try {
            await this.applyRemotePath(nid, entry, this.remoteViewOf(node), true);
          } catch (error) {
            console.error(`[SYNC] Failed to follow the server's folder move ${entry.path} → ${remotePath}:`, error.message);
            for (const { nodeId: descId } of this.repo.walkDescendants(entry.path)) this.pathUnresolved.add(String(descId));
            relocated.push(entry.path);
            continue;
          }
          if (missing) {
            restoring.push(remotePath);
            plan.push(this.folderItem(nid, remotePath, { action: A.DOWNLOAD }, { parentId: node.parentId }));
          }
          continue;
        }

        if (localFolders.has(entry.path)) {
          const inode = await nodeMap.getInode(path.join(this.syncFolder, entry.path));
          map.set(nid, { ...entry, parentId: node.parentId, inode });
          continue;
        }

        // Missing from the scan: only an ENOENT proves the directory is gone.
        if ((await this.localDirState(entry.path)) !== 'absent') continue;
        if (await this.relocateFolderByInode(nid, entry, localOnly, map)) {
          relocated.push(entry.path);
          continue;
        }
        if (deleting.some((parent) => entry.path.startsWith(parent + '/'))) continue;

        // A folder under one being restored comes back with it: when in doubt, keep the data.
        const underRestore = restoring.some((parent) => entry.path.startsWith(parent + '/'));
        const decision = decideFolder({
          tracked: true,
          local: false,
          remote: true,
          complete,
          bootstrap,
          firstPass,
          remoteChanged: underRestore || this.folderSubtreeChangedRemotely(entry.path, allServerNodes)
        });
        if (decision.action === A.DELETE_REMOTE) deleting.push(entry.path);
        if (decision.action === A.DOWNLOAD) restoring.push(entry.path);
        plan.push(this.folderItem(nid, entry.path, decision, { parentId: node.parentId, structureVersion: node.structureVersion }));
      }

      // Listed folders the baseline does not know: created locally and tracked.
      for (const [nid, node] of listed) {
        if (map.has(nid)) continue;
        const rel = relPathOf(node);
        // Under a folder renamed on the server this pass: the inventory still names the old path.
        if (relocated.some((parent) => rel.startsWith(parent + '/'))) continue;
        if (this.hasPendingUnlink(rel)) continue;
        plan.push(this.folderItem(nid, rel,
          decideFolder({ tracked: false, local: localFolders.has(rel), remote: true, complete }),
          { parentId: node.parentId }));
      }
    });

    this.restoredFolders = restoring;
    await this.runPlan(plan);
    console.log('[SYNC] Initial folder sync complete');
  },

  folderItem(nodeId, rel, decision, { parentId, structureVersion } = {}) {
    return {
      nodeId,
      type: 'folder',
      path: rel,
      decision,
      context: { path: rel, type: 'folder', parentId, structureVersion }
    };
  },

  /** The watcher is still deciding this path (or a folder above it): its delete is the watcher's to send. */
  hasPendingUnlink(rel) {
    if (!this.pendingUnlinks || this.pendingUnlinks.size === 0) return false;
    if (this.pendingUnlinks.has(rel)) return true;
    return ancestorPaths(rel).some((ancestor) => this.pendingUnlinks.has(ancestor));
  },

  /** A path under a folder this reconcile restores: its files come back instead of being deleted. */
  isUnderRestoredFolder(rel) {
    return (this.restoredFolders || []).some((folder) => rel.startsWith(folder + '/'));
  },

  /**
   * 'present', 'absent' (ENOENT) or 'unknown'. A folder missing from the scan
   * because a parent could not be read is never deleted on that evidence.
   */
  async localDirState(rel) {
    try {
      const stats = await getFileStats(path.join(this.syncFolder, rel));
      if (typeof stats.isDirectory === 'function' && !stats.isDirectory()) return 'absent';
      return 'present';
    } catch (error) {
      return error && error.code === 'ENOENT' ? 'absent' : 'unknown';
    }
  },

  /**
   * Did anything under this folder change on the server since the baseline?
   * A listed descendant the map does not know, one listed at a path other than
   * its baseline path, or a file whose etag differs from its baseline (or has
   * none) all count. The answer turns a local folder delete into a restore, so
   * a teammate's work is never cascaded away.
   */
  folderSubtreeChangedRemotely(folderPath, nodes) {
    const prefix = folderPath + '/';
    for (const node of nodes) {
      const rel = relPathOf(node);
      if (!rel.startsWith(prefix)) continue;
      const entry = this.repo.get(node.id);
      if (!entry || entry.path !== rel) return true;
      if (node.type === 'folder') continue;
      const baseline = this.repo.getBaseline(node.id);
      const etag = node.etag ?? node.checksum ?? null;
      if (!baseline || !baseline.remoteEtag || baseline.remoteEtag !== etag) return true;
    }
    return false;
  },

  /**
   * A tracked folder gone from its path whose inode is now at a local-only
   * path was renamed or moved while offline: send that and repoint the folder
   * and its descendants. Returns true when the folder was matched, whether or
   * not the send succeeded: a failed rename leaves the folder to the next pass
   * and never falls through to a delete. With no inode to match (a filesystem
   * without stable ones, or none recorded) the folder is recognised by its
   * content instead — the one local-only folder holding its files unchanged.
   */
  async relocateFolderByInode(nid, entry, localOnly, map) {
    if (entry.inode) {
      for (const localFolder of localOnly) {
        const localInode = await nodeMap.getInode(path.join(this.syncFolder, localFolder));
        if (localInode && localInode === entry.inode) {
          return this.relocateFolderTo(nid, entry, localFolder, localInode, localOnly, map);
        }
      }
    }
    // No inode match (a filesystem without stable inodes, or none recorded): the one
    // local-only folder holding this folder's files, unchanged, is the same folder.
    const byContent = await this.folderMatchingContent(entry.path, localOnly);
    if (!byContent) return false;
    const inode = await nodeMap.getInode(path.join(this.syncFolder, byContent));
    return this.relocateFolderTo(nid, entry, byContent, inode, localOnly, map);
  },

  /**
   * The local-only folder that holds this folder's tracked files at the same relative
   * paths with their baseline checksums. At least one file must match, and only a
   * single candidate counts: two lookalikes are no evidence.
   */
  async folderMatchingContent(folderPath, localOnly) {
    const files = [];
    for (const { nodeId, entry } of this.repo.walkDescendants(folderPath)) {
      if (entry.type === 'folder') continue;
      const baseline = this.repo.getBaseline(nodeId);
      if (!baseline || !baseline.localChecksum) continue;
      files.push({ rel: entry.path.slice(folderPath.length + 1), checksum: baseline.localChecksum });
    }
    if (files.length === 0) return null;

    const matches = [];
    for (const candidate of localOnly) {
      for (const file of files) {
        const rel = `${candidate}/${file.rel}`;
        if (!fileExists(path.join(this.syncFolder, rel))) continue;
        const { checksum } = await this.localView(rel);
        if (checksum === file.checksum) {
          matches.push(candidate);
          break;
        }
      }
    }
    return matches.length === 1 ? matches[0] : null;
  },

  async relocateFolderTo(nid, entry, localFolder, localInode, localOnly, map) {
    const oldBasename = path.basename(entry.path);
    const newBasename = path.basename(localFolder);
    const normalizeDir = d => (d === '.' ? '' : d);
    const oldDirname = normalizeDir(path.dirname(entry.path));
    const newDirname = normalizeDir(path.dirname(localFolder));
    const isRename = newBasename !== oldBasename && newDirname === oldDirname;
    const isMove = newBasename === oldBasename && newDirname !== oldDirname;
    const shape = isRename ? 'rename' : isMove ? 'move' : 'move+rename';

    try {
      console.log(`[SYNC] Local folder ${shape} detected: ${entry.path} → ${localFolder} (nodeId ${nid})`);
      // A folder moved into a new local folder needs that folder on the server first.
      if (shape !== 'rename' && newDirname && !this.repo.getByPath(newDirname)) {
        await this.createFolderOnServer(newDirname);
      }
      if (shape === 'rename') {
        await this._apiRenameNode(nid, newBasename);
      } else if (shape === 'move') {
        await this._apiMoveNode(nid, this.resolveParentIdByPath(newDirname));
      } else {
        await this._apiMoveNode(nid, this.resolveParentIdByPath(newDirname), newBasename);
      }

      const descendants = this.repo.walkDescendants(entry.path);
      for (const { nodeId: descId, entry: descEntry } of descendants) {
        map.set(descId, { ...descEntry, path: localFolder + descEntry.path.slice(entry.path.length) });
      }
      map.set(nid, { type: 'folder', path: localFolder, parentId: entry.parentId, inode: localInode });
      localOnly.delete(localFolder);
      if (this.logger) {
        this.logger.info('SYNC', `Folder ${shape} synced to server`, {
          from: entry.path, to: localFolder, nodeId: nid, descendantsUpdated: descendants.length
        });
      }
    } catch (err) {
      console.error(`[SYNC] Failed to sync local folder ${shape} for nodeId ${nid}:`, err.message);
      if (this.logger) {
        this.logger.error('SYNC', `Failed to sync offline folder ${shape}`, {
          from: entry.path, to: localFolder, nodeId: nid, error: err.message
        });
      }
      this.stats.errors.push(formatErrorForLog(err, { filename: entry.path, action: 'reconcile' }));
      if (SESSION_KINDS.has(classifySyncError(err).kind)) throw err;
    }
    return true;
  }
};

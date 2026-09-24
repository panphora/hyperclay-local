/**
 * Session-level reconcile entry points (C3 §5.6, §9).
 *
 * The session's state machine (reconcile/session-runner.js) drives the engine
 * through these: one full reconcile per generation, one node re-read per live
 * stream invalidation, and the pending work dropped when a generation ends.
 * Everything here is fenced by the generation the runner passed in and by the
 * signal it aborted on pause, restart or stop, so a stale continuation writes
 * nothing. Methods here are installed onto SyncEngine.prototype.
 */

const path = require('upath');
const { fileExists } = require('./file-operations');
const { decidePath } = require('./reconcile/decide');

module.exports = {
  /**
   * Reconcile the whole disk against one inventory the session already listed
   * (`complete: true`, or a legacy list that proves nothing). The inventory is
   * handed to the three passes as their cache, so they never list again.
   *
   * @param {Array} inventory the session's list, `complete` on the array or on
   *   the envelope the api returned
   * @param {{generation?:number, signal?:AbortSignal, bootstrap?:boolean}} [work]
   */
  async reconcileAll(inventory, { generation, signal, bootstrap = false } = {}) {
    if (signal && signal.aborted) return;
    const nodes = Array.isArray(inventory) ? inventory : ((inventory && inventory.nodes) || []);
    const work = this.beginSessionWork(generation, signal);
    this.serverNodesCache = nodes;
    this.serverNodesCacheTime = Date.now();
    this.serverNodesComplete = (inventory && inventory.complete === true) || nodes.complete === true;
    this.serverFilesCache = null;
    this.bootstrapPass = bootstrap === true;

    try {
      await this.performInitialFolderSync(nodes);
      if (this.staleWork(generation, signal, work)) return;
      await this.performInitialSync();
      if (this.staleWork(generation, signal, work)) return;
      await this.performInitialUploadSync();
    } finally {
      this.bootstrapPass = false;
    }
  },

  /**
   * Re-read one node — content, path and structure — from a fresh list and run
   * `decide` for it. This is what a live stream frame triggers: the frame is
   * only an invalidation, never content to apply.
   *
   * @param {number|string} nodeId
   * @param {{generation?:number, signal?:AbortSignal}} [work]
   * @returns {Promise<string|null>} the action, or null when nothing was decided
   */
  async refreshNode(nodeId, { generation, signal } = {}) {
    if (signal && signal.aborted) return null;
    const id = String(nodeId);
    const work = this.beginSessionWork(generation, signal);

    // One list in flight per session: every invalidation of this generation
    // waits for the same fetch instead of listing once per node.
    if (!this.nodeListInFlight) {
      this.nodeListInFlight = this.refreshInventory({ inventory: null, refreshed: new Set() })
        .finally(() => { this.nodeListInFlight = null; });
    }
    const inventory = await this.nodeListInFlight;
    if (this.staleWork(generation, signal, work)) return null;

    const node = (inventory || []).find((n) => String(n.id) === id);
    let entry = this.repo.get(id) || null;
    const remote = node ? this.remoteViewOf(node) : null;
    const isFolder = (remote && remote.type === 'folder') || (entry && entry.type === 'folder');

    if (entry && remote && entry.path && remote.path !== entry.path) {
      await this.applyRemotePath(id, entry, remote, isFolder);
      if (this.staleWork(generation, signal, work)) return null;
      entry = this.repo.get(id) || null;
    }

    // A folder has no content to decide: a new one is created, a deleted one is trashed only
    // on a complete list, and a moved one was relocated above.
    if (isFolder) {
      if (remote && !entry) {
        await this._applyNodeSavedFolder({ nodeId: node.id, nodeType: 'folder', name: node.name, path: remote.path, parentId: node.parentId });
        return 'create-folder';
      }
      if (!remote && entry && this.serverNodesComplete) {
        await this._applyFolderDelete(id, entry.path);
        return 'trash-folder';
      }
      return null;
    }

    const rel = remote ? remote.path : entry && entry.path;
    if (!rel) return null;

    const item = await this.decideNode({
      nodeId: id,
      rel,
      entry,
      remote,
      localPresent: fileExists(path.join(this.syncFolder, rel)),
    });
    if (this.staleWork(generation, signal, work)) return null;

    await this.runPlanItem(item, { inventory, refreshed: new Set() });
    return item.decision.action;
  },

  /**
   * A node whose listed path differs from its baseline path moved on one side. The local file is
   * either still at the baseline path (a teammate moved it: apply the move here) or already at the
   * listed path (adopt it). A local move is the watcher's to send, so it is never undone here.
   */
  async applyRemotePath(id, entry, remote, isFolder) {
    const atBase = fileExists(path.join(this.syncFolder, entry.path));
    const atRemote = fileExists(path.join(this.syncFolder, remote.path));
    const localPath = atBase || !atRemote ? entry.path : remote.path;
    const { action } = decidePath({ basePath: entry.path, localPath, remotePath: remote.path });
    if (action === 'adopt-path') {
      await this.repo.set(id, { ...entry, path: remote.path, parentId: remote.parentId ?? entry.parentId });
      return action;
    }
    if (isFolder) await this._applyFolderRelocate(id, entry.path, remote.path);
    else await this._applyFileRelocate(id, entry.path, remote.path, remote.type || entry.type);
    return action;
  },

  /**
   * Drop everything this session queued: the debounce queue and its retry
   * timers, the pending unlinks and the invalidation work in flight. The
   * generation bump makes every continuation started before this point stale,
   * which is how a pause touches no files.
   */
  dropPendingWork() {
    this.generation += 1;
    this.sessionInvalidated = true;
    this.sessionWork = null;
    this.nodeListInFlight = null;
    this.syncQueue.clear();
    for (const [, { timerId }] of this.pendingUnlinks) clearTimeout(timerId);
    this.pendingUnlinks.clear();
    this.settleQueueWaiters();
  },

  /**
   * Record the generation and signal the session is working under, and return
   * the engine generation this work belongs to: `dropPendingWork` bumps it, so
   * a continuation can tell that its generation ended even without a signal.
   */
  beginSessionWork(generation, signal) {
    if (generation !== undefined && generation !== null) this.sessionGeneration = generation;
    this.sessionWork = { generation, signal };
    this.sessionInvalidated = false;
    return this.generation;
  },

  /**
   * Is the work a caller asked for still current? A pause, restart or stop
   * aborts the signal the runner handed over; `dropPendingWork` bumps the
   * engine generation; a newer session generation makes an older one's
   * reconcile stale. Callers check this after every await, once
   * `beginSessionWork` has recorded their generation.
   */
  staleWork(generation, signal, engineGeneration) {
    if (signal && signal.aborted) return true;
    if (engineGeneration !== undefined && engineGeneration !== this.generation) return true;
    if (generation === undefined || generation === null) return false;
    return generation !== this.sessionGeneration;
  },

  /** The same question for a pass that is already running (runPlan). */
  sessionStale() {
    if (this.sessionInvalidated) return true;
    const work = this.sessionWork;
    return !!(work && work.signal && work.signal.aborted);
  },
};

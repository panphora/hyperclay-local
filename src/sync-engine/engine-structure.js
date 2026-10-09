/**
 * The structure job: marks become one snapshot, one diff against the ledger,
 * and one ordered batch of server operations, all inside the lane.
 * Methods are installed onto SyncEngine.prototype.
 */

const path = require('upath');
const fsSync = require('fs');
const { snapshotDisk } = require('./reconcile/disk-snapshot');
const { diffTree } = require('./reconcile/tree-diff');
const { shouldSkipEntry } = require('./file-operations');
const { restoreNode } = require('./api-client');
const { classifyError, SESSION_KINDS } = require('./reconcile/classify-error');
const { validateFileName, validateFolderName, validateFullPath } = require('./validation');
const { ERROR_PRIORITY } = require('./constants');
const nodeMap = require('./node-map');
const { LOCKED_FOLDER } = require('./locked-folder');

const QUIET_MS = 500;
const CAP_MS = 5000;
const RECENT_DELETE_MS = 7 * 24 * 60 * 60 * 1000;
const OS_JUNK = new Set(['Thumbs.db', 'desktop.ini']);

const isEditorBackup = (segment) => segment.endsWith('~') || (segment.length > 1 && segment.startsWith('#') && segment.endsWith('#'));
const isIgnoredRel = (rel) => rel.split('/').some((segment) => shouldSkipEntry(segment) || OS_JUNK.has(segment) || isEditorBackup(segment));
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const relPathOf = (node) => (node.path ? `${node.path}/${node.name}` : node.name);
const underOrAt = (rel, folder) => rel === folder || rel.startsWith(`${folder}/`);
const underLocked = (rel) => rel.startsWith(`${LOCKED_FOLDER}/`);

module.exports = {
  _structureState() {
    if (!this._structure) {
      this._structure = {
        dirty: new Set(),
        held: new Map(),
        timer: null,
        firstMarkAt: null,
        wakeTimer: null,
        massDelete: null,
        recentDeletes: new Map(),
        yielded: new Set(),
        occupiedNotice: null,
        refused: new Set(),
        refreshDeferred: false
      };
    }
    return this._structure;
  },

  markDirty(rel) {
    const state = this._structureState();
    const now = Date.now();
    state.dirty.add(rel);
    if (state.firstMarkAt === null) state.firstMarkAt = now;
    const delay = Math.max(0, Math.min(QUIET_MS, state.firstMarkAt + CAP_MS - now));
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => this._fireStructureJob(), delay);
  },

  holdsPath(rel) {
    const state = this._structureState();
    const owns = (p) => p === '' || p === rel || rel.startsWith(`${p}/`);
    if (state.yielded.has(rel) || [...state.yielded].some((p) => rel.startsWith(`${p}/`))) return false;
    for (const p of state.dirty) if (owns(p)) return true;
    for (const key of state.held.keys()) {
      if (key.startsWith('missing:') && owns(key.slice('missing:'.length))) return true;
    }
    if (state.massDelete && state.massDelete.paths.some(owns)) return true;
    return false;
  },

  _fireStructureJob() {
    const state = this._structureState();
    state.timer = null;
    state.firstMarkAt = null;
    return this.serial(() => this.runStructureJobInLane()).catch((err) => {
      console.error('[SYNC] Structure job failed:', err.message);
      this.requestReconcile();
    });
  },

  _scheduleStructureWake(wakeAt) {
    const state = this._structureState();
    if (state.wakeTimer) clearTimeout(state.wakeTimer);
    state.wakeTimer = null;
    if (wakeAt === null) return;
    state.wakeTimer = setTimeout(() => {
      state.wakeTimer = null;
      this._fireStructureJob();
    }, Math.max(0, wakeAt - Date.now()));
  },

  clearStructureState({ forgetDeletes = false } = {}) {
    const state = this._structureState();
    if (state.timer) clearTimeout(state.timer);
    if (state.wakeTimer) clearTimeout(state.wakeTimer);
    state.timer = null;
    state.wakeTimer = null;
    state.firstMarkAt = null;
    state.dirty.clear();
    state.held.clear();
    state.massDelete = null;
    state.yielded.clear();
    state.occupiedNotice = null;
    state.refused.clear();
    state.refreshDeferred = false;
    if (forgetDeletes) state.recentDeletes.clear();
  },

  async runStructureJobInLane() {
    const state = this._structureState();
    const gen = this.generation;
    const marked = new Set(state.dirty);
    state.dirty.clear();
    if (!fsSync.existsSync(this.syncFolder)) return;

    const snapshot = await snapshotDisk(this.syncFolder, { ignore: isIgnoredRel });
    if (gen !== this.generation) return;
    if (snapshot.unreadable.has('')) return;

    const { ops, held, wakeAt } = diffTree({
      ledger: new Map([...this.repo.entries()].filter(([, e]) => !e.path || !isIgnoredRel(e.path))),
      disk: snapshot.entries,
      unreadable: snapshot.unreadable,
      mode: 'live',
      held: state.held,
      now: Date.now()
    });
    state.held = held;
    for (const p of [...state.yielded]) {
      if (snapshot.entries.has(p)) state.yielded.delete(p);
    }
    const pending = state.massDelete;
    const owned = (p) => (pending && pending.paths.some((m) => underOrAt(p, m)))
      || [...state.yielded].some((y) => underOrAt(p, y));
    const batch = ops.filter((o) => !((o.op === 'missing' || o.op === 'massDelete') && owned(o.path || (o.paths && o.paths[0]) || '')));
    this._scheduleStructureWake(wakeAt);

    this._structureLive = true;
    try {
      for (const op of batch) {
        if (gen !== this.generation) return;
        const refusal = this._structureNameError(op);
        if (refusal) {
          this._reportStructureRefusal(op, refusal);
          continue;
        }
        let stop;
        try {
          stop = await this._applyStructureOp(op, { marked, snapshot });
        } catch (err) {
          const status = err.statusCode;
          if (SESSION_KINDS.has(classifyError(err).kind) || !(status >= 400 && status < 500)) throw err;
          this._reportStructureRefusal(op, err.message);
          continue;
        }
        if (stop) return;
      }
    } catch (err) {
      console.error('[SYNC] Structure job stopped:', err.message);
      this.requestReconcile();
    } finally {
      this._structureLive = false;
    }

    if (gen !== this.generation) return;
    for (const p of marked) {
      const tracked = this.repo.getByPath(p);
      const disk = snapshot.entries.get(p);
      if (!tracked || !disk || disk.type !== 'file' || tracked.entry.type === 'folder') continue;
      if (tracked.entry.type === 'upload') await this._handleUploadChange(p);
      else await this._handleSiteChange(p);
    }

    if (state.refreshDeferred && state.held.size === 0 && state.dirty.size === 0 && !state.massDelete) {
      state.refreshDeferred = false;
      this.requestReconcile();
    }
  },

  async runStructureCatchupInLane(inventory) {
    const gen = this.generation;
    let relocated = 0;
    if (!fsSync.existsSync(this.syncFolder)) return relocated;
    const snapshot = await snapshotDisk(this.syncFolder, { ignore: isIgnoredRel });
    if (snapshot.unreadable.has('')) return relocated;
    const serverPathById = new Map();
    for (const node of inventory || []) serverPathById.set(String(node.id), relPathOf(node));

    const { ops } = diffTree({
      ledger: new Map([...this.repo.entries()].filter(([, e]) => !e.path || !isIgnoredRel(e.path))),
      disk: snapshot.entries,
      unreadable: snapshot.unreadable,
      mode: 'catchup',
      now: Date.now()
    });

    for (const op of ops) {
      if (gen !== this.generation) return relocated;
      if (op.op === 'restoreLocked' && op.from !== null) {
        await this.restoreLockedFolder(op.from);
        continue;
      }
      if (op.op !== 'relocate') continue;
      const entry = this.repo.get(op.id);
      if (!entry || serverPathById.get(String(op.id)) !== entry.path) continue;
      // The live job already holds one half of this move: it pairs both, so this pass leaves the other half to it too.
      if (this.holdsPath(entry.path) || this.holdsPath(op.to)) {
        this.markDirty(entry.path);
        this.markDirty(op.to);
        continue;
      }
      // Nothing under the root's uploads folder is paired by a catch-up pass: it is restored.
      if (underLocked(entry.path)) continue;
      const from = entry.path;
      try {
        await this._applyRelocate(op);
        relocated += 1;
        for (const [id, p] of serverPathById) {
          if (p === from || p.startsWith(`${from}/`)) serverPathById.set(id, op.to + p.slice(from.length));
        }
      } catch (err) {
        if (SESSION_KINDS.has(classifyError(err).kind)) throw err;
        console.error(`[SYNC] Catch-up relocate ${entry.path} → ${op.to} failed:`, err.message);
        if (this.pathUnresolved) {
          this.pathUnresolved.add(String(op.id));
          for (const { nodeId } of this.repo.walkDescendants(entry.path)) this.pathUnresolved.add(String(nodeId));
        }
      }
    }
    return relocated;
  },

  _structureNameError(op) {
    const target = op.op === 'relocate' ? op.to : op.op === 'new' ? op.path : null;
    if (!target) return null;
    if (op.kind === 'folder') {
      const parts = target.split('/');
      if (parts.length > 5) return 'Folder depth cannot exceed 5 levels. Please reorganize your files into a shallower structure.';
      for (const part of parts) {
        const result = validateFolderName(part);
        if (!result.valid) return `Invalid folder "${part}": ${result.error}`;
      }
      return null;
    }
    const result = target.includes('/') ? validateFullPath(target) : validateFileName(target, false);
    return result.valid ? null : result.error;
  },

  _reportStructureRefusal(op, message) {
    const state = this._structureState();
    const target = op.op === 'relocate' ? op.to : op.path;
    console.error(`[SYNC] Cannot sync ${target}: ${message}`);
    const key = `${op.op}:${target}:${message}`;
    if (state.refused.has(key)) return;
    state.refused.add(key);
    this.emit('sync-error', {
      file: target,
      error: message,
      type: 'validation',
      priority: ERROR_PRIORITY.HIGH,
      action: op.op,
      canRetry: false
    });
  },

  async _applyStructureOp(op, { marked, snapshot }) {
    switch (op.op) {
      case 'restoreLocked':
        if (op.from === null) {
          this.requestReconcile();
          return true;
        }
        if ((await this.restoreLockedFolder(op.from)) === 'occupied') {
          const state = this._structureState();
          if (state.occupiedNotice !== op.from) {
            state.occupiedNotice = op.from;
            this.emit('sync-error', {
              type: 'uploads-occupied',
              priority: 1,
              file: op.from,
              userMessage: `${op.from} holds your attachments, but a different uploads folder is now in its place. Move one of them aside so attachments keep syncing.`
            });
          }
          return false;
        }
        this._structureState().occupiedNotice = null;
        this.markDirty('');
        return true;
      case 'relocate':
        await this._applyRelocate(op);
        return false;
      case 'new':
        await this._applyNew(op, { marked, snapshot });
        return false;
      case 'missing':
        await this._applyMissing(op);
        return false;
      case 'massDelete':
        this._holdMassDelete(op);
        return false;
      default:
        return false;
    }
  },

  async _applyRelocate(op) {
    const entry = this.repo.get(op.id);
    if (!entry) return;
    const from = entry.path;
    // A move into a folder made in the same batch needs that folder on the server first.
    await this.createMissingParentFolders(op.to);
    const parentId = this.resolveParentIdByPath(dirOf(op.to));
    let sent;
    if (op.shape === 'rename') sent = await this._apiRenameNode(op.id, baseOf(op.to));
    else if (op.shape === 'move') sent = await this._apiMoveNode(op.id, parentId);
    else sent = await this._apiMoveNode(op.id, parentId, baseOf(op.to));
    if (sent === false) return;

    const moved = [];
    for (const [id, e] of this.repo.entries()) {
      if (underOrAt(e.path, from)) moved.push([id, e]);
    }
    await this.repo.addTombstones(moved.map(([, e]) => e.path));
    await this.repo.apply(async (map) => {
      for (const [id, e] of moved) {
        const next = { ...e, path: op.to + e.path.slice(from.length) };
        if (String(id) === String(op.id)) next.parentId = parentId;
        map.set(id, next);
      }
    });
  },

  async _applyNew(op, { marked, snapshot }) {
    const state = this._structureState();
    if (this.repo.getByPath(op.path)) return;
    const recent = state.recentDeletes.get(op.path);
    if (recent && underLocked(op.path) && Date.now() - recent.at < RECENT_DELETE_MS && (op.kind === 'folder' || marked.has(op.path))) {
      state.recentDeletes.delete(op.path);
      try {
        await restoreNode(this.conn, parseInt(recent.id));
        this._mutationSeq = (this._mutationSeq || 0) + 1;
        const back = recent.subtree || [[recent.id, recent.entry]];
        await this.repo.apply(async (map) => {
          for (const [id, e] of back) {
            const disk = snapshot.entries.get(e.path);
            map.set(id, { ...e, inode: disk ? disk.inode : null });
            if (e.path !== op.path) state.recentDeletes.delete(e.path);
          }
        });
        if (op.kind === 'folder') {
          this.requestReconcile();
        } else {
          this.queueSync('change', op.path);
        }
        return;
      } catch (err) {
        console.warn(`[SYNC] Restore of node ${recent.id} failed (${err.code || err.message}); creating it as new`);
      }
    }
    if (op.kind === 'folder') {
      await this.createFolderOnServer(op.path);
      return;
    }
    if (marked.has(op.path)) this.queueSync('add', op.path);
  },

  async _remoteChangedSince(id, entry, kind) {
    const nodes = await this.fetchAndCacheServerNodes(0);
    if (!nodes) return true;
    const node = nodes.find((n) => String(n.id) === String(id));
    if (!node) return null;
    if (kind === 'folder') return this.folderSubtreeChangedRemotely(entry.path, nodes);
    const baseline = this.repo.getBaseline(id);
    const etag = node.etag ?? node.checksum ?? null;
    return !baseline || !baseline.remoteEtag || baseline.remoteEtag !== etag;
  },

  async _applyMissing(op) {
    const state = this._structureState();
    if (fsSync.existsSync(path.join(this.syncFolder, op.path))) return;
    const entry = this.repo.get(op.id);
    if (!entry) return;
    const changed = await this._remoteChangedSince(op.id, entry, op.kind);
    if (changed === true) {
      // A teammate changed it after this device last synced: it comes back instead of being deleted.
      state.yielded.add(entry.path);
      this.requestReconcile();
      return;
    }
    if (changed === false) {
      const sent = await this._apiDeleteNode(op.id, { cascade: op.kind === 'folder' });
      if (sent === false) return;
    }
    const removed = [];
    await this.repo.apply(async (map) => {
      for (const [id, e] of [...map]) {
        if (underOrAt(e.path, entry.path)) {
          removed.push([id, e]);
          map.delete(id);
        }
      }
    });
    if (changed === false) this._rememberDeletes(entry.path, removed);
  },

  _rememberDeletes(rootPath, removed) {
    if (!underLocked(rootPath)) return;
    const state = this._structureState();
    const at = Date.now();
    const subtree = removed.map(([id, e]) => [String(id), e]);
    for (const [id, e] of subtree) {
      state.recentDeletes.set(e.path, { id, entry: e, at, subtree: e.path === rootPath ? subtree : null });
    }
  },

  _holdMassDelete(op) {
    const state = this._structureState();
    const key = [...op.ids].sort().join(',');
    if (state.massDelete && state.massDelete.key === key) return;
    state.massDelete = { key, ids: op.ids, paths: op.paths, files: op.files };
    this.emit('sync-error', {
      type: 'mass-delete',
      priority: 1,
      dismissable: false,
      files: op.files,
      paths: op.paths,
      userMessage: `${op.files} attachments were removed from uploads at once. They are kept on the server until you choose to delete them there or restore them here.`
    });
  },

  resolveMassDelete(choice) {
    const state = this._structureState();
    const pending = state.massDelete;
    if (!pending) return Promise.resolve(false);
    state.massDelete = null;
    if (choice === 'restore') {
      for (const p of pending.paths) state.yielded.add(p);
      this.requestReconcile();
      return Promise.resolve(true);
    }
    const gen = this.generation;
    return this.serial(async () => {
      this._structureLive = true;
      try {
        for (const id of pending.ids) {
          if (gen !== this.generation) break;
          const entry = this.repo.get(id);
          if (!entry || fsSync.existsSync(path.join(this.syncFolder, entry.path))) continue;
          const sent = await this._apiDeleteNode(id, { cascade: entry.type === 'folder' });
          if (sent === false) break;
          const removed = [];
          await this.repo.apply(async (map) => {
            for (const [nid, e] of [...map]) {
              if (underOrAt(e.path, entry.path)) {
                removed.push([nid, e]);
                map.delete(nid);
              }
            }
          });
          this._rememberDeletes(entry.path, removed);
        }
      } finally {
        this._structureLive = false;
      }
      return true;
    });
  }
};

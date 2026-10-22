/**
 * RootObserver — the one chokidar watcher for a served root.
 *
 * Alive while the root is served or has a running session. It pushes external
 * disk edits to open tabs (an `external-change` frame plus the saved-lane
 * broadcast), runs the data-loss guard on raw external writes, and holds a
 * truncate-then-write back until the file settles. The sync engine subscribes
 * to its `raw` feed instead of running a watcher of its own.
 *
 * Events (CONTRACTS §9a): `raw {event, rel}`, `change {rel, kind, html?, etag?}`,
 * `remove {rel}`, `lease-released {rel}`, `error`.
 */

const { EventEmitter } = require('events');
const chokidar = require('chokidar');
const fs = require('fs').promises;
const path = require('upath');
const { SYNC_CONFIG } = require('../sync-engine/constants');
const { documentEtag } = require('./spec-wire');
const dataGuard = require('./data-loss-guard');
const { withDocumentWrite, withStructureChange, atomicWriteFile } = require('./utils/write-queue');
const { getConsentRegistry, resolveWritePath } = require('./utils/path-resolver');
const { logicalBytes, storePageState } = require('./page-state-store');
const { createBackup } = require('./utils/backup');
const { rebaseStaleSave, newestVersionFiles } = require('./page-rebase');

const EMPTY_QUIET_MS = 3000;
const MAX_EXTERNAL_HTML = 12 * 1024 * 1024;
const IGNORED = [
  '**/node_modules/**', '**/sites-versions/**', '**/tailwindcss/**',
  '**/.*', '**/.*/**', '**/.DS_Store', '**/Thumbs.db', '**/.trash/**',
];

/** The observed name no longer resolves to the document this event claimed. */
class StaleObservationError extends Error {}

class RootObserver extends EventEmitter {
  constructor(root, { live, localAuthority = null }) {
    super();
    this.root = root;
    this.live = live;
    this.localAuthority = localAuthority;
    this.watcher = null;
    this.emptyTimers = new Map();
    this.retryTimers = new Set();
    this.isRemoteApply = () => false;
  }

  start() {
    if (this.watcher) return;
    this.watcher = chokidar.watch('**/*', {
      cwd: this.root.path, persistent: true, ignoreInitial: true, followSymlinks: false,
      ignored: IGNORED, awaitWriteFinish: SYNC_CONFIG.FILE_STABILIZATION,
    });
    for (const event of ['add', 'addDir', 'change', 'unlink', 'unlinkDir']) {
      this.watcher.on(event, (rel) => this._raw(event, path.normalize(rel)));
    }
    this.watcher.on('error', (error) => this.emit('error', error));
  }

  async stop() {
    for (const t of this.emptyTimers.values()) clearTimeout(t);
    this.emptyTimers.clear();
    for (const t of this.retryTimers) clearTimeout(t);
    this.retryTimers.clear();
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
  }

  // The engine's shims (_onAdd, _onChange, …) subscribe here. Returns a disposer.
  subscribe(listener) {
    this.on('raw', listener);
    return () => this.off('raw', listener);
  }

  setRemoteApplyCheck(fn) { this.isRemoteApply = fn || (() => false); }

  emptyPending(rel) { return this.emptyTimers.has(rel); }

  // CONTRACTS §9a. The watcher already covers the whole root, so a lease only keeps the observer
  // alive (main's observers map counts leases) while a wire handler holds a file with no tab open.
  lease(rel) {
    this.leases = (this.leases || 0) + 1;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases -= 1;
      this.emit('lease-released', { rel });
    };
  }

  async poke(rel) {
    await this._raw('change', path.normalize(rel));
  }

  // F1's restore and any other host-side write that must reach edit-mode tabs as an external change.
  // `saved` names whether this publish still owes the saved lane: an authority write
  // already published it once per alias, and a second one here would be a duplicate.
  // `continues` marks an edit the open room keeps (an adoption offer), so streams
  // resuming on that room need no resync.
  publishExternal(rel, bytes, msg, { saved = true, continues = false } = {}) {
    this._notifyExternal(rel, bytes, msg, { saved, continues });
  }

  async _raw(event, rel, { settled = false, retried = false } = {}) {
    if (this.localAuthority) {
      const handled = await this._observeUnderAuthority(event, rel, { settled, retried });
      if (handled) return;
    }

    const isHtml = /\.(html?|htmlclay)$/i.test(rel);
    if (isHtml && (event === 'add' || event === 'change')) {
      let bytes;
      try { bytes = await fs.readFile(path.join(this.root.path, rel)); } catch { bytes = null; }
      if (bytes && bytes.length === 0) {
        if (!this.emptyTimers.has(rel)) {
          this.emptyTimers.set(rel, setTimeout(() => {
            this.emptyTimers.delete(rel);
            this._publish(event, rel, bytes);
          }, EMPTY_QUIET_MS));
        }
        return;
      }
      const pending = this.emptyTimers.get(rel);
      if (pending) { clearTimeout(pending); this.emptyTimers.delete(rel); }
      this._publish(event, rel, bytes);
      return;
    }
    this.emit('raw', { event, rel });
    if (event === 'unlink') this.emit('remove', { rel });
  }

  /**
   * The authority's classification of one watcher event. Every read runs inside
   * the same canonical document boundary the writers hold, so the bytes and the
   * stat it compares against the last confirmed stamp are the bytes on disk.
   * Returns true when this handled the event; false only for an event shape
   * this does not own.
   */
  async _observeUnderAuthority(event, rel, { settled, retried }) {
    if (event === 'unlink') return this._observeUnlink(rel);
    if (event === 'unlinkDir') return this._observeUnlinkDir(rel);
    if ((event === 'add' || event === 'change') && /\.(html?|htmlclay)$/i.test(rel)) {
      return this._observeHtml(event, rel, { settled, retried });
    }
    return false;
  }

  async _observeHtml(event, rel, { settled, retried }) {
    const authority = this.localAuthority;
    const registry = getConsentRegistry(this.root.path);
    let outcome;
    try {
      const claimedPath = await resolveWritePath(registry, rel);
      const target = authority.bindTarget({
        rootId: this.root.id ?? null, logicalPath: rel, canonicalPath: claimedPath, origin: null, live: this.live,
      });
      outcome = await withDocumentWrite(async () => {
        const currentPath = await resolveWritePath(registry, rel);
        const retired = authority.isRetired({ rootId: this.root.id ?? null, logicalPath: rel, canonicalPath: currentPath });
        if (currentPath !== claimedPath || (authority.identityAt(currentPath) !== target.identity && !retired)) {
          throw new StaleObservationError();
        }
        return { canonicalPath: currentPath };
      }, async (resolved, token) => this._classifyHtml(resolved.canonicalPath, rel, target, token, { settled }));
    } catch (error) {
      // A name that now resolves elsewhere belongs to the newer event that moved it.
      if (error instanceof StaleObservationError) return true;
      this._logObservation(rel, error);
      return true;
    }

    const pending = this.emptyTimers.get(rel);
    if (pending && outcome.kind !== 'empty') {
      clearTimeout(pending);
      this.emptyTimers.delete(rel);
    }

    if (outcome.kind === 'empty') {
      this._armEmptyTimer(rel, event);
      return true;
    }
    if (outcome.kind === 'unstable') {
      if (!retried) this._scheduleRetry(event, rel, { settled });
      return true;
    }

    // The boundary has released: only now may the raw feed run, because the
    // engine's subscriber enters the serial lane synchronously.
    this.emit('raw', { event, rel });
    if (outcome.kind === 'external' && event === 'change') this._runDataGuard(rel, outcome.bytes);
    return true;
  }

  /**
   * Read and classify one HTML event while the document boundary is held. The
   * decision is the last confirmed stamp — runtime identity, byte ETag and stat
   * — never the in-memory browser-save flag, so a delayed event for our own
   * write and a real external replacement are told apart by what is on disk.
   * Publication to editors happens here; the raw feed waits for the release.
   */
  async _classifyHtml(canonicalPath, rel, target, token, { settled }) {
    const before = await this._stat(canonicalPath);
    let bytes = null;
    try { bytes = await fs.readFile(canonicalPath); } catch { bytes = null; }
    const after = await this._stat(canonicalPath);

    if (!before && !after) return { kind: 'missing' };

    if (!before || !after || !bytes || after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs) {
      return { kind: 'unstable' };
    }

    if (bytes.length === 0 && !settled) return { kind: 'empty' };

    // Classified against the logical document: the bytes on disk with the page
    // editor's merge state put back, which is what this host stamps and publishes.
    const logical = await logicalBytes(this.root.path, rel, bytes);

    const stamp = this.localAuthority.confirmedStamp(canonicalPath);
    if (stamp && stamp.identity === target.identity && stamp.etag === documentEtag(logical) &&
        stamp.dev === before.dev && stamp.ino === before.ino &&
        stamp.size === before.size && stamp.mtimeNs === before.mtimeNs) {
      this.emit('change', { rel, kind: 'self' });
      return { kind: 'self' };
    }

    // An older copy of a page (a checkout, an editor saving an older buffer) still
    // belongs to the room its rev came from: rebased onto the stored page it is a
    // continuation of that room, so the tabs merge it instead of being replaced.
    let observed = logical;
    // Judged on the file as written: the sidecar keeps the older article's state too, and a
    // copy composed with it would look like a page of its own rather than a stale one. The
    // disk already holds the copy, so it rebases onto the page the authority last confirmed.
    const rebased = await rebaseStaleSave(this.root.path, rel, bytes.toString('utf8'), newestVersionFiles,
      { stored: this.localAuthority.confirmedDocument?.(canonicalPath) ?? null });
    if (rebased) {
      observed = await logicalBytes(this.root.path, rel, Buffer.from(rebased.html, 'utf8'));
      await this._writeRebased(canonicalPath, rel, target, token, observed);
    }

    const changed = await this.localAuthority.observeExternal(target, observed.toString('utf8'), token);
    this._notifyExternal(rel, observed, null, {
      reason: changed.kind === 'replacement' ? 'external-replacement' : undefined,
      recovered: changed.recovered,
      continues: changed.kind === 'continuation',
    });
    return { kind: 'external', bytes };
  }

  // A rebased disk copy is written back the way a host write lands: a version of
  // the merged file, then the merged document itself, then the stamp that makes
  // the next event for those bytes our own. Without it the disk keeps the older
  // copy while the authority records the merged one, so every later event is
  // classified external again and every reader sees the stale document.
  async _writeRebased(canonicalPath, rel, target, token, merged) {
    const { splitPage } = require('@panphora/clayjs/server/rooms');
    const html = merged.toString('utf8');
    // The room's unsaved edits are published first, while the room's own baseline
    // is still the document it was built on: the merged bytes do not carry them.
    await this.localAuthority.recoverUnsavedEdits(target, token);
    await createBackup(this.root.path, rel.replace(/\.(html|htmlclay)$/i, ''), splitPage(html).file);
    await atomicWriteFile(canonicalPath, await storePageState(this.root.path, rel, html));
    await this.localAuthority.confirmKnownWrite(target, merged, token, { sender: 'file-watcher', publish: false });
  }

  async _observeUnlink(rel) {
    const registry = getConsentRegistry(this.root.path);
    let replaced;
    let removal;
    try {
      await withDocumentWrite(async () => ({ canonicalPath: await resolveWritePath(registry, rel) }), async (resolved, token) => {
        replaced = !!(await this._stat(resolved.canonicalPath));
        if (!replaced) {
          removal = await this.localAuthority.observeExternal({
            rootId: this.root.id ?? null, logicalPath: rel, canonicalPath: resolved.canonicalPath, live: this.live,
          }, null, token, { removed: true });
        }
      });
    } catch (error) {
      this._logObservation(rel, error);
      return true;
    }

    // A replacement is on disk: the watcher's unlink is a delayed event for a
    // file that was replaced, not a deletion.
    if (replaced) return true;

    this.live.notify(rel, {
      msgType: 'warning',
      msg: `${path.basename(rel)} was removed on disk outside this tab`,
      action: 'reload',
      data: {
        kind: 'external-change', sender: 'file-system', reason: 'external-replacement',
        ...(removal?.recovered && { recovered: removal.recovered }),
      },
    });

    // Removal point. E adds recovery and retirement here, after the release.
    this.emit('raw', { event: 'unlink', rel });
    this.emit('remove', { rel });
    return true;
  }

  async _observeUnlinkDir(rel) {
    const registry = getConsentRegistry(this.root.path);
    let absent;
    try {
      await withStructureChange(async (token) => {
        const canonicalPath = await resolveWritePath(registry, rel);
        absent = !(await this._stat(canonicalPath));
        if (absent) await this.localAuthority.observeRemovedPrefix(this.root.id ?? null, rel, canonicalPath, token);
      });
    } catch (error) {
      this._logObservation(rel, error);
      return true;
    }

    if (!absent) return true;
    this.emit('raw', { event: 'unlinkDir', rel });
    return true;
  }

  // The bytes read while the file was still empty are never published: the
  // callback reads the file again, inside a fresh boundary.
  _armEmptyTimer(rel, event) {
    if (this.emptyTimers.has(rel)) return;
    this.emptyTimers.set(rel, setTimeout(() => {
      this.emptyTimers.delete(rel);
      this._raw(event, rel, { settled: true }).catch((error) => this._logObservation(rel, error));
    }, EMPTY_QUIET_MS));
  }

  // One fresh observation of an unstable read, and no more: a second unstable
  // read is dropped rather than published.
  _scheduleRetry(event, rel, { settled }) {
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      this._raw(event, rel, { settled, retried: true }).catch((error) => this._logObservation(rel, error));
    }, 0);
    this.retryTimers.add(timer);
  }

  async _stat(canonicalPath) {
    try {
      return await fs.stat(canonicalPath, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  }

  _logObservation(rel, error) {
    console.error('[root-observer] observation failed for', rel, error && error.message ? error.message : error);
  }

  _publish(event, rel, bytes) {
    this.emit('raw', { event, rel });
    if (!bytes) return;
    if (this.live.wasBrowserSave(rel) || this.isRemoteApply(rel)) {
      this.emit('change', { rel, kind: 'self' });
      return;
    }
    this._notifyExternal(rel, bytes);
    if (event === 'change') this._runDataGuard(rel, bytes);
  }

  _runDataGuard(rel, bytes) {
    dataGuard.runDataLossGuard({
      baseDir: this.root.path, name: rel, newHtml: bytes.toString('utf8'), prevContent: null, prov: 'external', live: this.live,
    }).catch((err) => console.error('[data-guard] observer guard error:', err && err.message ? err.message : err));
  }

  _notifyExternal(rel, bytes, msg, { saved = true, reason, recovered, continues = false } = {}) {
    const html = bytes.toString('utf8');
    const etag = documentEtag(bytes);
    this.live.notify(rel, {
      msgType: 'warning',
      msg: msg || `${path.basename(rel)} changed on disk outside this tab`,
      action: 'reload',
      data: bytes.length <= MAX_EXTERNAL_HTML
        ? { kind: 'external-change', html, sender: 'file-system', etag, ...(reason && { reason }), ...(recovered && { recovered }) }
        : { kind: 'external-change', sender: 'file-system', ...(reason && { reason }), ...(recovered && { recovered }) },
    });
    if (saved) this.live.broadcast(rel, { html, sender: 'file-watcher' }, { lane: 'saved' });
    this.emit('change', { rel, kind: 'external', html, etag, ...(continues && { continues }) });
  }
}

module.exports = { RootObserver, EMPTY_QUIET_MS, IGNORED, MAX_EXTERNAL_HTML };

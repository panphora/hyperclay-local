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

const EMPTY_QUIET_MS = 3000;
const MAX_EXTERNAL_HTML = 12 * 1024 * 1024;
const IGNORED = [
  '**/node_modules/**', '**/sites-versions/**', '**/tailwindcss/**',
  '**/.*', '**/.*/**', '**/.DS_Store', '**/Thumbs.db', '**/.trash/**',
];

class RootObserver extends EventEmitter {
  constructor(root, { live }) {
    super();
    this.root = root;
    this.live = live;
    this.watcher = null;
    this.emptyTimers = new Map();
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
  publishExternal(rel, bytes, msg) {
    this._notifyExternal(rel, bytes, msg);
  }

  async _raw(event, rel) {
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

  _publish(event, rel, bytes) {
    this.emit('raw', { event, rel });
    if (!bytes) return;
    if (this.live.wasBrowserSave(rel) || this.isRemoteApply(rel)) {
      this.emit('change', { rel, kind: 'self' });
      return;
    }
    this._notifyExternal(rel, bytes);
    if (event === 'change') {
      dataGuard.runDataLossGuard({
        baseDir: this.root.path, name: rel, newHtml: bytes.toString('utf8'), prevContent: null, prov: 'external', live: this.live,
      }).catch((err) => console.error('[data-guard] observer guard error:', err && err.message ? err.message : err));
    }
  }

  _notifyExternal(rel, bytes, msg) {
    const html = bytes.toString('utf8');
    const etag = documentEtag(bytes);
    this.live.notify(rel, {
      msgType: 'warning',
      msg: msg || `${path.basename(rel)} changed on disk outside this tab`,
      action: 'reload',
      data: bytes.length <= MAX_EXTERNAL_HTML
        ? { kind: 'external-change', html, sender: 'file-system', etag }
        : { kind: 'external-change', sender: 'file-system' },
    });
    this.live.broadcast(rel, { html, sender: 'file-watcher' }, { lane: 'saved' });
    this.emit('change', { rel, kind: 'external', html, etag });
  }
}

module.exports = { RootObserver, EMPTY_QUIET_MS, IGNORED, MAX_EXTERNAL_HTML };

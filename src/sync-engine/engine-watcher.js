/**
 * Local filesystem changes and reaction to them.
 *
 * The chokidar watcher belongs to the root's RootObserver; this module
 * subscribes to its `raw` feed (building a private observer when the caller
 * passed none) and covers the raw event shims, the locked uploads folder's
 * rename-back, and the per-type handlers that forward into the queue. Adds,
 * unlinks and changes on untracked paths carry no structure decision: they
 * mark the path dirty for the structure job, which snapshots the disk and
 * diffs it against the ledger. Methods are installed onto SyncEngine.prototype.
 */

const path = require('upath');
const { formatErrorForLog } = require('./error-handler');
const {
  readFile,
  readFileBuffer,
  calculateBufferChecksum,
  fileExists
} = require('./file-operations');
const { calculateChecksum } = require('./utils');
const { classifyPath } = require('./path-helpers');
const { LOCKED_FOLDER } = require('./locked-folder');
const fs = require('fs/promises');
const { RootObserver } = require('../main/root-observer');

// C3.11: the states a session's feed is dropped in. What the user edits while a
// session is paused, offline, degraded or stopped is reconciled by the pass that
// brings it back, never replayed from this feed.
const GATED_RUNNER_STATES = new Set(['paused', 'offline', 'error', 'stopped']);

module.exports = {
  startUnifiedWatcher() {
    // One subscription per session (C3.11). A session paused at launch has no
    // watcher yet: the runner that resumes it starts this on its way out of
    // `paused`, so the callers that follow each other (init, first bind, legacy
    // import, resume, a backoff restart) subscribe once between them.
    if (this._subscribedObserver) return;

    let observer = this.observer;
    if (!observer) {
      observer = new RootObserver({ path: this.syncFolder }, { live: this.live });
      observer.setRemoteApplyCheck((rel) => this.isRecentRemoteApply(rel));
      observer.start();
      this.privateObserver = observer;
    }

    this._subscribedObserver = observer;
    this._disposeObserver = observer.subscribe(({ event, rel }) => this._dispatchRaw(event, rel));
    this._onObserverError = (error) => {
      console.error('[SYNC] Watcher error:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'watcher' }));
      if (this.logger) {
        this.logger.error('WATCHER', 'File watcher error', { error });
      }
    };
    observer.on('error', this._onObserverError);

    console.log('[SYNC] Unified watcher started (sites + uploads + folders)');

    if (this.logger) {
      this.logger.info('WATCHER', 'Unified watcher started', {
        syncFolder: this.logger.sanitizePath(this.syncFolder)
      });
    }
  },

  // --- Observer feed ---

  _dispatchRaw(event, rel) {
    // C3.11: a runner that cannot act on the event drops it. An edit made while
    // the session is paused is reconciled by the pass that resumes it instead.
    if (this.runner && GATED_RUNNER_STATES.has(this.runner.state)) return;

    switch (event) {
      case 'add': return this._onAdd(rel);
      case 'addDir': return this._onAddDir(rel);
      case 'change': return this._onChange(rel);
      case 'unlink': return this._onUnlink(rel);
      case 'unlinkDir': return this._onUnlinkDir(rel);
    }
  },

  // --- Event handler shims ---

  _onAdd(filename) {
    const normalizedPath = path.normalize(filename);
    if (this.cascade.consume(normalizedPath)) return;
    this.markDirty(normalizedPath);
  },

  _onAddDir(dirname) {
    const normalizedPath = path.normalize(dirname);
    if (!normalizedPath || normalizedPath === '.') return;
    if (this.cascade.consume(normalizedPath)) return;
    this.markDirty(normalizedPath);
  },

  _onChange(filename) {
    const normalizedPath = path.normalize(filename);
    if (this.cascade.consume(normalizedPath)) return;
    const tracked = this.repo.getByPath(normalizedPath);
    if (!tracked || this.holdsPath(normalizedPath)) {
      this.markDirty(normalizedPath);
      return;
    }
    const type = classifyPath(normalizedPath, 'change');
    if (type === 'site') this._handleSiteChange(normalizedPath);
    else if (type === 'upload') this._handleUploadChange(normalizedPath);
  },

  _onUnlink(filename) {
    const normalizedPath = path.normalize(filename);
    if (this.cascade.consume(normalizedPath)) return;
    this.markDirty(normalizedPath);
  },

  _onUnlinkDir(dirname) {
    const normalizedPath = path.normalize(dirname);
    if (!normalizedPath || normalizedPath === '.') return;
    if (this.cascade.consume(normalizedPath)) return;
    this.markDirty(normalizedPath);
  },

  /**
   * Ask for a full reconcile: the session's runner restarts its generation and
   * reconciles everything from scratch, the way the SSE watchdog and a
   * rediscover do. A session without a runner falls back to a remote-change
   * check, which brings back whatever the disk is missing.
   */
  requestReconcile() {
    if (this.runner) {
      this.runner.start();
      return;
    }
    this.checkForRemoteChanges();
  },

  /**
   * Put the root's `uploads` folder back after it was renamed or moved: the
   * directory is renamed back and nothing is sent to the server. Returns true
   * when the folder is back on disk, false when it could not be put back — the
   * caller then restores it by download.
   */
  async restoreLockedFolder(fromRel) {
    const target = path.join(this.syncFolder, LOCKED_FOLDER);
    if (fileExists(target)) return 'occupied';
    try {
      await fs.rename(path.join(this.syncFolder, fromRel), target);
      console.log(`[SYNC] ${fromRel} renamed back to ${LOCKED_FOLDER}`);
      if (this.logger) {
        this.logger.warn('WATCHER', 'Root uploads folder renamed back', { from: fromRel, to: LOCKED_FOLDER });
      }
      return true;
    } catch (err) {
      console.error(`[SYNC] Failed to rename ${fromRel} back to ${LOCKED_FOLDER}:`, err.message);
      if (this.logger) {
        this.logger.error('WATCHER', 'Failed to put the root uploads folder back', { from: fromRel, error: err.message });
      }
      return false;
    }
  },

  // --- Type-specific handlers ---

  // The root observer pushes external edits to tabs and runs the data-loss
  // guard for every served root, with or without sync. These handlers only
  // feed the sync queue.
  async _handleSiteChange(normalizedPath) {
    let storedChecksum = null;
    for (const [, entry] of this.repo) {
      if (entry.path === normalizedPath && entry.type === 'site') {
        storedChecksum = entry.checksum;
        break;
      }
    }

    // Content comparison: skip if file content hasn't actually changed
    try {
      const localPath = path.join(this.syncFolder, normalizedPath);
      const newContent = await readFile(localPath);
      const newChecksum = await calculateChecksum(newContent);

      if (storedChecksum && storedChecksum === newChecksum) {
        console.log(`[SYNC] File changed but content identical (skipping): ${normalizedPath}`);
        return;
      }
    } catch (e) {
      // File read failed — fall through
    }

    console.log(`[SYNC] Site changed: ${normalizedPath}`);
    this.queueSync('change', normalizedPath);
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
  }
};

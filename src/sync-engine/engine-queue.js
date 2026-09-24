/**
 * Sync queue wiring.
 *
 * Thin adapter between the watcher and the SyncQueue class: validates paths,
 * enqueues work, and drains the queue by deciding each drained change from the
 * baseline, the disk and the cached inventory (C3). Methods here are installed
 * onto SyncEngine.prototype.
 */

const path = require('upath');
const { hasHiddenSegment, classifyPath } = require('./path-helpers');
const { validateFileName, validateFullPath } = require('./validation');
const { ERROR_PRIORITY } = require('./constants');
const { fileExists, readFileBuffer, calculateBufferChecksum } = require('./file-operations');
const { decide } = require('./reconcile/decide');
const { executeDecision } = require('./reconcile/execute');

module.exports = {
  queueSync(type, filename) {
    if (!this.isRunning) return;
    if (hasHiddenSegment(filename)) return;

    if (type === 'add' || type === 'change') {
      const eventType = type === 'add' ? 'add' : 'change';
      const classified = classifyPath(filename, eventType);

      if (classified !== 'folder') {
        const validationResult = filename.includes('/')
          ? validateFullPath(filename)
          : validateFileName(filename, false);

        if (!validationResult.valid) {
          console.error(`[SYNC] Cannot queue ${filename}: ${validationResult.error}`);
          if (this.logger) {
            this.logger.error('VALIDATION', 'Cannot queue file - validation failed', {
              file: filename,
              reason: validationResult.error
            });
          }
          this.emit('sync-error', {
            file: filename,
            error: validationResult.error,
            type: 'validation',
            priority: ERROR_PRIORITY.HIGH,
            action: 'queue',
            canRetry: false
          });
          return;
        }
      }
    }

    if (!this.syncQueue.add(type, filename)) {
      return;
    }

    this.syncQueue.setQueueTimer(() => {
      if (this.isRunning) {
        this.processQueue();
      }
    });
  },

  /**
   * One drained change: a folder is created, a file is decided. The watcher
   * only enqueues add/change/addDir, so the local file is the evidence here and
   * the remote view for its node is read from the cached inventory.
   */
  async applyLocalChange(item) {
    if (item.type === 'addDir') {
      await this.createFolderOnServer(item.filename);
      return;
    }

    const known = this.repo.getByPath(item.filename);
    const type = (known && known.entry.type) || classifyPath(item.filename, item.type);
    if (type === 'folder') {
      await this.createFolderOnServer(item.filename);
      return;
    }

    const local = await this.changedLocalView(item.filename);
    if (!local) return; // gone since the event: the unlink path owns that change

    await this.refreshRemoteView();

    const nodeId = known ? known.nodeId : null;
    const remote = this.cachedRemoteView(nodeId, item.filename);
    const baseline = nodeId === null ? null : this.repo.getBaseline(nodeId);
    const decision = decide({
      baseline,
      local,
      remote: remote ? { etag: remote.etag } : null,
      // A local change is evidence in itself: the file exists on disk now. A
      // stale cache can only cost a 409, which the executor records as a
      // conflict instead of renaming or overwriting.
      complete: true
    });

    await executeDecision(this, nodeId, decision, {
      path: item.filename,
      type,
      parentId: remote ? remote.parentId : known && known.entry.parentId,
      etag: remote ? remote.etag : undefined,
      structureVersion: remote ? remote.structureVersion : undefined
    });
  },

  /** The bytes of a change event, or null when the file is no longer on disk. */
  async changedLocalView(rel) {
    const fullPath = path.join(this.syncFolder, rel);
    if (!fileExists(fullPath)) return null;
    return { checksum: calculateBufferChecksum(await readFileBuffer(fullPath)) };
  },

  /**
   * The cached inventory's view of one node, or null when it does not list it.
   * A change event for a path with no node id is looked up by path.
   */
  cachedRemoteView(nodeId, rel) {
    const nodes = this.serverNodesCache || [];
    if (nodeId !== null) {
      const node = nodes.find(n => String(n.id) === String(nodeId));
      return node ? this.remoteViewOf(node) : null;
    }
    const node = nodes.find(n => (n.path ? `${n.path}/${n.name}` : n.name) === rel);
    return node ? this.remoteViewOf(node) : null;
  },

  /**
   * A cached inventory older than the last stream frame cannot be trusted for a
   * node the stream may have changed, so a list is fetched first. maxAge 0
   * makes the fetch unconditional and replaces the cache.
   */
  async refreshRemoteView() {
    const stale = !this.serverNodesCache ||
      (this.syncReadyAt && this.serverNodesCacheTime < this.syncReadyAt);
    if (!stale) return;
    this.invalidateServerNodesCache();
    await this.fetchAndCacheServerNodes(0);
  },

  /**
   * Resolves when this session has nothing left to do. A pause or a stop drops
   * the queue, so the waiters are settled there too rather than hanging.
   */
  whenQueueEmpty() {
    this.settleQueueWaiters();
    if (this.syncQueue.isEmpty() && !this.syncQueue.isProcessingQueue()) return Promise.resolve();
    return new Promise((resolve) => { this.queueWaiters.push(resolve); });
  },

  settleQueueWaiters() {
    if (!this.syncQueue.isEmpty() || this.syncQueue.isProcessingQueue()) return;
    for (const resolve of this.queueWaiters.splice(0)) resolve();
  },

  async processQueue() {
    if (!this.isRunning || this.syncQueue.isProcessingQueue() || this.syncQueue.isEmpty()) {
      this.settleQueueWaiters();
      return;
    }

    this.syncQueue.setProcessing(true);

    while (!this.syncQueue.isEmpty()) {
      const item = this.syncQueue.next();

      try {
        await this.applyLocalChange(item);

        this.syncQueue.clearRetry(item.filename);

        if (this.logger) {
          this.logger.success('QUEUE', 'Queue item processed', {
            file: item.filename,
            type: item.type
          });
        }

      } catch (error) {
        console.error(`[SYNC] Queue item failed for ${item.filename}:`, error.message);
        if (this.logger) {
          this.logger.error('QUEUE', 'Queue processing failed', {
            file: item.filename,
            type: item.type,
            error
          });
        }

        const retryResult = this.syncQueue.scheduleRetry(
          item,
          error,
          (retryItem) => {
            if (this.isRunning) {
              const filePath = path.join(this.syncFolder, retryItem.filename);
              if (fileExists(filePath)) {
                this.queueSync(retryItem.type, retryItem.filename);
              } else {
                this.syncQueue.clearRetry(retryItem.filename);
              }
            }
          }
        );

        if (!retryResult.shouldRetry) {
          console.error(`[SYNC] Permanent failure for ${item.filename}: ${retryResult.reason}`);
          this.emit('sync-failed', {
            file: item.filename,
            error: error.message,
            priority: ERROR_PRIORITY.CRITICAL,
            finalFailure: true,
            attempts: retryResult.attempts
          });
        } else {
          if (this.logger) {
            this.logger.warn('QUEUE', 'Retry scheduled', {
              file: item.filename,
              attempt: retryResult.attempt,
              maxAttempts: retryResult.maxAttempts,
              nextRetryIn: retryResult.nextRetryIn,
              error: error.message,
              statusCode: error.statusCode
            });
          }
          this.emit('sync-retry', {
            file: item.filename,
            attempt: retryResult.attempt,
            maxAttempts: retryResult.maxAttempts,
            nextRetryIn: retryResult.nextRetryIn,
            error: error.message
          });
        }
      }
    }

    this.stats.lastSync = new Date().toISOString();
    this.emit('sync-stats', this.stats);
    this.syncQueue.setProcessing(false);
    this.settleQueueWaiters();
  }
};

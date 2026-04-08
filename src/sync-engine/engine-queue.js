/**
 * Sync queue wiring.
 *
 * Thin adapter between the watcher and the SyncQueue class: validates paths,
 * enqueues work, and drains the queue by dispatching to the appropriate
 * uploader method. Methods here are installed onto SyncEngine.prototype.
 */

const path = require('upath');
const { hasHiddenSegment, classifyPath } = require('./path-helpers');
const { validateFileName, validateFullPath } = require('./validation');
const { ERROR_PRIORITY } = require('./constants');
const { fileExists } = require('./file-operations');

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

  async processQueue() {
    if (!this.isRunning || this.syncQueue.isProcessingQueue() || this.syncQueue.isEmpty()) {
      return;
    }

    this.syncQueue.setProcessing(true);

    while (!this.syncQueue.isEmpty()) {
      const item = this.syncQueue.next();

      try {
        if (item.type === 'add' || item.type === 'change') {
          let type = null;
          for (const [, entry] of this.nodeMap) {
            if (entry.path === item.filename) {
              type = entry.type;
              break;
            }
          }
          if (!type) {
            type = classifyPath(item.filename, item.type === 'add' ? 'add' : 'change');
          }

          if (type === 'folder') {
            await this.createFolderOnServer(item.filename);
          } else if (type === 'upload') {
            await this.uploadUploadFile(item.filename);
          } else {
            await this.uploadFile(item.filename);
          }
        }

        this.syncQueue.clearRetry(item.filename);

        if (this.logger) {
          this.logger.success('QUEUE', 'Queue item processed', {
            file: item.filename,
            type: item.type
          });
        }

      } catch (error) {
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
              nextRetryIn: retryResult.nextRetryIn
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
  }
};

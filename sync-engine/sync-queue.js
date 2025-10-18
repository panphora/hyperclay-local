/**
 * Sync queue management with retry logic
 */

const { SYNC_CONFIG } = require('./constants');
const { isRetryableError } = require('./error-handler');

class SyncQueue {
  constructor() {
    this.queue = [];
    this.retryQueue = new Map();
    this.retryTimers = new Set();
    this.queueTimer = null;
    this.isProcessing = false;
  }

  /**
   * Add item to sync queue
   */
  add(type, filename) {
    // Only sync .html files
    if (!filename.endsWith('.html')) return false;

    // Check if already in queue
    const existing = this.queue.find(item => item.filename === filename);
    if (existing) {
      return false;
    }

    this.queue.push({
      type,
      filename,
      queuedAt: Date.now()
    });

    return true;
  }

  /**
   * Get next item from queue
   */
  next() {
    return this.queue.shift();
  }

  /**
   * Check if queue is empty
   */
  isEmpty() {
    return this.queue.length === 0;
  }

  /**
   * Get queue length
   */
  length() {
    return this.queue.length;
  }

  /**
   * Check if currently processing
   */
  isProcessingQueue() {
    return this.isProcessing;
  }

  /**
   * Set processing state
   */
  setProcessing(state) {
    this.isProcessing = state;
  }

  /**
   * Handle retry for failed item
   */
  scheduleRetry(item, error, onRetry) {
    // Check if error is retryable
    if (!isRetryableError(error)) {
      return {
        shouldRetry: false,
        reason: 'Non-retryable error'
      };
    }

    const retryInfo = this.retryQueue.get(item.filename) || { attempts: 0 };
    retryInfo.attempts++;
    retryInfo.lastError = error.message;

    if (retryInfo.attempts >= SYNC_CONFIG.MAX_RETRIES) {
      // Max retries exceeded
      this.retryQueue.delete(item.filename);
      return {
        shouldRetry: false,
        reason: 'Max retries exceeded',
        attempts: retryInfo.attempts
      };
    }

    // Schedule retry with exponential backoff
    this.retryQueue.set(item.filename, retryInfo);
    const delay = SYNC_CONFIG.RETRY_DELAYS[retryInfo.attempts - 1];

    console.log(`[SYNC] Scheduling retry ${retryInfo.attempts}/${SYNC_CONFIG.MAX_RETRIES} for ${item.filename} in ${delay/1000}s`);

    const timer = setTimeout(() => {
      // Remove timer from tracking set
      this.retryTimers.delete(timer);

      // Call retry callback
      if (onRetry) {
        onRetry(item);
      }
    }, delay);

    // Track the timer
    this.retryTimers.add(timer);

    return {
      shouldRetry: true,
      attempt: retryInfo.attempts,
      maxAttempts: SYNC_CONFIG.MAX_RETRIES,
      nextRetryIn: delay / 1000
    };
  }

  /**
   * Clear retry info for successful item
   */
  clearRetry(filename) {
    this.retryQueue.delete(filename);
  }

  /**
   * Check if file has failed permanently
   */
  hasFailedPermanently(filename) {
    const retryInfo = this.retryQueue.get(filename);
    return !!(retryInfo && retryInfo.attempts >= SYNC_CONFIG.MAX_RETRIES);
  }

  /**
   * Clear all pending operations
   */
  clear() {
    // Clear main queue
    this.queue = [];

    // Clear retry queue
    this.retryQueue.clear();

    // Clear all retry timers
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    // Clear queue timer
    clearTimeout(this.queueTimer);
    this.queueTimer = null;

    // Reset processing state
    this.isProcessing = false;
  }

  /**
   * Set queue processing timer
   */
  setQueueTimer(callback, delay = 500) {
    clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(callback, delay);
  }

  /**
   * Clear queue processing timer
   */
  clearQueueTimer() {
    clearTimeout(this.queueTimer);
    this.queueTimer = null;
  }

  /**
   * Get retry info for a file
   */
  getRetryInfo(filename) {
    return this.retryQueue.get(filename);
  }

  /**
   * Get all items currently in queue
   */
  getQueuedItems() {
    return [...this.queue];
  }

  /**
   * Get all items with retry info
   */
  getRetryItems() {
    return Array.from(this.retryQueue.entries()).map(([filename, info]) => ({
      filename,
      ...info
    }));
  }
}

module.exports = SyncQueue;
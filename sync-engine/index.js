/**
 * Sync Engine for Hyperclay Local
 * Main module that orchestrates bidirectional sync
 */

const EventEmitter = require('events').EventEmitter;
const path = require('path');
const chokidar = require('chokidar');
const { safeStorage } = require('electron');
const { getServerBaseUrl } = require('../utils');

// Import sync engine modules
const { SYNC_CONFIG, ERROR_PRIORITY } = require('./constants');
const { calculateChecksum, generateTimestamp, isLocalNewer, isFutureFile, calibrateClock } = require('./utils');
const { createBackupIfNeeded } = require('./backup');
const { classifyError, formatErrorForLog } = require('./error-handler');
const {
  getLocalFiles,
  readFile,
  writeFile,
  fileExists,
  getFileStats,
  ensureDirectory
} = require('./file-operations');
const {
  fetchServerFiles,
  downloadFromServer,
  uploadToServer,
  getServerStatus
} = require('./api-client');
const SyncQueue = require('./sync-queue');
const { validateFileName, validateFullPath } = require('./validation');

class SyncEngine extends EventEmitter {
  constructor() {
    super();
    this.apiKey = null;
    this.apiKeyEncrypted = null;
    this.username = null;
    this.serverUrl = null;
    this.syncFolder = null;
    this.watcher = null;
    this.isRunning = false;
    this.clockOffset = 0;
    this.pollTimer = null;
    this.syncQueue = new SyncQueue();
    this.stats = {
      filesProtected: 0,
      filesDownloaded: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      lastSync: null,
      errors: []
    };
  }

  /**
   * Initialize sync with API key and folder
   */
  async init(apiKey, username, syncFolder, serverUrl) {
    console.log(`[SYNC] Init called with:`, {
      username,
      syncFolder,
      serverUrl,
      apiKeyLength: apiKey?.length,
      apiKeyPrefix: apiKey?.substring(0, 12)
    });

    if (this.isRunning) {
      throw new Error('Sync is already running');
    }

    // Reset stats for fresh session
    this.stats = {
      filesProtected: 0,
      filesDownloaded: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      lastSync: null,
      errors: []
    };

    // Clear any pending operations
    this.syncQueue.clear();

    this.apiKey = apiKey;
    this.username = username;
    this.syncFolder = syncFolder;

    // Set server URL with fallback to environment-based default
    this.serverUrl = getServerBaseUrl(serverUrl);

    console.log(`[SYNC] Initializing for ${username} at ${syncFolder}`);
    console.log(`[SYNC] Server: ${this.serverUrl}`);

    // Encrypt and store API key
    if (safeStorage.isEncryptionAvailable()) {
      this.apiKeyEncrypted = safeStorage.encryptString(apiKey);
    }

    try {
      // Ensure sync folder exists
      console.log(`[SYNC] Ensuring sync folder exists: ${syncFolder}`);
      await ensureDirectory(syncFolder);

      // Calibrate clock with server
      console.log(`[SYNC] Calibrating clock with server...`);
      this.clockOffset = await calibrateClock(this.serverUrl, this.apiKey);
      console.log(`[SYNC] Clock offset: ${this.clockOffset}ms`);

      // Perform initial sync
      console.log(`[SYNC] Starting initial sync...`);
      await this.performInitialSync();
      console.log(`[SYNC] Initial sync completed`);

      // Start file watcher
      console.log(`[SYNC] Starting file watcher...`);
      this.startFileWatcher();

      // Start polling for remote changes
      console.log(`[SYNC] Starting polling...`);
      this.startPolling();

      this.isRunning = true;

      console.log(`[SYNC] Initialization complete!`);
      return {
        success: true,
        stats: this.stats
      };
    } catch (error) {
      console.error(`[SYNC] Initialization failed:`, error);
      console.error(`[SYNC] Error type: ${error.name}`);
      console.error(`[SYNC] Error message: ${error.message}`);
      console.error(`[SYNC] Stack trace:`, error.stack);
      throw error;
    }
  }

  /**
   * Perform initial sync - download files from server but preserve newer local files
   */
  async performInitialSync() {
    console.log('[SYNC] Starting initial sync...');
    this.emit('sync-start', { type: 'initial' });

    try {
      // Get list of files from server
      const serverFiles = await fetchServerFiles(this.serverUrl, this.apiKey);

      // Get list of local files
      const localFiles = await getLocalFiles(this.syncFolder);

      // Process each server file
      for (const serverFile of serverFiles) {
        // Server returns filename WITHOUT .html, but local files have .html
        const localFilename = `${serverFile.filename}.html`;
        const localPath = path.join(this.syncFolder, localFilename);
        const localExists = localFiles.has(localFilename);

        if (!localExists) {
          // File doesn't exist locally, download it
          await this.downloadFile(serverFile.filename);
          this.stats.filesDownloaded++;
        } else {
          // File exists locally, check if we should update
          const localStat = await getFileStats(localPath);

          // Check if file is intentionally future-dated
          if (isFutureFile(localStat.mtime, this.clockOffset)) {
            console.log(`[SYNC] PRESERVE ${localFilename} - future-dated file`);
            this.stats.filesProtected++;
            continue;
          }

          // Check if local is newer
          if (isLocalNewer(localStat.mtime, serverFile.modifiedAt, this.clockOffset)) {
            console.log(`[SYNC] PRESERVE ${localFilename} - local is newer`);
            this.stats.filesProtected++;
            continue;
          }

          // Check checksums
          const localContent = await readFile(localPath);
          const localChecksum = await calculateChecksum(localContent);

          if (localChecksum === serverFile.checksum) {
            console.log(`[SYNC] SKIP ${localFilename} - checksums match`);
            this.stats.filesSkipped++;
            continue;
          }

          // Server file is different and not older, download it
          await this.downloadFile(serverFile.filename);
          this.stats.filesDownloaded++;
        }
      }

      this.stats.lastSync = new Date().toISOString();
      console.log('[SYNC] Initial sync complete');
      console.log(`[SYNC] Stats: ${JSON.stringify(this.stats)}`);

      // Emit completion event
      this.emit('sync-complete', {
        type: 'initial',
        stats: { ...this.stats }
      });

      // Emit stats update
      this.emit('sync-stats', this.stats);

    } catch (error) {
      console.error('[SYNC] Initial sync failed:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'initial-sync' }));

      // Emit error event
      this.emit('sync-error', {
        type: 'initial',
        error: error.message,
        priority: ERROR_PRIORITY.CRITICAL
      });

      throw error;
    }
  }

  /**
   * Download a file from server
   */
  async downloadFile(filename) {
    try {
      // Server expects filename WITHOUT .html
      const { content, modifiedAt } = await downloadFromServer(
        this.serverUrl,
        this.apiKey,
        filename
      );

      // Ensure filename has .html extension for local storage
      const localFilename = filename.endsWith('.html') ? filename : `${filename}.html`;
      const localPath = path.join(this.syncFolder, localFilename);

      // Create backup if file exists locally
      await createBackupIfNeeded(localPath, localFilename, this.syncFolder, this.emit.bind(this));

      // Write file with server modification time
      await writeFile(localPath, content, modifiedAt);

      console.log(`[SYNC] Downloaded ${localFilename}`);

      // Emit success event
      this.emit('file-synced', {
        file: localFilename,
        action: 'download'
      });

    } catch (error) {
      console.error(`[SYNC] Failed to download ${filename}:`, error);

      const errorInfo = classifyError(error, { filename, action: 'download' });
      this.stats.errors.push(formatErrorForLog(error, { filename, action: 'download' }));

      // Emit structured error
      this.emit('sync-error', errorInfo);
    }
  }

  /**
   * Upload a file to server
   */
  async uploadFile(filename) {
    try {
      // Validate filename before uploading
      const validationResult = validateFileName(filename, false);

      if (!validationResult.valid) {
        const validationError = new Error(validationResult.error);
        validationError.isValidationError = true;

        console.error(`[SYNC] Validation failed for ${filename}: ${validationResult.error}`);

        // Emit validation error
        this.emit('sync-error', {
          file: filename,
          error: validationResult.error,
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          action: 'upload',
          canRetry: false
        });

        // Don't throw - just skip this file
        return;
      }

      // Check if this is a folder path (future support)
      if (filename.includes('/')) {
        const pathValidation = validateFullPath(filename);
        if (!pathValidation.valid) {
          console.error(`[SYNC] Path validation failed for ${filename}: ${pathValidation.error}`);

          this.emit('sync-error', {
            file: filename,
            error: pathValidation.error,
            type: 'validation',
            priority: ERROR_PRIORITY.HIGH,
            action: 'upload',
            canRetry: false
          });

          return;
        }
      }

      const localPath = path.join(this.syncFolder, filename);
      const content = await readFile(localPath);
      const stat = await getFileStats(localPath);

      await uploadToServer(
        this.serverUrl,
        this.apiKey,
        filename,
        content,
        stat.mtime
      );

      console.log(`[SYNC] Uploaded ${filename}`);
      this.stats.filesUploaded++;

      // Emit success event
      this.emit('file-synced', {
        file: filename,
        action: 'upload'
      });

    } catch (error) {
      console.error(`[SYNC] Failed to upload ${filename}:`, error);

      // Check for detailed error structure (name conflicts)
      if (error.details) {
        this.emit('sync-conflict', {
          file: filename,
          conflict: 'name_taken',
          suggestions: error.details.suggestions,
          message: error.details.message
        });
      }

      const errorInfo = classifyError(error, { filename, action: 'upload' });
      this.stats.errors.push(formatErrorForLog(error, { filename, action: 'upload' }));

      // Emit structured error
      this.emit('sync-error', errorInfo);

      // Re-throw for retry logic
      throw error;
    }
  }

  /**
   * Queue a file for sync
   */
  queueSync(type, filename) {
    // Don't queue if sync is not running
    if (!this.isRunning) return;

    // Validate filename before queueing (for add/change operations)
    if (type === 'add' || type === 'change') {
      const validationResult = filename.includes('/')
        ? validateFullPath(filename)
        : validateFileName(filename, false);

      if (!validationResult.valid) {
        console.error(`[SYNC] Cannot queue ${filename}: ${validationResult.error}`);

        // Emit validation error immediately
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

    // Add to queue
    if (!this.syncQueue.add(type, filename)) {
      return; // Already in queue or invalid file
    }

    // Process queue after a short delay (debounce)
    this.syncQueue.setQueueTimer(() => {
      if (this.isRunning) {
        this.processQueue();
      }
    });
  }

  /**
   * Process sync queue with retry logic
   */
  async processQueue() {
    // Don't process if stopped or already processing
    if (!this.isRunning || this.syncQueue.isProcessingQueue() || this.syncQueue.isEmpty()) {
      return;
    }

    this.syncQueue.setProcessing(true);

    while (!this.syncQueue.isEmpty()) {
      const item = this.syncQueue.next();

      try {
        if (item.type === 'add' || item.type === 'change') {
          await this.uploadFile(item.filename);
        }

        // Success - clear retry tracking
        this.syncQueue.clearRetry(item.filename);

      } catch (error) {
        // Handle retry
        const retryResult = this.syncQueue.scheduleRetry(
          item,
          error,
          (retryItem) => {
            // Only retry if sync is still running and file exists
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
          // Permanent failure
          console.error(`[SYNC] Permanent failure for ${item.filename}: ${retryResult.reason}`);

          this.emit('sync-failed', {
            file: item.filename,
            error: error.message,
            priority: ERROR_PRIORITY.CRITICAL,
            finalFailure: true,
            attempts: retryResult.attempts
          });
        } else {
          // Scheduled for retry
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
    this.syncQueue.setProcessing(false);
  }

  /**
   * Start watching local files
   */
  startFileWatcher() {
    this.watcher = chokidar.watch('*.html', {
      cwd: this.syncFolder,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: SYNC_CONFIG.FILE_STABILIZATION
    });

    this.watcher
      .on('add', filename => {
        console.log(`[SYNC] File added: ${filename}`);
        this.queueSync('add', filename);
      })
      .on('change', filename => {
        console.log(`[SYNC] File changed: ${filename}`);
        this.queueSync('change', filename);
      })
      .on('unlink', filename => {
        // Intentionally ignore deletes (per design spec)
        console.log(`[SYNC] File deleted locally (not syncing to server): ${filename}`);
      })
      .on('error', error => {
        console.error('[SYNC] Watcher error:', error);
        this.stats.errors.push(formatErrorForLog(error, { action: 'watcher' }));
      });

    console.log('[SYNC] File watcher started');
  }

  /**
   * Start polling for remote changes
   */
  startPolling() {
    this.pollTimer = setInterval(async () => {
      await this.checkForRemoteChanges();
    }, SYNC_CONFIG.POLL_INTERVAL);

    console.log('[SYNC] Polling started');
  }

  /**
   * Check for changes on the server
   */
  async checkForRemoteChanges() {
    if (this.syncQueue.isProcessingQueue()) return;

    try {
      const serverFiles = await fetchServerFiles(this.serverUrl, this.apiKey);
      const localFiles = await getLocalFiles(this.syncFolder);
      let changesFound = false;

      for (const serverFile of serverFiles) {
        // Server returns filename WITHOUT .html
        const localFilename = `${serverFile.filename}.html`;
        const localPath = path.join(this.syncFolder, localFilename);
        const localExists = localFiles.has(localFilename);

        if (!localExists) {
          // New file on server
          await this.downloadFile(serverFile.filename);
          this.stats.filesDownloaded++;
          changesFound = true;
        } else {
          const localInfo = localFiles.get(localFilename);
          const localContent = await readFile(localPath);
          const localChecksum = await calculateChecksum(localContent);

          // Check if content is different
          if (localChecksum !== serverFile.checksum) {
            // Check if local is newer
            if (isLocalNewer(localInfo.mtime, serverFile.modifiedAt, this.clockOffset)) {
              console.log(`[SYNC] PRESERVE ${localFilename} - local is newer`);
              this.stats.filesProtected++;
            } else {
              // Download newer version from server
              await this.downloadFile(serverFile.filename);
              this.stats.filesDownloaded++;
              changesFound = true;
            }
          }
        }
      }

      if (changesFound) {
        this.emit('sync-stats', this.stats);
      }

      this.stats.lastSync = new Date().toISOString();
    } catch (error) {
      console.error('[SYNC] Failed to check for remote changes:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'poll' }));
    }
  }

  /**
   * Stop sync
   */
  async stop() {
    if (!this.isRunning) return;

    // Mark as not running immediately
    this.isRunning = false;

    // Stop file watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear all pending operations
    this.syncQueue.clear();

    console.log('[SYNC] Sync stopped');

    return {
      success: true,
      stats: this.stats
    };
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      syncFolder: this.syncFolder,
      username: this.username,
      stats: {
        ...this.stats,
        recentErrors: this.stats.errors.slice(-5) // Last 5 errors
      },
      queueStatus: {
        queueLength: this.syncQueue.length(),
        isProcessing: this.syncQueue.isProcessingQueue(),
        retryItems: this.syncQueue.getRetryItems()
      }
    };
  }

  /**
   * Clear API key from memory
   */
  clearApiKey() {
    this.apiKey = null;
    this.apiKeyEncrypted = null;
    this.username = null;
  }

  /**
   * Check if file has permanent failure
   */
  hasFailedPermanently(filename) {
    return this.syncQueue.hasFailedPermanently(filename);
  }
}

// Export singleton instance
const syncEngine = new SyncEngine();
module.exports = syncEngine;
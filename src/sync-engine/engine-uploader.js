/**
 * Per-file transfer operations (upload/download for sites, uploads, folders).
 *
 * These are the "worker" methods called by the queue processor, the initial
 * sync flow, and the SSE/poll handlers. Methods here are installed onto
 * SyncEngine.prototype.
 */

const path = require('upath');
const { liveSync } = require('livesync-hyperclay');
const { createBackupIfExists, createBinaryBackupIfExists } = require('../main/utils/backup');
const { classifyError, formatErrorForLog } = require('./error-handler');
const {
  readFile,
  writeFile,
  getFileStats,
  readFileBuffer,
  writeFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
const {
  createNode,
  getNodeContent,
  putNodeContent
} = require('./api-client');
const { calculateChecksum } = require('./utils');
const { validateFileName, validateFullPath, validateUploadPath } = require('./validation');
const { ERROR_PRIORITY } = require('./constants');
const nodeMap = require('./node-map');

module.exports = {
  /**
   * Download a site file from server by nodeId.
   *
   * The local path is resolved from `this.serverFilesCache`, which the caller
   * must have populated via `fetchAndCacheServerFiles()` earlier in the same
   * sync cycle — all current call sites do this when they build the serverFiles
   * list they're iterating over.
   *
   * @param {number} nodeId - Server node id
   */
  async downloadFile(nodeId) {
    const serverFile = this.serverFilesCache?.find(f => f.nodeId === nodeId);
    if (!serverFile) {
      throw new Error(`downloadFile: nodeId ${nodeId} not in server files cache — call fetchAndCacheServerFiles first`);
    }
    const relativePath = serverFile.path;

    try {
      const { content, modifiedAt } = await getNodeContent(
        this.serverUrl,
        this.apiKey,
        nodeId
      );

      this.resolveContainedPath(relativePath);
      const localPath = path.join(this.syncFolder, relativePath);

      // Create backup if file exists locally
      // Remove .html extension for siteName (matches server.js behavior)
      const siteName = relativePath.replace(/\.(html|htmlclay)$/i, '');
      await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this), this.logger);

      // Mark as expected write so file watcher doesn't send "File changed on disk" notification
      liveSync.markBrowserSave(siteName);

      // Write file with server modification time (ensures directories exist)
      await writeFile(localPath, content, modifiedAt);

      console.log(`[SYNC] Downloaded ${relativePath}`);

      // Log download success
      if (this.logger) {
        this.logger.success('DOWNLOAD', 'File downloaded', {
          file: this.logger.sanitizePath(localPath),
          modifiedAt
        });
      }

      // Emit success event
      this.emit('file-synced', {
        file: relativePath,
        action: 'download'
      });

    } catch (error) {
      if (error.statusCode === 404) {
        await this.repo.delete(nodeId).catch(() => {});
      }

      console.error(`[SYNC] Failed to download ${relativePath}:`, error);

      // Log download error
      if (this.logger) {
        this.logger.error('DOWNLOAD', 'Download failed', {
          file: relativePath,
          error
        });
      }

      const errorInfo = classifyError(error, { filename: relativePath, action: 'download' });
      this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'download' }));

      // Emit structured error
      this.emit('sync-error', errorInfo);
    }
  },

  /**
   * Upload a file to server
   * @param {string} filename - Relative path WITH .html (may include folders)
   */
  async uploadFile(filename) {
    try {
      // Validate filename before uploading
      const validationResult = filename.includes('/')
        ? validateFullPath(filename)
        : validateFileName(filename, false);

      if (!validationResult.valid) {
        const validationError = new Error(validationResult.error);
        validationError.isValidationError = true;

        console.error(`[SYNC] Validation failed for ${filename}: ${validationResult.error}`);

        // Log validation error
        if (this.logger) {
          this.logger.error('VALIDATION', 'Filename validation failed', {
            file: filename,
            reason: validationResult.error
          });
        }

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

      const localPath = path.join(this.syncFolder, filename);
      const content = await readFile(localPath);
      const stat = await getFileStats(localPath);

      // Calculate checksum for skip optimization
      const localChecksum = await calculateChecksum(content);

      // Check if server already has this exact content using cached data
      try {
        const serverFiles = await this.fetchAndCacheServerFiles(false);
        const serverFile = serverFiles.find(f => f.filename === filename);

        if (serverFile && serverFile.checksum === localChecksum) {
          console.log(`[SYNC] SKIP upload ${filename} - server has same checksum`);
          this.stats.filesUploadedSkipped++;

          // Log upload skip
          if (this.logger) {
            this.logger.skip('UPLOAD', 'Upload skipped - checksums match', {
              file: this.logger.sanitizePath(localPath)
            });
          }

          return;
        }
      } catch (error) {
        // If checksum check fails, continue with upload
        console.log(`[SYNC] Could not verify server checksum, proceeding with upload: ${error.message}`);
        if (this.logger) {
          this.logger.warn('UPLOAD', 'Server checksum check failed - uploading anyway', {
            file: filename,
            error: error.message,
            statusCode: error.statusCode
          });
        }
      }

      // Try to get cached snapshot for platform live sync.
      // Lazy require — main/server.js may pull in Electron-only modules that
      // can't load at top level during unit tests.
      let snapshotHtml = null;
      try {
        const { getAndClearSnapshot } = require('../main/server.js');
        snapshotHtml = getAndClearSnapshot(filename);
        if (snapshotHtml) {
          console.log(`[SYNC] Including snapshot for platform live sync: ${filename}`);
        }
      } catch (err) {
        // Server module not available or getAndClearSnapshot not exported
      }

      // Check repo for an existing nodeId for this file path
      let existingNodeId = null;
      const existing = this.repo.getByPath(filename);
      if (existing) {
        existingNodeId = parseInt(existing.nodeId);
      }

      let result;
      if (existingNodeId) {
        this.outbox.markInFlight('save', existingNodeId);
        result = await putNodeContent(
          this.serverUrl,
          this.apiKey,
          existingNodeId,
          content,
          {
            modifiedAt: stat.mtime,
            snapshotHtml,
            senderId: this.deviceId
          }
        );
        result.nodeId = existingNodeId;
      } else {
        const pathParts = filename.split('/').filter(Boolean);
        const name = pathParts[pathParts.length - 1];
        const folderPath = pathParts.slice(0, -1).join('/');
        const parentId = this.resolveParentIdByPath(folderPath);

        const createdNode = await createNode(this.serverUrl, this.apiKey, {
          type: 'site',
          name,
          parentId,
          content,
          modifiedAt: stat.mtime
        });
        this.outbox.markInFlight('save', createdNode.id);
        result = { nodeId: createdNode.id };
      }

      if (result.nodeId) {
        const inode = await nodeMap.getInode(path.join(this.syncFolder, filename));
        await this.repo.set(result.nodeId, { type: 'site', path: filename, checksum: localChecksum, inode });
      }

      console.log(`[SYNC] Uploaded ${filename}`);
      this.stats.filesUploaded++;

      // Log upload success
      if (this.logger) {
        this.logger.success('UPLOAD', 'File uploaded', {
          file: this.logger.sanitizePath(localPath),
          modifiedAt: stat.mtime
        });
      }

      // Invalidate cache since server state changed
      this.invalidateServerFilesCache();

      // Emit success event
      this.emit('file-synced', {
        file: filename,
        action: 'upload'
      });

    } catch (error) {
      console.error(`[SYNC] Failed to upload ${filename}:`, error);

      // Log upload error
      if (this.logger) {
        this.logger.error('UPLOAD', 'Upload failed', {
          file: filename,
          error
        });
      }

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
  },

  /**
   * Download an upload file from server
   */
  async downloadUploadFile(serverPath, nodeId) {
    this.resolveContainedPath(serverPath);
    try {
      const { content, modifiedAt } = await getNodeContent(
        this.serverUrl,
        this.apiKey,
        nodeId
      );

      const localPath = path.join(this.syncFolder, serverPath);

      // Create binary backup if file exists (preserves images, PDFs, etc.)
      await createBinaryBackupIfExists(localPath, serverPath, this.syncFolder, this.emit.bind(this), this.logger);

      // Write file
      await writeFileBuffer(localPath, content, modifiedAt);

      console.log(`[SYNC] Downloaded upload: ${serverPath}`);

      if (this.logger) {
        this.logger.success('DOWNLOAD', 'Upload downloaded', { file: serverPath });
      }

      this.emit('file-synced', { file: serverPath, action: 'download', type: 'upload' });

    } catch (error) {
      if (error.statusCode === 404) {
        await this.repo.delete(nodeId).catch(() => {});
      }

      console.error(`[SYNC] Failed to download upload ${serverPath}:`, error);

      if (this.logger) {
        this.logger.error('DOWNLOAD', 'Upload download failed', { file: serverPath, error });
      }

      const errorInfo = classifyError(error, { filename: serverPath, action: 'download-upload' });
      this.stats.errors.push(formatErrorForLog(error, { filename: serverPath, action: 'download-upload' }));
      this.emit('sync-error', errorInfo);
    }
  },

  /**
   * Upload an upload file to server
   */
  async uploadUploadFile(relativePath) {
    try {
      // Validate path
      const validationResult = validateUploadPath(relativePath);
      if (!validationResult.valid) {
        console.error(`[SYNC] Validation failed for upload ${relativePath}: ${validationResult.error}`);
        this.emit('sync-error', {
          file: relativePath,
          error: validationResult.error,
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          canRetry: false
        });
        return;
      }

      const localPath = path.join(this.syncFolder, relativePath);
      const content = await readFileBuffer(localPath);
      const stat = await getFileStats(localPath);

      // Check size limit (10MB)
      if (content.length > 10 * 1024 * 1024) {
        this.emit('sync-error', {
          file: relativePath,
          error: 'File exceeds 10MB limit',
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          canRetry: false
        });
        return;
      }

      // Check if server has same content
      const localChecksum = calculateBufferChecksum(content);

      try {
        const serverUploads = await this.fetchAndCacheServerUploads(false);
        const serverUpload = serverUploads.find(u => u.path === relativePath);

        if (serverUpload && serverUpload.checksum === localChecksum) {
          console.log(`[SYNC] SKIP upload ${relativePath} - server has same checksum`);
          this.stats.uploadsSkipped++;
          return;
        }
      } catch (error) {
        console.log(`[SYNC] Could not verify server checksum, proceeding: ${error.message}`);
        if (this.logger) {
          this.logger.warn('UPLOAD', 'Server checksum check failed - uploading anyway', {
            file: relativePath,
            error: error.message,
            statusCode: error.statusCode
          });
        }
      }

      // Check repo for an existing nodeId for this upload path
      let existingNodeId = null;
      const existing = this.repo.getByPath(relativePath);
      if (existing) {
        existingNodeId = parseInt(existing.nodeId);
      }

      let resultNodeId = existingNodeId;
      if (existingNodeId) {
        this.outbox.markInFlight('save', existingNodeId);
        await putNodeContent(
          this.serverUrl,
          this.apiKey,
          existingNodeId,
          content,
          { modifiedAt: stat.mtime }
        );
      } else {
        const pathParts = relativePath.split('/').filter(Boolean);
        const name = pathParts[pathParts.length - 1];
        const folderPath = pathParts.slice(0, -1).join('/');
        const parentId = this.resolveParentIdByPath(folderPath);

        const createdNode = await createNode(this.serverUrl, this.apiKey, {
          type: 'upload',
          name,
          parentId,
          content,
          modifiedAt: stat.mtime
        });
        this.outbox.markInFlight('save', createdNode.id);
        resultNodeId = createdNode.id;
      }

      if (resultNodeId) {
        await this.repo.set(resultNodeId, { type: 'upload', path: relativePath, checksum: localChecksum, inode: null });
      }

      console.log(`[SYNC] Uploaded: ${relativePath}`);
      this.stats.uploadsUploaded++;

      // Invalidate cache
      this.invalidateServerUploadsCache();

      this.emit('file-synced', { file: relativePath, action: 'upload', type: 'upload' });

    } catch (error) {
      console.error(`[SYNC] Failed to upload ${relativePath}:`, error);

      if (this.logger) {
        this.logger.error('UPLOAD', 'Upload failed', { file: relativePath, error });
      }

      const errorInfo = classifyError(error, { filename: relativePath, action: 'upload-upload' });
      this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'upload-upload' }));
      this.emit('sync-error', errorInfo);
      throw error;
    }
  },

  async createFolderOnServer(relativePath) {
    try {
      const pathParts = relativePath.split('/').filter(Boolean);

      for (let i = 1; i < pathParts.length; i++) {
        const ancestorPath = pathParts.slice(0, i).join('/');
        if (!this.repo.getByPath(ancestorPath)) {
          await this.createFolderOnServer(ancestorPath);
        }
      }

      const name = pathParts[pathParts.length - 1];
      const parentFolderPath = pathParts.slice(0, -1).join('/');

      const parentId = this.resolveParentIdByPath(parentFolderPath);

      const existingFolder = this.repo.getByPath(relativePath);
      if (existingFolder && existingFolder.entry.type === 'folder') {
        console.log(`[SYNC] Folder already tracked in nodeMap: ${relativePath}`);
        return;
      }

      console.log(`[SYNC] Creating folder on server: ${relativePath} (parentId=${parentId})`);
      const createdNode = await createNode(this.serverUrl, this.apiKey, {
        type: 'folder',
        name,
        parentId
      });

      this.outbox.markInFlight('save', createdNode.id);

      const fullPath = path.join(this.syncFolder, relativePath);
      const inode = await nodeMap.getInode(fullPath);
      await this.repo.set(createdNode.id, {
        type: 'folder',
        path: relativePath,
        parentId: createdNode.parentId,
        inode
      });

      this.invalidateServerNodesCache();
      this.emit('file-synced', { file: relativePath, action: 'create', type: 'folder' });

    } catch (error) {
      console.error(`[SYNC] Failed to create folder ${relativePath}:`, error.message);
      if (this.logger) {
        this.logger.error('SYNC', 'Folder create failed', { file: relativePath, error });
      }
      const errorInfo = classifyError(error, { filename: relativePath, action: 'create-folder' });
      this.stats.errors.push(formatErrorForLog(error, { filename: relativePath, action: 'create-folder' }));
      this.emit('sync-error', errorInfo);
      throw error;
    }
  }
};

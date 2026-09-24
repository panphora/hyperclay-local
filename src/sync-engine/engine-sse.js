/**
 * SSE transport + remote event handlers + fallback polling.
 *
 * The server tells us about remote state changes via SSE; this module owns
 * the connection, the dispatch into per-op handlers, and the watchdog that
 * falls back to polling if the stream goes quiet. Methods are installed onto
 * SyncEngine.prototype.
 */

const path = require('upath');
const { EventSource } = require('eventsource');
const { createBackupIfExists, createBinaryBackupIfExists } = require('../main/utils/backup');
const dataGuard = require('../main/data-loss-guard');
const { refreshDerivedArtifacts } = require('../main/utils/derived-artifacts');
const { classifyError, formatErrorForLog } = require('./error-handler');
const { dispatchControlEnvelope } = require('./control-lane');
const {
  getLocalFiles,
  readFile,
  writeFile,
  fileExists,
  ensureDirectory,
  moveFile,
  getLocalUploads,
  readFileBuffer,
  writeFileBuffer,
  calculateBufferChecksum
} = require('./file-operations');
const { syncUrl, authHeaders, getNodeContent } = require('./api-client');
const { calculateChecksum } = require('./utils');
const { decide, A } = require('./reconcile/decide');
const { SYNC_CONFIG } = require('./constants');
const nodeMap = require('./node-map');
const { getConsentRegistry, resolveWritePath } = require('../main/utils/path-resolver');
const { withFileLock } = require('../main/utils/write-queue');

/**
 * The machine fields of a refused connect: the HTTP status, plus the `code` its
 * JSON body carries (CONTRACTS §3). A body that is not JSON carries no code.
 */
async function readStreamRefusal(response) {
  const refusal = { statusCode: response.status };
  try {
    const body = await response.clone().json();
    if (body && body.code) refusal.code = body.code;
  } catch {
    // No parseable body: the status has to answer on its own.
  }
  return refusal;
}

module.exports = {
  async _applyRemoteFsChange(paths, fn) {
    this.cascade.mark(paths);
    return fn();
  },

  _skipIfEcho(actionType, nodeId) {
    if (this.outbox.consumeIfInFlight(actionType, nodeId)) {
      console.log(`[SYNC] SSE: Skipping self-initiated ${actionType} for nodeId ${nodeId}`);
      return true;
    }
    return false;
  },

  // Inbound control-lane frame on the per-user stream. Best-effort: the lane's
  // dispatch swallows unknown types / handler errors, and onmessage has its own
  // try/catch, so one bad rider can never abort stream processing.
  async handleControlFrame(frame) {
    await dispatchControlEnvelope(frame && frame.envelope, { engine: this, baseDir: this.syncFolder });
  },

  async handleNodeSaved(data) {
    if (this._skipIfEcho('save', data.nodeId)) return;

    this.echoWindow.mark(data.nodeType, data.nodeId);

    console.log(`[SYNC] SSE: node-saved (${data.nodeType}) for ${data.path} (nodeId ${data.nodeId})`);

    try {
      if (data.nodeType === 'site') {
        await this._applyNodeSavedSite(data);
      } else if (data.nodeType === 'upload') {
        await this._applyNodeSavedUpload(data);
      } else if (data.nodeType === 'folder') {
        await this._applyNodeSavedFolder(data);
      } else {
        console.warn(`[SYNC] SSE: Unknown nodeType in node-saved: ${data.nodeType}`);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-saved for ${data.path}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-saved', { path: data.path, error });
      }
      const errorInfo = classifyError(error, { filename: data.path, action: 'sse-node-saved' });
      this.stats.errors.push(formatErrorForLog(error, { filename: data.path, action: 'sse-node-saved' }));
      this.emit('sync-error', errorInfo);
    }
  },

  // Every repo.set in this file records syncedAt: Date.now() so delete-conflict checks use per-file timestamps, not the stale global lastSyncedAt.
  async _applyNodeSavedSite(data) {
    const localFilename = data.path;
    this.resolveContainedPath(localFilename);
    // A1/A3: canonical resolved path — the file to write AND the queue key,
    // resolved through the same registry the route server uses.
    const localPath = await resolveWritePath(getConsentRegistry(this.syncFolder), localFilename);

    if (typeof data.content !== 'string') {
      throw new Error(`node-saved for site ${data.nodeId} missing inline content`);
    }

    // A1: read, checksum-compare, back up and write are ONE critical section.
    // Reading the local body outside it would let a concurrent /save land in
    // between, so an up-to-date check could pass against bytes that are already
    // stale by the time the write happens.
    const applied = await withFileLock(localPath, async () => {
      let preApplyContent = null;
      try {
        const localContent = await readFile(localPath);
        preApplyContent = typeof localContent === 'string' ? localContent : localContent.toString('utf8');
        const localChecksum = await calculateChecksum(localContent);
        if (localChecksum === data.checksum) {
          console.log(`[SYNC] SSE node-saved: ${data.path} already up to date`);
          const inode = await nodeMap.getInode(localPath);
          await this.repo.set(data.nodeId, {
            type: 'site',
            path: localFilename,
            checksum: localChecksum,
            inode,
            syncedAt: Date.now()
          });
          return { upToDate: true, preApplyContent };
        }
      } catch (e) {
        // File doesn't exist locally yet — fall through to write
      }

      // ANCILLARY: siteName without extension → maps to sites-versions/{siteName}/.
      const siteName = localFilename.replace(/\.(html|htmlclay)$/i, '');
      await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this), this.logger);

      await ensureDirectory(path.dirname(localPath));

      // liveSync channel key = full path with extension (Rule 1 / Rule 2).
      this.live.markBrowserSave(localFilename);

      await writeFile(localPath, data.content, new Date(data.modifiedAt));

      // A1: derived artifacts belong in the same critical section as the write
      // that causes them. Skipping them here leaves an H0 sidecar and an H0
      // stylesheet serving against H1 bytes — and because writeFile stamps the
      // remote modifiedAt, an H0 sidecar can outrank H1 by mtime permanently.
      await refreshDerivedArtifacts(this.syncFolder, localFilename, data.content);

      const inode = await nodeMap.getInode(localPath);
      const cs = await calculateChecksum(data.content);
      await this.repo.set(data.nodeId, {
        type: 'site',
        path: localFilename,
        checksum: cs,
        inode,
        syncedAt: Date.now()
      });

      return { upToDate: false, preApplyContent };
    });

    if (applied.upToDate) return;
    const preApplyContent = applied.preApplyContent;

    // Morph view-mode tabs with the just-persisted content. Edit-mode tabs get
    // the platform's live-sync relay (pre-strip snapshot) on the live lane.
    this.live.broadcast(localFilename, { html: data.content, sender: 'sync-engine' }, { lane: 'saved' });

    console.log(`[SYNC] SSE node-saved: Wrote site ${localFilename}`);
    this.stats.filesDownloaded++;

    // Data-clobber guard: a synced-down apply is an off-page (external) write
    // from the local perspective. The pre-apply body is the last-good local copy.
    if (typeof data.content === 'string') {
      dataGuard.runDataLossGuard({
        baseDir: this.syncFolder,
        name: localFilename,
        newHtml: data.content,
        prevContent: preApplyContent,
        prov: 'external',
      }).catch(err => console.error('[data-guard] sse guard error:', err && err.message ? err.message : err));
    }

    this.emit('file-synced', {
      file: localFilename,
      action: 'download',
      source: 'sse',
      type: 'site'
    });
  },

  async _applyNodeSavedUpload(data) {
    const gen = this.generation;
    const localFilename = data.path;
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);

    try {
      const localContent = await readFileBuffer(localPath);
      const localChecksum = calculateBufferChecksum(localContent);
      if (localChecksum === data.checksum) {
        console.log(`[SYNC] SSE node-saved: upload ${data.path} already up to date`);
        const inode = await nodeMap.getInode(localPath);
        await this.repo.set(data.nodeId, {
          type: 'upload',
          path: localFilename,
          checksum: localChecksum,
          inode,
          syncedAt: Date.now()
        });
        return;
      }
    } catch (e) {
      // File doesn't exist locally — fall through to fetch
    }

    console.log(`[SYNC] SSE node-saved: fetching upload content for nodeId ${data.nodeId}`);
    const fetched = await getNodeContent(this.conn, data.nodeId);
    if (gen !== this.generation) return;

    await createBinaryBackupIfExists(localPath, localFilename, this.syncFolder, this.emit.bind(this), this.logger);

    await writeFileBuffer(localPath, fetched.content, fetched.modifiedAt);

    const inode = await nodeMap.getInode(localPath);
    await this.repo.set(data.nodeId, {
      type: 'upload',
      path: localFilename,
      checksum: fetched.checksum,
      inode,
      syncedAt: Date.now()
    });

    console.log(`[SYNC] SSE node-saved: Wrote upload ${localFilename}`);
    this.stats.uploadsDownloaded++;

    this.emit('file-synced', {
      file: localFilename,
      action: 'download',
      source: 'sse',
      type: 'upload'
    });
  },

  async _applyNodeSavedFolder(data) {
    if (this.repo.has(data.nodeId)) {
      console.log(`[SYNC] SSE node-saved: folder ${data.path} already tracked, no-op`);
      return;
    }

    const localFolderPath = data.path;
    this.resolveContainedPath(localFolderPath);
    const localPath = path.join(this.syncFolder, localFolderPath);

    await this._applyRemoteFsChange([localFolderPath], () => ensureDirectory(localPath));

    const inode = await nodeMap.getInode(localPath);
    await this.repo.set(data.nodeId, {
      type: 'folder',
      path: localFolderPath,
      parentId: data.parentId,
      inode
    });

    console.log(`[SYNC] SSE node-saved: Created folder ${localFolderPath}`);
    this.emit('file-synced', {
      file: localFolderPath,
      action: 'create',
      source: 'sse',
      type: 'folder'
    });
  },

  async handleNodeRenamed(data) {
    if (this._skipIfEcho('rename', data.nodeId)) return;

    console.log(`[SYNC] SSE: node-renamed (${data.nodeType}): ${data.oldPath} → ${data.newPath}`);

    try {
      if (data.nodeType === 'folder') {
        await this._applyFolderRelocate(data.nodeId, data.oldPath, data.newPath);
      } else {
        await this._applyFileRelocate(data.nodeId, data.oldPath, data.newPath, data.nodeType);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-renamed for ${data.oldPath}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-renamed', { path: data.oldPath, error });
      }
      this.emit('sync-error', classifyError(error, { filename: data.oldPath, action: 'sse-node-renamed' }));
    }
  },

  async handleNodeMoved(data) {
    if (this._skipIfEcho('move', data.nodeId)) return;

    console.log(`[SYNC] SSE: node-moved (${data.nodeType}): ${data.oldPath} → ${data.newPath}`);

    try {
      if (data.nodeType === 'folder') {
        await this._applyFolderRelocate(data.nodeId, data.oldPath, data.newPath);
      } else {
        await this._applyFileRelocate(data.nodeId, data.oldPath, data.newPath, data.nodeType);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-moved for ${data.oldPath}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-moved', { path: data.oldPath, error });
      }
      this.emit('sync-error', classifyError(error, { filename: data.oldPath, action: 'sse-node-moved' }));
    }
  },

  async handleNodeDeleted(data) {
    if (this._skipIfEcho('delete', data.nodeId)) return;

    console.log(`[SYNC] SSE: node-deleted (${data.nodeType}): ${data.path}`);

    try {
      if (data.nodeType === 'folder') {
        await this._applyFolderDelete(data.nodeId, data.path);
      } else {
        await this._applyFileDelete(data.nodeId, data.path, data.nodeType);
      }
    } catch (error) {
      console.error(`[SYNC] SSE: Failed to apply node-deleted for ${data.path}:`, error.message);
      if (this.logger) {
        this.logger.error('SSE', 'Failed to apply node-deleted', { path: data.path, error });
      }
      this.emit('sync-error', classifyError(error, { filename: data.path, action: 'sse-node-deleted' }));
    }
  },

  async _applyFileDelete(nodeId, fullPath, nodeType) {
    const entry = this.repo.get(nodeId);
    const localFilename = entry?.path || fullPath;
    this.resolveContainedPath(localFilename);
    const localPath = path.join(this.syncFolder, localFilename);
    const trashPath = path.join(this.syncFolder, '.trash', localFilename);

    const exists = await fileExists(localPath);
    if (!exists) {
      console.log(`[SYNC] SSE node-deleted: ${localFilename} not found locally`);
      await this.repo.delete(nodeId);
      return;
    }

    await ensureDirectory(path.dirname(trashPath));

    // cascade.mark via _applyRemoteFsChange is the sole suppression mechanism
    // for SSE-driven FS changes — it runs before the watcher's wasBrowserSave
    // check. No markBrowserSave needed here.
    await this._applyRemoteFsChange([localFilename], () => moveFile(localPath, trashPath));

    await this.repo.delete(nodeId);

    console.log(`[SYNC] SSE node-deleted: Trashed ${localFilename}`);
    this.emit('file-synced', { file: localFilename, action: 'trash', source: 'sse', type: nodeType });
  },

  async _applyFolderDelete(nodeId, fullPath) {
    const entry = this.repo.get(nodeId);
    const localFolderPath = entry?.path || fullPath;
    this.resolveContainedPath(localFolderPath);
    const localPath = path.join(this.syncFolder, localFolderPath);
    const trashPath = path.join(this.syncFolder, '.trash', localFolderPath);

    const descendants = this.repo.walkDescendants(localFolderPath);

    const oldSidePaths = [
      localFolderPath,
      ...descendants.map(({ entry: e }) => e.path)
    ];
    const exists = await fileExists(localPath);
    if (!exists) {
      console.log(`[SYNC] SSE node-deleted: folder ${localFolderPath} not found locally, cleaning nodeMap only`);
      await this.repo.apply(async (map) => {
        for (const { nodeId: descId } of descendants) {
          map.delete(descId);
        }
        map.delete(String(nodeId));
      });
      return;
    }

    await ensureDirectory(path.dirname(trashPath));

    await this._applyRemoteFsChange(oldSidePaths, async () => {
      try {
        await moveFile(localPath, trashPath);
      } catch (error) {
        const timestampedTrashPath = `${trashPath}.${Date.now()}`;
        console.warn(`[SYNC] SSE node-deleted: trash collision, using ${timestampedTrashPath}`);
        await moveFile(localPath, timestampedTrashPath);
      }
    });

    await this.repo.apply(async (map) => {
      for (const { nodeId: descId } of descendants) {
        map.delete(descId);
      }
      map.delete(String(nodeId));
    });

    console.log(`[SYNC] SSE node-deleted: Trashed folder ${localFolderPath} (${descendants.length} descendant(s))`);
    this.emit('file-synced', { file: localFolderPath, action: 'trash', source: 'sse', type: 'folder' });
  },

  /**
   * Make room at `relPath` for a tracked file or folder the server says lives there. Whatever
   * already occupies it (a file the user made, a folder the watcher never sent) is renamed to a
   * "conflicted copy" beside it, never overwritten. Returns the name it was moved to, or null.
   */
  async _moveOccupantAside(relPath) {
    this.resolveContainedPath(relPath);
    const full = path.join(this.syncFolder, relPath);
    if (!(await fileExists(full))) return null;
    const ext = path.extname(relPath);
    const stem = relPath.slice(0, relPath.length - ext.length);
    let aside = `${stem} (conflicted copy)${ext}`;
    for (let n = 2; n <= 100; n++) {
      if (!(await fileExists(path.join(this.syncFolder, aside)))) break;
      aside = `${stem} (conflicted copy ${n})${ext}`;
    }
    this.cascade.mark([relPath, aside]);
    await moveFile(full, path.join(this.syncFolder, aside));
    console.warn(`[SYNC] ${relPath} was occupied; moved the occupant to ${aside}`);
    this.emit('file-synced', { file: aside, action: 'conflict-copy', source: 'relocate' });
    return aside;
  },

  async _applyFileRelocate(nodeId, oldPath, newPath, nodeType) {
    this.resolveContainedPath(newPath);
    const entry = this.repo.get(nodeId);
    const currentPath = entry?.path || oldPath;
    const localPath = path.join(this.syncFolder, currentPath);
    const newLocalPath = path.join(this.syncFolder, newPath);

    // Tombstone the old path so a stale tab still holding the pre-move URL gets a 409 on /save instead of creating a ghost node.
    if (currentPath && currentPath !== newPath) {
      await this.repo.addTombstone(currentPath);
    }

    const exists = await fileExists(localPath);
    if (!exists) {
      const alreadyMoved = await fileExists(newLocalPath);
      if (alreadyMoved) {
        console.log(`[SYNC] SSE node-relocated: ${newPath} already in place`);
      } else {
        console.log(`[SYNC] SSE node-relocated: ${currentPath} not found locally`);
      }
      const inode = await nodeMap.getInode(newLocalPath);
      await this.repo.set(nodeId, {
        ...(entry || { checksum: null }),
        type: nodeType,
        path: newPath,
        inode,
        syncedAt: alreadyMoved ? Date.now() : entry?.syncedAt
      });
      return;
    }

    // cascade.mark below is the sole suppression mechanism for SSE-driven FS
    // changes — it runs before the watcher's wasBrowserSave check in every
    // handler. No markBrowserSave needed.
    this.cascade.mark([currentPath, newPath]);

    await this._moveOccupantAside(newPath);
    await ensureDirectory(path.dirname(newLocalPath));
    await moveFile(localPath, newLocalPath);

    const inode = await nodeMap.getInode(newLocalPath);
    await this.repo.set(nodeId, {
      ...(entry || { checksum: null }),
      type: nodeType,
      path: newPath,
      inode,
      syncedAt: Date.now()
    });

    console.log(`[SYNC] SSE node-relocated: ${currentPath} → ${newPath}`);
  },

  async _applyFolderRelocate(nodeId, oldPath, newPath) {
    this.resolveContainedPath(newPath);
    const entry = this.repo.get(nodeId);
    if (!entry || entry.type !== 'folder') {
      console.warn(`[SYNC] SSE node-relocated: folder nodeId ${nodeId} not in nodeMap or wrong type`);
    }

    const localOldPath = path.join(this.syncFolder, oldPath);
    const localNewPath = path.join(this.syncFolder, newPath);

    const descendants = this.repo.walkDescendants(oldPath);

    const oldToNew = new Map();
    for (const { nodeId: descId, entry: descEntry } of descendants) {
      const newDescPath = newPath + descEntry.path.substring(oldPath.length);
      oldToNew.set(descId, { newPath: newDescPath, entry: descEntry });
    }

    const allSuppressedPaths = [
      oldPath,
      newPath,
      ...descendants.map(({ entry: e }) => e.path),
      ...Array.from(oldToNew.values()).map(v => v.newPath)
    ];
    this.cascade.mark(allSuppressedPaths);

    // Tombstone the folder and every descendant's old path — a stale tab on any
    // descendant URL gets a 409 on /save. Tombstones auto-clear when new nodes
    // eventually land at those paths.
    if (oldPath !== newPath) {
      await this.repo.addTombstones([oldPath, ...descendants.map(({ entry: e }) => e.path)]);
    }

    const exists = await fileExists(localOldPath);
    if (!exists) {
      console.log(`[SYNC] SSE node-relocated: folder ${oldPath} not found locally, updating nodeMap only`);
      await this.repo.apply(async (map) => {
        this._applyFolderRelocateNodeMapUpdates(map, nodeId, newPath, oldToNew);
      });
      return;
    }

    await this._moveOccupantAside(newPath);

    await ensureDirectory(path.dirname(localNewPath));

    await moveFile(localOldPath, localNewPath);

    await this.repo.apply(async (map) => {
      this._applyFolderRelocateNodeMapUpdates(map, nodeId, newPath, oldToNew);
    });

    console.log(`[SYNC] SSE node-relocated: folder ${oldPath} → ${newPath} (${descendants.length} descendant(s) updated)`);

    this.emit('file-synced', {
      file: newPath,
      action: 'relocate',
      source: 'sse',
      type: 'folder'
    });
  },

  _applyFolderRelocateNodeMapUpdates(map, folderNodeId, newPath, oldToNew) {
    for (const [descId, { newPath: descNewPath, entry: descEntry }] of oldToNew) {
      map.set(descId, { ...descEntry, path: descNewPath });
    }

    const folderEntry = map.get(String(folderNodeId));
    if (folderEntry) {
      map.set(String(folderNodeId), { ...folderEntry, path: newPath });
    }
  },

  /**
   * The session's stream adapter (C3 §5.6): one EventSource per session, frames
   * parsed here and handed to `onFrame` as `{ data }`, failures handed to
   * `onError`. A refused connect carries the refusal's HTTP status and the
   * body's `code` (CONTRACTS §3), so a 402 or 403 at connect goes through the
   * same classifier as a 402 or 403 on a request; a network error stays
   * status-less and means offline.
   *
   * A protocol 1 stream never sends `sync-ready`, so its connect is the ready
   * signal: the adapter hands over one synthetic frame on open.
   */
  sessionStream() {
    return {
      open: (options) => this.openStream(options),
      close: () => this.closeStream(),
    };
  },

  openStream({ signal, onFrame, onError } = {}) {
    this.closeStream();

    if (signal && signal.aborted) return;
    if (signal) signal.addEventListener('abort', () => this.closeStream(), { once: true });

    const url = syncUrl(this.conn, '/stream');
    console.log(`[SYNC] Connecting to SSE stream: ${url}`);

    const headers = authHeaders(this.conn);
    this.streamFrame = onFrame;
    this.streamError = onError;

    this.sseConnection = new EventSource(url, {
      fetch: async (input, init) => {
        const response = await fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            ...headers
          }
        });
        if (!response.ok) this.streamRefusal = await readStreamRefusal(response);
        return response;
      }
    });

    this.sseConnection.onopen = () => {
      console.log('[SYNC] SSE stream connected');
      this.lastSseActivity = Date.now();
      this.startSseWatchdog();
      if (this.logger) {
        this.logger.info('SSE', 'Stream connected');
      }
      if (this.protocol !== 2) {
        this.deliverStreamFrame({ type: 'sync-ready', sync: { enabled: true, reason: null } });
      }
    };

    this.sseConnection.onmessage = (event) => {
      this.lastSseActivity = Date.now();

      let parsedType = 'unknown';
      try {
        const data = JSON.parse(event.data);
        parsedType = data.type || 'live-sync';
        this.deliverStreamFrame(data);
      } catch (error) {
        console.error('[SYNC] SSE: Error processing message:', error.message);
        if (this.logger) {
          this.logger.error('SSE', 'Error processing stream message', {
            error,
            messageType: parsedType,
            rawData: event.data ? event.data.substring(0, 200) : null
          });
        }
      }
    };

    this.sseConnection.onerror = (error) => {
      const refusal = this.streamRefusal;
      this.streamRefusal = null;
      if (this.streamError) return this.streamError(refusal || error);
      return this.reconnectStream(error);
    };
  },

  /**
   * Hand one frame to the session runner. `sync-ready` is also when everything
   * this session cached stops being newer than the stream, so the engine stamps
   * it before the frame is delivered.
   */
  deliverStreamFrame(data) {
    if (data && data.type === 'sync-ready') this.syncReadyAt = Date.now();
    if (!this.streamFrame) return;

    try {
      const delivered = this.streamFrame({ data });
      if (delivered && typeof delivered.catch === 'function') {
        delivered.catch((error) => this.reportStreamFrameError(data, error));
      }
    } catch (error) {
      this.reportStreamFrameError(data, error);
    }
  },

  reportStreamFrameError(data, error) {
    console.error('[SYNC] SSE: Error processing message:', error.message);
    if (this.logger) {
      this.logger.error('SSE', 'Error processing stream message', {
        error,
        messageType: data ? data.type : 'unknown',
      });
    }
  },

  /** The legacy frame dispatch: per-op handlers, still used without a runner. */
  async handleStreamFrame(data) {
    if (!this.isRunning) return;
    if (data.type === 'sync-ready' || data.type === 'account-changed') return;

    const sseDispatch = {
      'live-sync': async (frame) => this.relayLiveFrame(frame),
      'node-saved':   async (frame) => this.handleNodeSaved(frame),
      'node-renamed': async (frame) => this.handleNodeRenamed(frame),
      'node-moved':   async (frame) => this.handleNodeMoved(frame),
      'node-deleted': async (frame) => this.handleNodeDeleted(frame),
      'control':      async (frame) => this.handleControlFrame(frame)
    };

    const handler = sseDispatch[data.type || 'live-sync'];
    if (handler) await handler(data);
  },

  /**
   * Relay another device's live-sync frame to the browsers this root serves.
   * Our own echo is dropped; the frame's body is only ever relayed, never
   * written to disk.
   */
  relayLiveFrame(data) {
    const { file, html, sender } = data || {};
    if (sender === this.deviceId) {
      console.log(`[SYNC] SSE: Ignoring own live-sync for ${file}`);
      return;
    }
    console.log(`[SYNC] SSE: Received live-sync for ${file} from ${sender}`);
    this.live.broadcast(file, { html, sender });
    if (this.logger) this.logger.success('SSE', 'Relayed live-sync to local browsers', { file });
  },

  /**
   * Retry the legacy connection after a failure. A session with a runner owns
   * its stream through the adapter above instead: the runner's classifier
   * decides between backoff, pause and rediscover.
   */
  reconnectStream(error) {
    console.error('[SYNC] SSE stream error:', error.message || 'Connection error');
    if (this.logger) {
      this.logger.error('SSE', 'Stream error', {
        error: error.message || 'Connection error',
        willReconnect: this.isRunning && !this.sseReconnectTimer,
        reconnectDelayMs: 5000
      });
    }

    if (this.isRunning && !this.sseReconnectTimer) {
      console.log('[SYNC] SSE: Will reconnect in 5 seconds...');
      this.sseReconnectTimer = setTimeout(() => {
        this.sseReconnectTimer = null;
        if (this.isRunning) {
          this.connectToStream();
        }
      }, 5000);
    }
  },

  /** The legacy transport: the op handlers above consume the stream. */
  connectToStream() {
    this.openStream({
      onFrame: (frame) => this.handleStreamFrame(frame.data),
      onError: (error) => this.reconnectStream(error),
    });
  },

  /**
   * Close the session's stream: connection, watchdog and reconnect timer. The
   * frames and error sink are dropped with it, so a late frame after a pause
   * reaches nobody.
   */
  closeStream() {
    if (this.sseWatchdog) {
      clearInterval(this.sseWatchdog);
      this.sseWatchdog = null;
    }

    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }

    this.streamFrame = null;
    this.streamError = null;
    this.streamRefusal = null;

    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
      console.log('[SYNC] SSE stream disconnected');
    }
  },

  /**
   * Disconnect from SSE stream
   */
  disconnectStream() {
    this.closeStream();
  },

  /**
   * Start SSE watchdog timer - triggers manual sync if no SSE activity
   */
  startSseWatchdog() {
    if (this.sseWatchdog) {
      clearInterval(this.sseWatchdog);
    }

    const WATCHDOG_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const CHECK_INTERVAL = 60 * 1000; // Check every minute

    this.sseWatchdog = setInterval(() => {
      if (!this.isRunning || !this.lastSseActivity) return;

      const elapsed = Date.now() - this.lastSseActivity;
      if (elapsed > WATCHDOG_TIMEOUT) {
        console.log(`[SYNC] SSE watchdog: no activity for ${Math.round(elapsed / 1000)}s, restarting the session`);
        if (this.logger) {
          this.logger.info('SSE', 'Watchdog triggered - no activity', { elapsed });
        }
        // A silent stream is no evidence of what changed: restart the whole
        // generation (C3 §5.6), which reconciles everything from scratch.
        if (this.runner) this.runner.start();
        else this.checkForRemoteChanges();
        this.lastSseActivity = Date.now(); // Reset to avoid repeated triggers
      }
    }, CHECK_INTERVAL);

    console.log('[SYNC] SSE watchdog started (5 min timeout)');
  },

  /**
   * Start polling for remote changes (fallback, runs less frequently with SSE)
   */
  startPolling() {
    // With SSE, poll less frequently as a fallback (every 5 minutes instead of 30 seconds)
    const pollInterval = SYNC_CONFIG.POLL_INTERVAL * 10; // 5 minutes

    this.pollTimer = setInterval(async () => {
      await this.checkForRemoteChanges();
    }, pollInterval);

    console.log(`[SYNC] Fallback polling started (interval: ${pollInterval / 1000}s)`);

    // Log polling start
    if (this.logger) {
      this.logger.info('POLL', 'Fallback polling started', {
        interval: pollInterval
      });
    }
  },

  /**
   * Check for changes on the server
   */
  async checkForRemoteChanges() {
    // Don't poll if sync is not running
    if (!this.isRunning) {
      return;
    }

    if (this.syncQueue.isProcessingQueue()) {
      // Log when poll is skipped due to queue processing
      if (this.logger) {
        this.logger.info('POLL', 'Poll check skipped - queue is processing');
      }
      return;
    }

    const gen = this.generation;

    try {
      // Log poll check start
      if (this.logger) {
        this.logger.info('POLL', 'Checking for remote changes');
      }

      const serverFiles = await this.fetchAndCacheServerFiles(0);

      // Check if sync was stopped during the fetch
      if (!this.isRunning || gen !== this.generation) {
        return;
      }

      const localFiles = await getLocalFiles(this.syncFolder);
      let changesFound = false;

      await this.repo.apply(async (map) => {
        for (const serverFile of serverFiles) {
          // Check if sync was stopped during iteration
          if (!this.isRunning) {
            return;
          }
          // Server returns path WITH .html (e.g., "folder1/folder2/site.html" or "site.html")
          const relativePath = serverFile.path || serverFile.filename;
          const localPath = path.join(this.syncFolder, relativePath);
          const localExists = localFiles.has(relativePath);

          if (!localExists) {
            // New file on server
            await this.downloadFile(serverFile.nodeId, relativePath);
            this.stats.filesDownloaded++;
            changesFound = true;
            if (serverFile.nodeId) {
              const inode = await nodeMap.getInode(path.join(this.syncFolder, relativePath));
              map.set(String(serverFile.nodeId), { path: relativePath, checksum: serverFile.checksum, inode, syncedAt: Date.now() });
            }
          } else {
            const localContent = await readFile(localPath);
            const localChecksum = await calculateChecksum(localContent);

            // Check if content is different
            if (localChecksum !== serverFile.checksum) {
              // C3: the baseline, not a clock, says which side moved. The local
              // bytes are the ones on disk, the remote's etag is its checksum.
              const decision = decide({
                baseline: serverFile.nodeId ? this.repo.getBaseline(serverFile.nodeId) : null,
                local: { checksum: localChecksum },
                remote: { etag: serverFile.checksum },
                complete: true
              });

              if (decision.action === A.DOWNLOAD) {
                // Download the server's version
                await this.downloadFile(serverFile.nodeId, relativePath);
                this.stats.filesDownloaded++;
                changesFound = true;
                if (serverFile.nodeId) {
                  const inode = await nodeMap.getInode(path.join(this.syncFolder, relativePath));
                  map.set(String(serverFile.nodeId), { path: relativePath, checksum: serverFile.checksum, inode, syncedAt: Date.now() });
                }
              } else if (decision.action === A.UPLOAD) {
                console.log(`[SYNC] PRESERVE ${relativePath} - local changed since the last sync, uploading`);
                this.stats.filesProtected++;
                await this.uploadFile(relativePath);
              } else {
                // Both sides moved: the reconciliation pass records the conflict
                // and neither file is written here.
                console.log(`[SYNC] ${relativePath} - local and server both moved, leaving the conflict to reconcile`);
              }
            }
          }
        }
      });

      // Also check for upload changes
      if (!this.isRunning) return;

      const serverUploads = await this.fetchAndCacheServerUploads(10_000);
      if (gen !== this.generation) return;
      const localUploads = await getLocalUploads(this.syncFolder);

      await this.repo.apply(async (map) => {
        for (const serverUpload of serverUploads) {
          if (!this.isRunning) return;

          const localPath = path.join(this.syncFolder, serverUpload.path);
          const localExists = localUploads.has(serverUpload.path);

          if (!localExists) {
            await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
            this.stats.uploadsDownloaded++;
            changesFound = true;
            if (serverUpload.nodeId) {
              map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null, syncedAt: Date.now() });
            }
          } else {
            const localContent = await readFileBuffer(localPath);
            const localChecksum = calculateBufferChecksum(localContent);

            if (localChecksum !== serverUpload.checksum) {
              const decision = decide({
                baseline: serverUpload.nodeId ? this.repo.getBaseline(serverUpload.nodeId) : null,
                local: { checksum: localChecksum },
                remote: { etag: serverUpload.checksum },
                complete: true
              });

              if (decision.action === A.DOWNLOAD) {
                await this.downloadUploadFile(serverUpload.path, serverUpload.nodeId);
                this.stats.uploadsDownloaded++;
                changesFound = true;
                if (serverUpload.nodeId) {
                  map.set(String(serverUpload.nodeId), { path: serverUpload.path, checksum: serverUpload.checksum, inode: null, syncedAt: Date.now() });
                }
              } else if (decision.action === A.UPLOAD) {
                console.log(`[SYNC] PRESERVE upload ${serverUpload.path} - local changed since the last sync, uploading`);
                this.stats.uploadsProtected++;
                await this.uploadUploadFile(serverUpload.path);
              } else {
                console.log(`[SYNC] ${serverUpload.path} - local and server both moved, leaving the conflict to reconcile`);
              }
            }
          }
        }
      });

      if (changesFound) {
        this.emit('sync-stats', this.stats);

        // Log poll check completion with changes
        if (this.logger) {
          this.logger.success('POLL', 'Remote changes detected and downloaded', {
            filesDownloaded: this.stats.filesDownloaded,
            uploadsDownloaded: this.stats.uploadsDownloaded
          });
        }
      } else {
        // Log poll check completion with no changes
        if (this.logger) {
          this.logger.info('POLL', 'Poll check completed - no changes');
        }
      }

      this.stats.lastSync = new Date().toISOString();
    } catch (error) {
      console.error('[SYNC] Failed to check for remote changes:', error);
      this.stats.errors.push(formatErrorForLog(error, { action: 'poll' }));

      // Log polling error
      if (this.logger) {
        this.logger.error('POLL', 'Polling check failed', { error });
      }
    }
  }
};

/**
 * The one executor for a `decide` result.
 *
 * Every action `decide` returns has a branch here, and the baseline entry for a
 * node is advanced only after the local write or the server acknowledgment
 * succeeded. An uncertain outcome — a request that left without an answer —
 * refetches the node before it counts as either succeeded or failed, and a
 * conflict never loses bytes: the local file stays where it is, the remote
 * bytes land in `<root>/.hyperclay/conflicts/`, and the record in the session's
 * `conflicts.json` keeps both until the user picks mine or theirs.
 *
 * Reused rather than re-implemented: the api client (getNodeContent,
 * putNodeContent, createNode, deleteNode), the backup helpers
 * (createBackupIfExists, createBinaryBackupIfExists), the atomic publish
 * (writeFile/writeFileBuffer and withFileLock), refreshDerivedArtifacts, the
 * data-loss guard, live.markBrowserSave, and the engine's `_applyFileDelete`
 * for `trash-local` (the `.trash/` move and its collision handling).
 *
 * Not wired into initial sync or the watcher yet; C3.5 does that.
 */

const fs = require('fs').promises;
const path = require('upath');
const {
  readFile,
  readFileBuffer,
  writeFile,
  writeFileBuffer,
  ensureDirectory,
} = require('../file-operations');
const { calculateChecksum } = require('../utils');
const {
  createNode,
  deleteNode,
  getNodeContent,
  putNodeContent,
} = require('../api-client');
const { createBackupIfExists, createBinaryBackupIfExists } = require('../../main/utils/backup');
const { withFileLock, atomicWriteFile } = require('../../main/utils/write-queue');
const { getConsentRegistry, resolveWritePath } = require('../../main/utils/path-resolver');
const { refreshDerivedArtifacts } = require('../../main/utils/derived-artifacts');
const dataGuard = require('../../main/data-loss-guard');
const nodeMap = require('../node-map');
const store = require('./conflicts');
const { A } = require('./decide');

const SITE_PATTERN = /\.(html|htmlclay)$/i;

/**
 * `session` is the session's engine: the per-session connection, baseline,
 * outbox, root and logger all live there. A C2 session entry holding `engine`
 * is accepted too.
 */
function engineOf(session) {
  return session && session.engine ? session.engine : session;
}

function relPathOf(entry, context, nodeId) {
  const rel = (entry && entry.path) || context.path;
  if (!rel) throw new Error(`No path known for node ${nodeId}`);
  return rel;
}

function typeOf(entry, context, rel) {
  if (entry && entry.type) return entry.type;
  if (context.type) return context.type;
  return SITE_PATTERN.test(rel) ? 'site' : 'upload';
}

function dirOf(rel) {
  const dir = path.dirname(rel);
  return dir === '.' ? '' : dir;
}

function idOf(nodeId) {
  const id = parseInt(nodeId, 10);
  return Number.isNaN(id) ? null : id;
}

async function localPathFor(engine, rel) {
  engine.resolveContainedPath(rel);
  return resolveWritePath(getConsentRegistry(engine.syncFolder), rel);
}

async function readLocalBytes(localPath) {
  const buffer = await readFileBuffer(localPath);
  return { buffer, checksum: await calculateChecksum(buffer) };
}

async function writeBytes(filePath, content) {
  await ensureDirectory(path.dirname(filePath));
  await atomicWriteFile(filePath, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), null);
}

/**
 * Backup, atomic write and the data-loss guard around one local overwrite —
 * the sequence `downloadFile` runs for a synced-down file.
 */
async function writeLocal(engine, rel, content, { modifiedAt = null } = {}) {
  const isSite = SITE_PATTERN.test(rel);
  const localPath = await localPathFor(engine, rel);

  const previous = await withFileLock(localPath, async () => {
    let prev = null;
    if (isSite) {
      try {
        prev = await readFile(localPath);
      } catch {
        prev = null;
      }
    }

    if (isSite) {
      await createBackupIfExists(localPath, rel.replace(SITE_PATTERN, ''), engine.syncFolder, engine.emit.bind(engine), engine.logger);
    } else {
      await createBinaryBackupIfExists(localPath, rel, engine.syncFolder, engine.emit.bind(engine), engine.logger);
    }

    engine.live.markBrowserSave(rel);
    await ensureDirectory(path.dirname(localPath));

    if (isSite) {
      await writeFile(localPath, content, modifiedAt);
      if (typeof content === 'string') {
        await refreshDerivedArtifacts(engine.syncFolder, rel, content);
      }
    } else {
      await writeFileBuffer(localPath, content, modifiedAt);
    }

    return prev;
  });

  if (isSite && typeof content === 'string') {
    dataGuard.runDataLossGuard({
      baseDir: engine.syncFolder,
      name: rel,
      newHtml: content,
      prevContent: previous,
      prov: 'external',
    }).catch((err) => console.error('[data-guard] reconcile guard error:', err && err.message ? err.message : err));
  }

  return localPath;
}

/** Merge baseline fields into an entry (or a brand-new one) and persist. */
async function saveEntry(engine, nodeId, entry, fields, extra = {}) {
  const next = nodeMap.applyBaseline({ ...(entry || {}), ...extra }, fields);
  await engine.repo.set(nodeId, next);
  return next;
}

/** Type, path, inode and syncedAt for an entry the baseline has none for. */
async function entryMeta(engine, rel, type, parentId) {
  const localPath = await localPathFor(engine, rel);
  const extra = { type, path: rel, inode: await nodeMap.getInode(localPath), syncedAt: Date.now() };
  if (parentId !== undefined && parentId !== null) extra.parentId = parentId;
  return extra;
}

async function openConflict(engine, nodeId, rel) {
  const records = await store.load(engine.metaDir);
  return store.forNode(records, nodeId, rel);
}

/**
 * Park the remote bytes and write the record. `fetchRemote` is false for
 * `remote-deleted` (no remote bytes are left) and for `name-taken` (the node
 * that answered is a different one).
 */
async function recordConflict(engine, nodeId, rel, { kind, localChecksum = null, remoteEtag = null, fetchRemote = true }) {
  const record = { kind, path: rel, localChecksum, remoteEtag, remoteCopy: null, detectedAt: Date.now() };

  if (fetchRemote && nodeId !== null && nodeId !== undefined) {
    try {
      const response = await getNodeContent(engine.conn, idOf(nodeId));
      const etag = response.etag || response.checksum || remoteEtag;
      await writeBytes(store.remoteCopyPath(engine.syncFolder, rel, etag), response.content);
      record.remoteEtag = etag;
      record.remoteCopy = store.remoteCopyRef(rel, etag);
    } catch (error) {
      console.error(`[SYNC] Could not park the remote bytes for ${rel}:`, error.message);
    }
  }

  const stored = await store.set(engine.metaDir, { ...record, nodeId });
  engine.emit('file-synced', { file: rel, action: 'conflict', kind });
  return { key: stored.key, ...stored.record };
}

async function localChecksumOf(engine, rel) {
  try {
    return (await readLocalBytes(await localPathFor(engine, rel))).checksum;
  } catch {
    return null;
  }
}

/**
 * A remote frame for a node that already has a record may only replace the
 * parked remote bytes and the record's etag; the local file is not touched.
 */
async function refreshRemoteCopy(engine, nodeId, rel, open, gen) {
  const response = await getNodeContent(engine.conn, idOf(nodeId));
  if (gen !== undefined && gen !== engine.generation) return { action: A.CONFLICT, stale: true };

  const etag = response.etag || response.checksum || null;
  await writeBytes(store.remoteCopyPath(engine.syncFolder, rel, etag), response.content);
  const updated = await store.update(engine.metaDir, open.key, {
    remoteEtag: etag,
    remoteCopy: store.remoteCopyRef(rel, etag),
  });
  return { action: A.CONFLICT, kind: open.kind, record: { key: updated.key, ...updated.record } };
}

async function upload(engine, nodeId, entry, context, gen) {
  const rel = relPathOf(entry, context, nodeId);
  const open = await openConflict(engine, nodeId, rel);
  if (open) return { action: A.CONFLICT, kind: open.kind, record: open };

  const isSite = SITE_PATTERN.test(rel);
  const localPath = await localPathFor(engine, rel);
  const { buffer, checksum: localChecksum } = await readLocalBytes(localPath);
  const content = isSite ? buffer.toString('utf8') : buffer;
  const baseline = engine.repo.getBaseline(nodeId) || {};

  const options = { modifiedAt: (await fs.stat(localPath)).mtime, ifMatch: baseline.remoteEtag };
  const snap = engine.snapshots && engine.snapshots.take ? engine.snapshots.take(rel) : null;
  if (snap) {
    options.snapshotHtml = snap.html;
    if (snap.userDriven !== undefined) options.userDriven = snap.userDriven;
  }

  let response;
  engine.outbox.markInFlight('save', idOf(nodeId));
  try {
    response = await putNodeContent(engine.conn, idOf(nodeId), content, options);
  } catch (error) {
    if (error.statusCode === 412) {
      const record = await recordConflict(engine, nodeId, rel, {
        kind: store.KINDS.REJECTED,
        localChecksum,
        remoteEtag: error.etag || baseline.remoteEtag || null,
      });
      return { action: A.CONFLICT, kind: store.KINDS.REJECTED, record };
    }
    if (!error.statusCode) {
      const settled = await settleUpload(engine, nodeId, entry, context, localChecksum);
      if (settled) return settled;
    }
    throw error;
  }
  if (gen !== engine.generation) return { action: A.UPLOAD, stale: true };

  const etag = response.etag || response.checksum || localChecksum;
  await saveEntry(engine, nodeId, entry, {
    remoteEtag: etag,
    localChecksum: etag,
    structureVersion: response.structureVersion,
  });
  engine.emit('file-synced', { file: rel, action: 'upload', type: typeOf(entry, context, rel) });
  return { action: A.UPLOAD, etag, checksum: etag };
}

/**
 * A request that left but never answered: refetch the node before treating it
 * as failed. Remote bytes that now match ours mean the write landed.
 */
async function settleUpload(engine, nodeId, entry, context, localChecksum) {
  let response;
  try {
    response = await getNodeContent(engine.conn, idOf(nodeId));
  } catch {
    return null;
  }
  if (!response || response.checksum !== localChecksum) return null;

  const rel = relPathOf(entry, context, nodeId);
  const type = typeOf(entry, context, rel);
  const extra = entry ? {} : await entryMeta(engine, rel, type, context.parentId);
  const etag = response.etag || response.checksum || localChecksum;
  await saveEntry(engine, nodeId, entry, {
    remoteEtag: etag,
    localChecksum: etag,
    structureVersion: response.structureVersion,
  }, extra);
  return { action: A.UPLOAD, etag, checksum: etag, recovered: true };
}

async function download(engine, nodeId, entry, context, gen) {
  const rel = relPathOf(entry, context, nodeId);
  const open = await openConflict(engine, nodeId, rel);
  if (open) return refreshRemoteCopy(engine, nodeId, rel, open, gen);

  const response = await getNodeContent(engine.conn, idOf(nodeId));
  if (gen !== engine.generation) return { action: A.DOWNLOAD, stale: true };

  const localPath = await writeLocal(engine, rel, response.content, { modifiedAt: response.modifiedAt });
  const localChecksum = (await readLocalBytes(localPath)).checksum;
  const type = typeOf(entry, context, rel);
  const parentId = entry ? entry.parentId : context.parentId;

  await saveEntry(engine, nodeId, entry, {
    remoteEtag: response.etag || response.checksum || context.etag || null,
    localChecksum,
    structureVersion: response.structureVersion !== undefined ? response.structureVersion : context.structureVersion,
  }, await entryMeta(engine, rel, type, parentId));

  engine.emit('file-synced', { file: rel, action: 'download', type });
  return { action: A.DOWNLOAD, checksum: localChecksum };
}

// A noop pass is where a version the desktop did not cause (a teammate's rename of a parent,
// a folder's subtree) reaches the baseline, so the next structural change sends it.
async function refreshStructureVersion(engine, nodeId, entry, context) {
  if (!entry || !context.structureVersion) return;
  const baseline = engine.repo.getBaseline(nodeId);
  if (!baseline || baseline.structureVersion === context.structureVersion) return;
  await engine.repo.updateBaseline(nodeId, { structureVersion: context.structureVersion });
}

async function adopt(engine, nodeId, entry, context) {
  const rel = relPathOf(entry, context, nodeId);
  const localChecksum = await localChecksumOf(engine, rel);
  const type = typeOf(entry, context, rel);
  const parentId = entry ? entry.parentId : context.parentId;

  await saveEntry(engine, nodeId, entry, {
    remoteEtag: context.etag || localChecksum,
    localChecksum,
    structureVersion: context.structureVersion === undefined ? null : context.structureVersion,
  }, await entryMeta(engine, rel, type, parentId));

  return { action: A.ADOPT, checksum: localChecksum };
}

async function trashLocal(engine, nodeId, entry, context) {
  const rel = relPathOf(entry, context, nodeId);
  await engine._applyFileDelete(idOf(nodeId), rel, typeOf(entry, context, rel));
  return { action: A.TRASH_LOCAL, path: rel };
}

async function deleteRemote(engine, nodeId, entry, context) {
  const rel = relPathOf(entry, context, nodeId);
  const type = typeOf(entry, context, rel);
  const id = idOf(nodeId);
  const expectedVersion = (await engine._expectedVersion(id)) ?? null;

  engine.outbox.markInFlight('delete', id);
  try {
    await deleteNode(engine.conn, id, { expectedVersion });
  } catch (error) {
    if (!error.statusCode && (await deleteLanded(engine, id))) {
      await finishDelete(engine, nodeId, rel, type);
      return { action: A.DELETE_REMOTE, path: rel, recovered: true };
    }
    throw error;
  }

  await finishDelete(engine, nodeId, rel, type);
  return { action: A.DELETE_REMOTE, path: rel };
}

async function deleteLanded(engine, id) {
  try {
    await getNodeContent(engine.conn, id);
    return false;
  } catch (error) {
    return error.statusCode === 404;
  }
}

async function finishDelete(engine, nodeId, rel, type) {
  await engine.repo.delete(nodeId);
  if (typeof engine.invalidateServerNodesCache === 'function') engine.invalidateServerNodesCache();
  engine.emit('file-synced', { file: rel, action: 'delete', type });
}

async function createRemote(engine, nodeId, entry, context, gen) {
  const rel = relPathOf(entry, context, nodeId);
  const isSite = SITE_PATTERN.test(rel);
  const localPath = await localPathFor(engine, rel);
  const { buffer, checksum: localChecksum } = await readLocalBytes(localPath);
  const content = isSite ? buffer.toString('utf8') : buffer;
  const type = typeOf(entry, context, rel);

  let created;
  try {
    created = await createNode(engine.conn, {
      type,
      name: path.basename(rel),
      parentId: engine.resolveParentIdByPath(dirOf(rel)),
      content,
      modifiedAt: (await fs.stat(localPath)).mtime,
    });
  } catch (error) {
    if (error.statusCode === 409 && error.code === 'name-conflict') {
      const record = await recordConflict(engine, nodeId, rel, {
        kind: store.KINDS.NAME_TAKEN,
        localChecksum,
        fetchRemote: false,
      });
      return { action: A.CONFLICT, kind: store.KINDS.NAME_TAKEN, record };
    }
    throw error;
  }
  if (gen !== engine.generation) return { action: A.CREATE_REMOTE, stale: true };

  engine.outbox.markInFlight('save', created.id);
  const etag = created.etag || created.checksum || localChecksum;
  await saveEntry(engine, created.id, null, {
    remoteEtag: etag,
    localChecksum: etag,
    structureVersion: created.structureVersion,
  }, await entryMeta(engine, rel, type, created.parentId));

  engine.emit('file-synced', { file: rel, action: 'upload', type });
  return { action: A.CREATE_REMOTE, nodeId: created.id, etag };
}

async function forget(engine, nodeId) {
  if (nodeId !== null && nodeId !== undefined) await engine.repo.delete(nodeId);
  return { action: A.FORGET };
}

async function conflicted(engine, nodeId, entry, context, decision) {
  const rel = relPathOf(entry, context, nodeId);
  const kind = decision.conflictKind || store.KINDS.BOTH_EDITED;
  const record = await recordConflict(engine, nodeId, rel, {
    kind,
    localChecksum: await localChecksumOf(engine, rel),
    fetchRemote: kind !== store.KINDS.REMOTE_DELETED,
  });
  return { action: A.CONFLICT, kind, record };
}

/**
 * Carry out one `decide` result for one node.
 *
 * @param {object} session the session's engine (or a C2 entry holding `engine`)
 * @param {number|string|null} nodeId the node's id, or null for a file with no
 *   node id yet (then `context.path` names it)
 * @param {{action:string, conflictKind?:string}} decision the result of `decide`
 * @param {{path?:string, type?:string, parentId?:number, etag?:string, structureVersion?:string}} [context]
 *   the remote view for a node the baseline has no entry for
 * @returns {Promise<{action:string}>}
 */
async function executeDecision(session, nodeId, decision, context = {}) {
  const engine = engineOf(session);
  const gen = engine.generation;
  const entry = nodeId === null || nodeId === undefined ? null : engine.repo.get(nodeId);

  switch (decision.action) {
    case A.NOOP:
      await refreshStructureVersion(engine, nodeId, entry, context);
      return { action: decision.action };
    case A.DEFER:
      return { action: decision.action };
    case A.FORGET:
      return forget(engine, nodeId);
    case A.ADOPT:
      return adopt(engine, nodeId, entry, context);
    case A.UPLOAD:
      return upload(engine, nodeId, entry, context, gen);
    case A.DOWNLOAD:
      return download(engine, nodeId, entry, context, gen);
    case A.CONFLICT:
      return conflicted(engine, nodeId, entry, context, decision);
    case A.TRASH_LOCAL:
      return trashLocal(engine, nodeId, entry, context);
    case A.DELETE_REMOTE:
      return deleteRemote(engine, nodeId, entry, context);
    case A.CREATE_REMOTE:
      return createRemote(engine, nodeId, entry, context, gen);
    default:
      return { action: decision.action };
  }
}

async function removeCopy(engine, record) {
  if (!record || !record.remoteCopy) return;
  try {
    await fs.unlink(path.join(engine.syncFolder, record.remoteCopy));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[SYNC] Could not remove ${record.remoteCopy}:`, error.message);
  }
}

/**
 * Pick a side for an open conflict record, found by its path. Both choices end
 * with the record closed and the parked copy removed; a 412 on `mine` refreshes
 * the record and leaves it open.
 *
 * @param {object} session the session's engine (or a C2 entry holding `engine`)
 * @param {{path:string, choice:'mine'|'theirs'}} input
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function resolveConflict(session, { path: rel, choice } = {}) {
  const engine = engineOf(session);
  if (choice !== 'mine' && choice !== 'theirs') return { ok: false, error: 'bad-choice' };

  const records = await store.load(engine.metaDir);
  const found = store.byPath(records, rel);
  if (!found) return { ok: false, error: 'no-conflict' };

  const id = idOf(found.key);
  const isSite = SITE_PATTERN.test(found.path);
  const type = isSite ? 'site' : 'upload';
  const localPath = await localPathFor(engine, found.path);
  const known = engine.repo.get(found.key);
  const extra = await entryMeta(engine, found.path, type, known ? known.parentId : undefined);

  if (choice === 'theirs') {
    if (found.kind === store.KINDS.REMOTE_DELETED) {
      await engine._applyFileDelete(id, found.path, type);
    } else {
      if (!found.remoteCopy) return { ok: false, error: 'no-remote-copy' };
      const other = await readFileBuffer(path.join(engine.syncFolder, found.remoteCopy));
      await writeLocal(engine, found.path, isSite ? other.toString('utf8') : other, {});
      await saveEntry(engine, found.key, known, {
        remoteEtag: found.remoteEtag,
        localChecksum: (await readLocalBytes(localPath)).checksum,
      }, extra);
    }
    await store.clear(engine.metaDir, found.key);
    await removeCopy(engine, found);
    return { ok: true };
  }

  const { buffer, checksum: localChecksum } = await readLocalBytes(localPath);
  const content = isSite ? buffer.toString('utf8') : buffer;
  const modifiedAt = (await fs.stat(localPath)).mtime;

  if (id === null || found.kind === store.KINDS.REMOTE_DELETED) {
    const created = await createNode(engine.conn, {
      type,
      name: path.basename(found.path),
      parentId: engine.resolveParentIdByPath(dirOf(found.path)),
      content,
      modifiedAt,
    });
    const etag = created.etag || created.checksum || localChecksum;
    await saveEntry(engine, created.id, null, {
      remoteEtag: etag,
      localChecksum: etag,
      structureVersion: created.structureVersion,
    }, await entryMeta(engine, found.path, type, created.parentId));
    await store.clear(engine.metaDir, found.key);
    await removeCopy(engine, found);
    return { ok: true };
  }

  let response;
  engine.outbox.markInFlight('save', id);
  try {
    response = await putNodeContent(engine.conn, id, content, { modifiedAt, ifMatch: found.remoteEtag });
  } catch (error) {
    if (error.statusCode === 412) {
      await refreshRemoteCopy(engine, id, found.path, found);
      return { ok: false, error: 'stale-etag' };
    }
    throw error;
  }

  const etag = response.etag || response.checksum || localChecksum;
  await saveEntry(engine, found.key, known, {
    remoteEtag: etag,
    localChecksum: etag,
    structureVersion: response.structureVersion,
  }, extra);
  await store.clear(engine.metaDir, found.key);
  await removeCopy(engine, found);
  return { ok: true };
}

module.exports = {
  executeDecision,
  resolveConflict,
  recordConflict,
};

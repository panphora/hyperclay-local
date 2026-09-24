/**
 * C3 §5.9: the import of a migrated personal session's legacy metadata.
 *
 * C1's settings migration hands the personal session over with no account id
 * and its baseline still in the old `sync-meta/<legacyMetaDir>/` directory. On
 * the session's first start this pass proves the session's identity through
 * discovery, copies and converts the legacy map, tombstones and sync state into
 * the session's own `sync-meta/v2/<sessionId>/`, reconciles once with
 * `bootstrap: true` (nothing is deleted on the server, an entry without a
 * baseline is matched by checksum instead), and only then writes
 * `identity.json` and hands the session over to its v2 directory. The legacy
 * directory is read, never written.
 *
 * Offline, or with a refused key, nothing is copied and nothing reconciles: the
 * failure goes back to the session's state machine, which classifies it and
 * retries with its backoff. `discovery` names the personal account before any
 * file is touched, so no reconciliation ever runs on an unproven session.
 */

const fs = require('fs').promises;
const path = require('upath');

const { getAccounts, listNodes } = require('../api-client');
const nodeMap = require('../node-map');

const IDENTITY_FILE = 'identity.json';
const MAP_FILE = 'node-map.json';
const STATE_FILE = 'sync-state.json';
const TOMBSTONES_FILE = 'tombstones.json';
const COPIED_FILES = [TOMBSTONES_FILE, STATE_FILE];
const SITE_PATTERN = /\.(html|htmlclay)$/i;

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJson(filePath) {
  const text = await readText(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeIdentity(metaDir, identity) {
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, IDENTITY_FILE), JSON.stringify(identity, null, 2));
}

async function realpathOr(dir) {
  try {
    return await fs.realpath(dir);
  } catch {
    return dir;
  }
}

/** The personal account discovery names for this key (5.9 step 1). */
async function discoverPersonal(engine, session, account, actorId) {
  if (account) return { account, actorId: actorId ?? null };
  const body = await getAccounts({ serverUrl: engine.serverUrl, apiKey: engine.apiKey });
  const accounts = (body && body.accounts) || [];
  const username = session.cached && session.cached.username;
  const found = accounts.find((a) => a.kind === 'personal' && (!username || a.username === username))
    || accounts.find((a) => a.kind === 'personal')
    || null;
  return { account: found, actorId: (body && body.actor && body.actor.id) ?? null };
}

/**
 * One legacy entry, converted (5.9 step 3): the checksum it recorded was both
 * halves of the pair, and an entry without one has no baseline at all. Type,
 * path, parent, inode and syncedAt carry over; `checksum` stays alongside the
 * pair for the engine code that still reads it.
 */
function convertEntry(value) {
  const legacy = typeof value === 'string' ? { path: value } : { ...(value || {}) };
  const checksum = legacy.checksum === undefined ? null : legacy.checksum;
  return {
    type: legacy.type || (SITE_PATTERN.test(legacy.path || '') ? 'site' : 'upload'),
    path: legacy.path === undefined ? null : legacy.path,
    parentId: legacy.parentId === undefined ? null : legacy.parentId,
    inode: legacy.inode === undefined ? null : legacy.inode,
    remoteEtag: checksum,
    localChecksum: checksum,
    checksum,
    structureVersion: null,
    syncedAt: legacy.syncedAt === undefined ? null : legacy.syncedAt,
  };
}

/**
 * Copy the legacy metadata into the session's v2 directory (5.9 steps 2 and 3):
 * the map converted, the tombstones and the sync state verbatim. A missing or
 * corrupt map is an empty map — every file then matches by checksum or becomes
 * `unbound` (5.9 step 6).
 */
async function adoptLegacyFiles(legacyDir, metaDir) {
  const legacyMap = await readJson(path.join(legacyDir, MAP_FILE));
  const map = new Map();
  for (const [nodeId, value] of Object.entries(legacyMap || {})) {
    map.set(String(nodeId), convertEntry(value));
  }
  await nodeMap.save(metaDir, map);

  for (const name of COPIED_FILES) {
    const text = await readText(path.join(legacyDir, name));
    if (text === null) continue;
    await fs.mkdir(metaDir, { recursive: true });
    await fs.writeFile(path.join(metaDir, name), text);
  }
  return map.size;
}

/**
 * Import one migrated personal session's legacy metadata and hand the session
 * over to its v2 metadata directory.
 *
 * @param {{session:object, root:object, engine:object}} entry a C2 session entry
 * @param {{legacyDir:string, metaDir:string, inventory?:Array, generation?:number,
 *   signal?:AbortSignal, account?:object, actorId?:number, persist?:Function,
 *   now?:Function}} options `account` is the discovery entry the caller already
 *   holds; the inventory is the session's own list; `persist` is what makes the
 *   session's account id and directory switch durable.
 * @returns {Promise<{ok:boolean, accountId?:number, actorId?:number|null,
 *   entries?:number, error?:string}>}
 */
async function importLegacyMeta(entry, options = {}) {
  const engine = entry.engine || entry;
  const session = entry.session || { id: engine.sessionId, accountId: engine.accountId, rootId: engine.rootId };
  const metaDir = options.metaDir || engine.metaDir;
  const signal = options.signal;
  const now = options.now || Date.now;

  // 1. Identity comes first: without an account discovery named, nothing is
  //    copied, converted or reconciled and the session is not identified.
  const found = await discoverPersonal(engine, session, options.account, options.actorId);
  if (!found.account) {
    throw Object.assign(new Error('Discovery names no personal account'), { statusCode: 404, code: 'not-found' });
  }
  engine.accountId = found.account.id;
  if (found.account.syncBase) engine.syncBase = found.account.syncBase;

  // 2 and 3. The legacy directory is only ever read.
  await adoptLegacyFiles(options.legacyDir, metaDir);

  // From here on the session's baseline is the converted map and its
  // lastSyncedAt is the one the legacy state carried.
  await engine.repo.load();
  await engine.repo.loadTombstones();
  engine.lastSyncedAt = (await engine.repo.loadState()).lastSyncedAt || null;

  // 4. One reconcile that deletes nothing on the server.
  const inventory = options.inventory || await listNodes(engine.conn, { signal });
  await engine.reconcileAll(inventory, { generation: options.generation, signal, bootstrap: true });
  if (signal && signal.aborted) return { ok: false, error: 'aborted' };

  // 5. The baseline is persisted, so the session may know who it is: identity
  //    first, then the switch away from the legacy directory. Its directory
  //    belongs to the session from here on.
  const state = await engine.repo.loadState();
  await writeIdentity(metaDir, {
    serverUrl: engine.serverUrl,
    actorId: found.actorId,
    accountId: found.account.id,
    rootId: session.rootId ?? null,
    rootRealpath: await realpathOr((entry.root && entry.root.path) || engine.syncFolder),
  });
  await engine.repo.saveState({ ...state, migratedAt: new Date(now()).toISOString() });
  engine.startUnifiedWatcher();
  if (options.persist) options.persist({ accountId: found.account.id, actorId: found.actorId });

  return { ok: true, accountId: found.account.id, actorId: found.actorId, entries: engine.repo.size };
}

module.exports = {
  IDENTITY_FILE,
  convertEntry,
  importLegacyMeta,
};

/**
 * C3 §5.8: the first bind of a team root.
 *
 * A team folder starts empty and is filled by one controlled pass: the folder
 * is checked, discovery and the stream prove the account may sync, the
 * inventory is counted and checked against the volume's free space, a marker
 * records the bind in the session's metadata directory, then folders, sites and
 * uploads are reconciled four at a time through the executor's `adopt`,
 * `download` and `conflict` actions. Only after the baseline is persisted is
 * `identity.json` written and the marker removed, so a crash in between leaves
 * an interrupted bind the next run continues instead of a half-bound session.
 *
 * `previewTeam`'s `{ files, bytes }` is the same count, taken from a complete
 * inventory without creating a session, a root or a file.
 */

const fs = require('fs').promises;
const path = require('upath');

const { getAccounts, listNodes } = require('../api-client');
const { fileExists } = require('../file-operations');
const { executeDecision } = require('./execute');

const BIND_MARKER = 'bind-in-progress.json';
const IDENTITY_FILE = 'identity.json';
// A folder that holds any of these only is still empty (5.8 step 1).
const IGNORED_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.hyperclay']);
const MIB = 1024 * 1024;
const DISK_HEADROOM = 1.1;
const DISK_RESERVE = 50 * MIB;
const DOWNLOAD_CONCURRENCY = 4;
const SITE_UPLOAD_LIMIT = 5 * MIB;
const UPLOAD_LIMIT = 10 * MIB;
const READY_TIMEOUT_MS = 30_000;
const SITE_PATTERN = /\.(html|htmlclay)$/i;

const RANK = { folder: 0, site: 1, upload: 2 };

function relPathOf(node) {
  return node.path ? `${node.path}/${node.name}` : node.name;
}

function sizeOf(node) {
  const size = Number(node && node.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function isSite(node, rel) {
  if (node && node.type === 'site') return true;
  if (node && node.type === 'upload') return false;
  return SITE_PATTERN.test(rel);
}

function uploadLimitFor(node, rel) {
  return isSite(node, rel) ? SITE_UPLOAD_LIMIT : UPLOAD_LIMIT;
}

function rankOf(node) {
  if (node && RANK[node.type] !== undefined) return RANK[node.type];
  return RANK[isSite(node, relPathOf(node)) ? 'site' : 'upload'];
}

/** `{ files, bytes }` over the sites and uploads of one inventory (5.8 step 3). */
function inventoryTotals(nodes) {
  let files = 0;
  let bytes = 0;
  for (const node of nodes || []) {
    if (!node || node.type === 'folder') continue;
    files += 1;
    bytes += sizeOf(node);
  }
  return { files, bytes };
}

function errorToken(error) {
  if (!error) return 'bind-failed';
  if (typeof error.code === 'string') return error.code;
  if (error.statusCode) return `http-${error.statusCode}`;
  return 'offline';
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Run `worker` over every item, at most `limit` at a time, one rejection ends it. */
async function runPool(items, limit, worker) {
  let next = 0;
  const drain = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
}

async function folderIsBindable(rootPath) {
  let names;
  try {
    names = await fs.readdir(rootPath);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  return names.every((name) => IGNORED_ENTRIES.has(name));
}

async function readBindMarker(metaDir) {
  if (!metaDir) return null;
  try {
    const marker = JSON.parse(await fs.readFile(path.join(metaDir, BIND_MARKER), 'utf8'));
    return marker && typeof marker === 'object' ? marker : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeBindMarker(metaDir, marker) {
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, BIND_MARKER), JSON.stringify(marker, null, 2));
}

async function clearBindMarker(metaDir) {
  await fs.rm(path.join(metaDir, BIND_MARKER), { force: true });
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

async function freeBytes(dir) {
  const stats = await fs.statfs(dir);
  return stats.bavail * stats.bsize;
}

async function discover(engine, session, account, actorId) {
  if (account) return { account, actorId: actorId ?? null };
  const body = await getAccounts({ serverUrl: engine.serverUrl, apiKey: engine.apiKey });
  const found = ((body && body.accounts) || []).find((a) => a.id === session.accountId) || null;
  return { account: found, actorId: (body && body.actor && body.actor.id) ?? null };
}

/**
 * The stream sequence of 5.6 for one bind: open, wait for `sync-ready`, and
 * remember the nodes a frame named while the download runs so they are re-read
 * once it finishes. Nothing is applied from a frame body.
 */
function openBindStream(engine, signal) {
  const frames = new Set();
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });

  engine.stream.open({
    signal,
    onFrame: (frame) => {
      const data = frame && frame.data;
      if (!data) return;
      if (data.type === 'sync-ready') return settle.resolve(data);
      if (data.nodeId != null) frames.add(String(data.nodeId));
    },
    onError: (error) => settle.reject(error),
  });

  return { ready, frames, close: () => engine.stream.close() };
}

/**
 * One listed node, decided against the baseline and the disk and executed by the
 * executor: `adopt` when the bytes already match, `download` when they do not,
 * `conflict: unbound` when a file is in the way with different bytes. A file
 * over local outbound policy is downloaded and marked `uploadBlocked`.
 */
async function bindNode(engine, node) {
  const rel = relPathOf(node);
  const item = await engine.decideNode({
    nodeId: node.id,
    rel,
    entry: engine.repo.get(node.id) || null,
    remote: engine.remoteViewOf(node),
    localPresent: await fileExists(path.join(engine.syncFolder, rel)),
    complete: true,
    type: node.type
  });

  await executeDecision(engine, node.id, item.decision, item.context);

  if (sizeOf(node) > uploadLimitFor(node, rel)) {
    await engine.repo.updateBaseline(node.id, { uploadBlocked: true });
  }

  return item.decision.action;
}

/**
 * Bind one team session's root (5.8 steps 1 to 7).
 *
 * @param {{session:object, root:object, engine:object}} entry a C2 session entry
 * @param {{onProgress?:Function, signal?:AbortSignal, account?:object, actorId?:number,
 *   metaDir?:string, now?:Function}} [options] `account` is the discovery entry the
 *   caller already holds; without it this asks discovery itself.
 * @returns {Promise<{ok:boolean, error?:string, resumable?:boolean, files?:number, bytes?:number}>}
 */
async function firstBind(entry, options = {}) {
  const engine = entry.engine || entry;
  const root = entry.root || { path: engine.syncFolder };
  const session = entry.session || { id: engine.sessionId, accountId: engine.accountId };
  const metaDir = options.metaDir || engine.metaDir;
  const signal = options.signal;
  const now = options.now || Date.now;
  const onProgress = options.onProgress || null;

  let opened = null;
  let markerWritten = false;

  try {
    // 1. The folder has to be empty, unless this same session was interrupted.
    const interrupted = await readBindMarker(metaDir);
    if (!interrupted && !(await folderIsBindable(root.path))) {
      return { ok: false, error: 'folder-not-empty', resumable: false };
    }

    // 2. Discovery and the stream both have to say this account may sync.
    const discovered = await discover(engine, session, options.account, options.actorId);
    if (!discovered.account) return { ok: false, error: 'not-found', resumable: false };
    if (!discovered.account.sync || discovered.account.sync.enabled !== true) {
      return { ok: false, error: (discovered.account.sync && discovered.account.sync.reason) || 'forbidden', resumable: false };
    }

    opened = openBindStream(engine, signal);
    const ready = await withTimeout(opened.ready, READY_TIMEOUT_MS, 'sync-ready timeout');
    if (!ready.sync || ready.sync.enabled !== true) {
      return { ok: false, error: (ready.sync && ready.sync.reason) || 'forbidden', resumable: false };
    }

    // 3. The inventory, its size, and room for it on this volume.
    const inventory = await listNodes(engine.conn, { signal });
    if (!inventory || inventory.complete !== true) {
      return { ok: false, error: 'inventory-incomplete', resumable: false };
    }
    const nodes = [...inventory];
    const totals = inventoryTotals(nodes);
    if (await freeBytes(root.path) < totals.bytes * DISK_HEADROOM + DISK_RESERVE) {
      return { ok: false, error: 'disk-full', resumable: false };
    }

    // 4. From here on an interruption is resumable.
    const rootRealpath = await realpathOr(root.path);
    await writeBindMarker(metaDir, {
      accountId: session.accountId ?? null,
      rootRealpath,
      startedAt: new Date(now()).toISOString(),
    });
    markerWritten = true;

    // 5. Folders, then sites, then uploads.
    await engine.performInitialFolderSync(nodes);
    const files = nodes.filter((node) => node.type !== 'folder').sort((a, b) => rankOf(a) - rankOf(b));
    let done = 0;
    let bytesDone = 0;
    await runPool(files, DOWNLOAD_CONCURRENCY, async (node) => {
      await bindNode(engine, node);
      done += 1;
      bytesDone += sizeOf(node);
      if (onProgress) {
        onProgress({
          sessionId: session.id,
          phase: 'download',
          done,
          total: totals.files,
          bytesDone,
          bytesTotal: totals.bytes,
        });
      }
    });

    // Nodes a frame named while the download ran were decided against the
    // inventory of that moment: re-read each one against a fresh list.
    for (const nodeId of opened.frames) {
      if (signal && signal.aborted) break;
      await engine.refreshNode(nodeId, { signal });
    }

    // 6. The baseline first, then identity, then the marker: only a session
    // whose disk matches its baseline is ever identified as bound.
    await engine.repo.apply(() => {});
    await writeIdentity(metaDir, {
      serverUrl: engine.serverUrl,
      actorId: discovered.actorId ?? null,
      accountId: session.accountId ?? null,
      rootId: session.rootId ?? null,
      rootRealpath,
    });
    await clearBindMarker(metaDir);

    // 7. The session is live: watch the folder from now on. Its state machine
    // is started by the manager once this returns.
    engine.startUnifiedWatcher();

    return { ok: true, files: totals.files, bytes: totals.bytes };
  } catch (error) {
    if (engine.logger) engine.logger.error('SYNC', 'First bind failed', { error: error.message });
    return { ok: false, error: errorToken(error), reason: error.message, resumable: markerWritten };
  } finally {
    if (opened) opened.close();
  }
}

module.exports = {
  BIND_MARKER,
  IDENTITY_FILE,
  IGNORED_ENTRIES,
  inventoryTotals,
  firstBind,
};

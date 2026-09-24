/**
 * The conflict store: `conflicts.json` in the session meta dir, plus the path
 * the remote bytes are parked at while a record exists.
 *
 * A record is keyed by node id, or by path for an `unbound` file that has no
 * node id yet. Nothing here writes to the local file; the executor owns the
 * bytes, this module owns the record.
 *
 *   {
 *     "901": {
 *       "kind": "both-edited",
 *       "path": "board.html",
 *       "localChecksum": "aa11...",
 *       "remoteEtag": "bb22...",
 *       "remoteCopy": ".hyperclay/conflicts/board.remote-bb22bb22.html",
 *       "detectedAt": 1790000000000
 *     }
 *   }
 */

const fs = require('fs').promises;
const path = require('upath');
const crypto = require('crypto');

const CONFLICTS_FILE = 'conflicts.json';
const CONFLICTS_DIR = '.hyperclay/conflicts';
const KINDS = Object.freeze({
  BOTH_EDITED: 'both-edited',
  REMOTE_DELETED: 'remote-deleted',
  UNBOUND: 'unbound',
  REJECTED: 'rejected',
  NAME_TAKEN: 'name-taken',
});

async function load(metaDir) {
  if (!metaDir) return {};
  let data;
  try {
    data = await fs.readFile(path.join(metaDir, CONFLICTS_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn(`[SYNC] Corrupt ${CONFLICTS_FILE}; starting with no conflict records`);
    return {};
  }
}

async function save(metaDir, records) {
  await fs.mkdir(metaDir, { recursive: true });
  const target = path.join(metaDir, CONFLICTS_FILE);
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records, null, 2));
  await fs.rename(tmp, target);
}

function keyFor(nodeId, relPath) {
  return nodeId === null || nodeId === undefined || nodeId === '' ? String(relPath) : String(nodeId);
}

function list(records) {
  return Object.entries(records).map(([key, record]) => ({ key, ...record }));
}

function byPath(records, relPath) {
  for (const [key, record] of Object.entries(records)) {
    if (record && record.path === relPath) return { key, ...record };
  }
  return null;
}

function forNode(records, nodeId, relPath) {
  const key = keyFor(nodeId, relPath);
  if (records[key]) return { key, ...records[key] };
  if (nodeId !== null && nodeId !== undefined) return null;
  return byPath(records, relPath);
}

function copyName(relPath, etag) {
  const base = path.basename(relPath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, base.length - ext.length) : base;
  const suffix = etag ? `remote-${String(etag).slice(0, 8)}` : 'remote';
  return `${stem}.${suffix}${ext}`;
}

function copyDir(relPath) {
  const dir = path.dirname(relPath);
  return dir === '.' ? '' : dir;
}

/**
 * `<root>/.hyperclay/conflicts/<dir>/<base>.remote-<etag8><ext>`. `.hyperclay/`
 * is never synced, so this copy can never be uploaded.
 */
function remoteCopyPath(root, relPath, etag) {
  return path.join(root, CONFLICTS_DIR, copyDir(relPath), copyName(relPath, etag));
}

function remoteCopyRef(relPath, etag) {
  return path.join(CONFLICTS_DIR, copyDir(relPath), copyName(relPath, etag));
}

async function set(metaDir, record) {
  const records = await load(metaDir);
  const key = keyFor(record.nodeId, record.path);
  const stored = { ...record };
  delete stored.nodeId;
  records[key] = stored;
  await save(metaDir, records);
  return { key, record: stored };
}

async function update(metaDir, key, fields) {
  const records = await load(metaDir);
  if (!records[key]) return null;
  records[key] = { ...records[key], ...fields };
  await save(metaDir, records);
  return { key, record: records[key] };
}

async function clear(metaDir, key) {
  const records = await load(metaDir);
  if (!records[key]) return false;
  delete records[key];
  await save(metaDir, records);
  return true;
}

module.exports = {
  CONFLICTS_FILE,
  CONFLICTS_DIR,
  KINDS,
  load,
  save,
  list,
  byPath,
  forNode,
  keyFor,
  remoteCopyPath,
  remoteCopyRef,
  set,
  update,
  clear,
};

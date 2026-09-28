/**
 * The sync root's marker: `<root>/.hyperclay/sync-root.json`, written when a
 * session binds to its folder and required from then on. A volume that is
 * unmounted, a folder that is recreated or re-cloned, or a cloud client that
 * evicts the contents all take the marker with the files, so a reconcile or a
 * remote delete refuses instead of treating the empty folder as user deletes.
 */

const fsSync = require('fs');
const path = require('upath');

const MARKER_DIR = '.hyperclay';
const MARKER_FILE = 'sync-root.json';
const IDENTITY_FILE = 'identity.json';
// A root holding only these still reads as empty.
const JUNK = new Set(['Thumbs.db', 'desktop.ini']);

function markerPath(rootPath) {
  return path.join(rootPath, MARKER_DIR, MARKER_FILE);
}

function readRootMarker(rootPath) {
  try {
    const marker = JSON.parse(fsSync.readFileSync(markerPath(rootPath), 'utf8'));
    return marker && typeof marker === 'object' ? marker : null;
  } catch {
    return null;
  }
}

function writeRootMarker(rootPath, rootId, { now = Date.now } = {}) {
  const file = markerPath(rootPath);
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify({ rootId: String(rootId), createdAt: new Date(now()).toISOString() }, null, 2));
  fsSync.renameSync(tmp, file);
}

/** Nothing the sync would scan: only dot entries and OS junk. Unreadable reads as empty. */
function rootIsEmpty(rootPath) {
  let names;
  try {
    names = fsSync.readdirSync(rootPath);
  } catch {
    return true;
  }
  return names.every((name) => name.startsWith('.') || JUNK.has(name));
}

/**
 * What the root's state means for a session. The root directory exists: the caller checked.
 *
 * @param {string} rootPath
 * @param {{rootId:string|null, required:boolean, baselineSize:number}} session
 *   `required` is `identity.json`'s `rootMarker` (the session was bound to a marked
 *   folder); `baselineSize` is the node map's entry count.
 * @returns {{refusal:null|'folder-missing'|'folder-replaced', adopt:boolean}}
 *   `adopt` means an unmarked folder is accepted as this session's and the
 *   caller writes the marker.
 */
function classifyRoot(rootPath, { rootId, required, baselineSize }) {
  if (rootId == null) return { refusal: null, adopt: false };
  const marker = readRootMarker(rootPath);
  if (marker && String(marker.rootId) === String(rootId)) return { refusal: null, adopt: false };
  const empty = rootIsEmpty(rootPath);
  if (required) {
    if (marker) return { refusal: 'folder-replaced', adopt: false };
    return { refusal: empty ? 'folder-missing' : 'folder-replaced', adopt: false };
  }
  // An install from before the marker: the folder is adopted as it stands, unless it
  // reads emptied while the baseline says it held files.
  if (empty && baselineSize > 0) return { refusal: 'folder-missing', adopt: false };
  return { refusal: null, adopt: true };
}

/** Record in `identity.json` that the session's folder is marked. No identity, nothing written. */
function flagIdentity(metaDir) {
  if (!metaDir) return false;
  const file = path.join(metaDir, IDENTITY_FILE);
  let identity;
  try {
    identity = JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!identity || typeof identity !== 'object' || identity.rootMarker === true) return false;
  fsSync.writeFileSync(file, JSON.stringify({ ...identity, rootMarker: true }, null, 2));
  return true;
}

module.exports = { MARKER_DIR, MARKER_FILE, markerPath, readRootMarker, writeRootMarker, rootIsEmpty, classifyRoot, flagIdentity };

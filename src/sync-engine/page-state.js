/**
 * Carrying a page's merge state over device sync.
 *
 * The record travels beside the content, never instead of it: on an upload the
 * record goes to the server before the bytes do, and on a download it lands in
 * the sidecar before the file is written. Every call here is best-effort — an
 * older platform answers 404 and a network failure answers nothing, and either
 * way the content sync carries on.
 */

const fs = require('fs').promises;
const path = require('upath');
const {
  readPageState, writePageState, storePageState, dropPageState, dropPageStateDir, movePageState, movePageStateDir,
  logicalDocument
} = require('../main/page-state-store');
const { getPageState, putPageState } = require('./api-client');

const PAGE_PATTERN = /\.(html|htmlclay)$/i;

const reasonOf = (error) => (error && error.message ? error.message : error);

/** The merge state this device holds for `rel`, on its way to `nodeId`. */
async function sendPageState(engine, nodeId, rel) {
  if (!PAGE_PATTERN.test(rel)) return false;
  try {
    // The record for the file on disk, which need not be the newest one the sidecar holds.
    const fileText = await fs.readFile(path.join(engine.syncFolder, rel), 'utf8');
    const rev = require('@panphora/clayjs/server/rooms').pageRev(fileText);
    const record = await readPageState(engine.syncFolder, rel, { rev, exact: true });
    if (!record) return false;
    return await putPageState(engine.conn, nodeId, record);
  } catch (error) {
    console.warn(`[SYNC] Could not send the page state for ${rel}:`, reasonOf(error));
    return false;
  }
}

/** The server's merge state for `nodeId`, or null when it has none. */
async function readPageRecord(engine, nodeId, rel) {
  if (!PAGE_PATTERN.test(rel)) return null;
  try {
    return (await getPageState(engine.conn, nodeId)) || null;
  } catch (error) {
    console.warn(`[SYNC] Could not read the page state for ${rel}:`, reasonOf(error));
    return null;
  }
}

/** The server's record beside the file, written before the file itself. */
async function applyPageRecord(engine, rel, record) {
  if (!record || !PAGE_PATTERN.test(rel)) return;
  await writePageState(engine.syncFolder, rel, record);
}

/** The bytes to store for a downloaded page: a copy still carrying its tag keeps that state in the sidecar. */
async function storedPageFile(engine, rel, content) {
  if (!PAGE_PATTERN.test(rel) || typeof content !== 'string') return content;
  return storePageState(engine.syncFolder, rel, content);
}

// A relocation already happened on disk; a sidecar that cannot follow it is
// logged and left behind, never allowed to undo the content move.
async function moveState(engine, fromRel, toRel, move) {
  try {
    await move(engine.syncFolder, fromRel, toRel);
  } catch (error) {
    console.warn(`[SYNC] Could not move the page state for ${fromRel}:`, reasonOf(error));
  }
}

/** A renamed document takes its merge state with it. */
async function moveDocumentPageState(engine, fromRel, toRel) {
  if (!fromRel || fromRel === toRel || !PAGE_PATTERN.test(fromRel)) return;
  await moveState(engine, fromRel, toRel, movePageState);
}

/** A renamed folder takes its documents' merge state with it. */
async function moveFolderPageState(engine, fromRel, toRel) {
  if (!fromRel || fromRel === toRel) return;
  await moveState(engine, fromRel, toRel, movePageStateDir);
}

// A deleted document's state goes with it: a copy restored from trash rebuilds its
// page from the article it carries, which is a new lineage.
async function dropDocumentPageState(engine, rel) {
  if (!rel || !PAGE_PATTERN.test(rel)) return;
  try {
    await dropPageState(engine.syncFolder, rel);
  } catch (error) {
    console.warn(`[SYNC] Could not drop the page state for ${rel}:`, reasonOf(error));
  }
}

/** A deleted folder takes its documents' merge state with it. */
async function dropFolderPageState(engine, rel) {
  if (!rel) return;
  try {
    await dropPageStateDir(engine.syncFolder, rel);
  } catch (error) {
    console.warn(`[SYNC] Could not drop the page state for ${rel}:`, reasonOf(error));
  }
}

// A downloaded page is confirmed with its state put back, never the clean transport body, so
// the room's baseline stays one it can render over. Over a room with unsaved edits it is a
// replacement like any other outside write: disk wins, and those edits go to a recovered copy.
async function confirmDownload(engine, target, token, rel, stored, options) {
  const authority = engine.localAuthority;
  if (!PAGE_PATTERN.test(rel) || typeof stored !== 'string') return authority.confirmKnownWrite(target, stored, token, options);
  const html = await logicalDocument(engine.syncFolder, rel, stored);
  const room = authority.rooms.get(target.canonicalPath);
  if (room && authority.roomIsDirty(room)) return authority.observeExternal(target, html, token);
  return authority.confirmKnownWrite(target, html, token, options);
}

module.exports = {
  confirmDownload,
  sendPageState, readPageRecord, applyPageRecord, storedPageFile,
  moveDocumentPageState, moveFolderPageState, dropDocumentPageState, dropFolderPageState
};

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
  readPageState, writePageState, storePageState, dropPageState, dropPageStateDir, movePageState, movePageStateDir
} = require('../main/page-state-store');
const { getPageState, putPageState } = require('./api-client');

const PAGE_PATTERN = /\.(html|htmlclay)$/i;

const reasonOf = (error) => (error && error.message ? error.message : error);

/** The merge state this device holds for `rel`, on its way to `nodeId`. */
async function sendPageState(engine, nodeId, rel) {
  if (!PAGE_PATTERN.test(rel)) return false;
  try {
    const record = await readPageState(engine.syncFolder, rel);
    if (!record) return false;
    const fileText = await fs.readFile(path.join(engine.syncFolder, rel), 'utf8');
    if (record.rev !== require('@panphora/clayjs/server/rooms').pageRev(fileText)) return false;
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

module.exports = {
  sendPageState, readPageRecord, applyPageRecord, storedPageFile,
  moveDocumentPageState, moveFolderPageState, dropDocumentPageState, dropFolderPageState
};

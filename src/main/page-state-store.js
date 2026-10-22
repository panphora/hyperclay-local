// The page editor's merge state for one document, kept out of the user's file.
// A record is { v: 1, rev, tag }, the shape splitPage and composePage use.
const fs = require('fs').promises;
const path = require('path');
const rooms = () => require('@panphora/clayjs/server/rooms');
const { PAGE_STATE_DIR } = require('./utils/artifact-paths');
const { atomicWriteFile } = require('./utils/write-queue');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const PAGE_EXTENSION = /\.(html|htmlclay)$/i;

function pageStatePath(baseDir, name) {
  const abs = path.resolve(path.join(baseDir, PAGE_STATE_DIR, name + '.json'));
  const root = path.resolve(baseDir, PAGE_STATE_DIR);
  if (!abs.startsWith(root + path.sep)) throw new Error('Page state path escapes base directory');
  return abs;
}

// The name a sidecar carried before names kept their extension: notes.html shared notes.json.
function legacyPageStatePath(baseDir, name) {
  const abs = path.resolve(path.join(baseDir, PAGE_STATE_DIR, name.replace(PAGE_EXTENSION, '') + '.json'));
  const root = path.resolve(baseDir, PAGE_STATE_DIR);
  if (!abs.startsWith(root + path.sep)) throw new Error('Page state path escapes base directory');
  return abs;
}

const validRecord = (state) => !!state && state.v === 1 && typeof state.rev === 'string' && typeof state.tag === 'string';

function parseState(text) {
  try {
    const state = JSON.parse(text);
    if (!validRecord(state)) return null;
    const prev = state.prev && validRecord({ v: 1, ...state.prev }) ? { rev: state.prev.rev, tag: state.prev.tag } : null;
    return { v: 1, rev: state.rev, tag: state.tag, ...(prev && { prev }) };
  } catch {
    return null;
  }
}

// The sidecar is written before the file lands, so it also keeps the record of the article
// it replaced: a write that never lands leaves the file on disk with its own state.
function pick(state, rev) {
  if (!state) return null;
  if (rev && state.rev !== rev && state.prev?.rev === rev) return { v: 1, rev: state.prev.rev, tag: state.prev.tag };
  return { v: 1, rev: state.rev, tag: state.tag };
}

// An old-format sidecar is adopted once, and only when the other extension's document
// is not also beside it: two documents sharing one record would merge into each other.
async function adoptLegacyPageState(baseDir, name) {
  const extension = name.match(PAGE_EXTENSION);
  if (!extension) return null;
  const other = name.slice(0, -extension[0].length) + (extension[0].toLowerCase() === '.html' ? '.htmlclay' : '.html');
  if (await exists(path.join(baseDir, other))) return null;
  const legacy = legacyPageStatePath(baseDir, name);
  let text;
  try {
    text = await fs.readFile(legacy, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const state = parseState(text);
  if (!state) return null;
  try {
    await fs.mkdir(path.dirname(pageStatePath(baseDir, name)), { recursive: true });
    await fs.rename(legacy, pageStatePath(baseDir, name));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return state;
}

async function readStored(baseDir, name) {
  let text;
  try {
    text = await fs.readFile(pageStatePath(baseDir, name), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return adoptLegacyPageState(baseDir, name);
  }
  return parseState(text);
}

// The record that belongs to one article revision, or null when the sidecar keeps none for it.
function recordFor(state, rev) {
  if (!state || !rev) return null;
  if (state.rev === rev) return { v: 1, rev, tag: state.tag };
  if (state.prev?.rev === rev) return { v: 1, rev, tag: state.prev.tag };
  return null;
}

// rev: the article revision of the file the caller holds, when it has one. exact: only
// that revision's record, never the newest one in its place.
async function readPageState(baseDir, name, { rev, exact = false } = {}) {
  const stored = await readStored(baseDir, name);
  return exact ? recordFor(stored, rev) : pick(stored, rev);
}

async function diskRev(baseDir, name) {
  try {
    return rooms().pageRev(await fs.readFile(path.join(baseDir, name), 'utf8')) || null;
  } catch {
    return null;
  }
}

async function writePageState(baseDir, name, state) {
  const file = pageStatePath(baseDir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await readStored(baseDir, name).catch(() => null);
  // The record kept beside the new one is the one for the file on disk: the newest record
  // may be for a write that never landed, and the file still needs its own.
  const onDisk = await diskRev(baseDir, name);
  const kept = onDisk && onDisk !== state.rev ? recordFor(existing, onDisk) : null;
  const prev = kept ? { rev: kept.rev, tag: kept.tag }
    : existing && existing.rev !== state.rev ? { rev: existing.rev, tag: existing.tag } : existing?.prev;
  await atomicWriteFile(file, JSON.stringify({ v: 1, rev: state.rev, tag: state.tag, ...(prev && { prev }) }));
}

async function dropPageState(baseDir, name) {
  await fs.rm(pageStatePath(baseDir, name), { force: true });
}

async function movePageState(baseDir, fromName, toName) {
  const from = pageStatePath(baseDir, fromName);
  const to = pageStatePath(baseDir, toName);
  if (!(await exists(from))) return;
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function pageStateDirPath(baseDir, name) {
  const abs = path.resolve(path.join(baseDir, PAGE_STATE_DIR, name));
  const root = path.resolve(baseDir, PAGE_STATE_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Page state path escapes base directory');
  return abs;
}

// A folder's page state is a mirror of the folder, so the whole directory moves with it.
async function movePageStateDir(baseDir, fromName, toName) {
  const from = pageStateDirPath(baseDir, fromName);
  const to = pageStateDirPath(baseDir, toName);
  if (!(await exists(from))) return;
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function dropPageStateDir(baseDir, name) {
  await fs.rm(pageStateDirPath(baseDir, name), { recursive: true, force: true });
}

// The document editors and comparisons see: the stored file with its merge state put back.
async function logicalDocument(baseDir, name, stored) {
  if (typeof stored !== 'string') return stored;
  if (!baseDir || !name) return stored;
  return rooms().composePage(stored, await readPageState(baseDir, name, { rev: rooms().pageRev(stored) }));
}

// The same composition for a caller holding the file's BYTES: a document with no
// state is handed back untouched, because decoding and re-encoding would rewrite
// every file that is not valid UTF-8.
async function logicalBytes(baseDir, name, stored) {
  if (!baseDir || !name) return stored;
  const state = await readStored(baseDir, name);
  if (!state) return stored;
  const html = stored.toString('utf8');
  return Buffer.from(rooms().composePage(html, pick(state, rooms().pageRev(html))), 'utf8');
}

// Writes the sidecar (before the caller writes the file) and returns the file to store.
async function storePageState(baseDir, name, html) {
  const { file, state } = rooms().splitPage(html);
  if (state) await writePageState(baseDir, name, state);
  return file;
}

module.exports = {
  pageStatePath, readPageState, writePageState, dropPageState, dropPageStateDir,
  movePageState, movePageStateDir, logicalDocument, logicalBytes, storePageState
};

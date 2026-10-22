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

function parseState(text) {
  try {
    const state = JSON.parse(text);
    return state && state.v === 1 && typeof state.rev === 'string' && typeof state.tag === 'string' ? state : null;
  } catch {
    return null;
  }
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

async function readPageState(baseDir, name) {
  let text;
  try {
    text = await fs.readFile(pageStatePath(baseDir, name), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return adoptLegacyPageState(baseDir, name);
  }
  return parseState(text);
}

async function writePageState(baseDir, name, state) {
  const file = pageStatePath(baseDir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, JSON.stringify({ v: 1, rev: state.rev, tag: state.tag }));
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
  return rooms().composePage(stored, await readPageState(baseDir, name));
}

// The same composition for a caller holding the file's BYTES: a document with no
// state is handed back untouched, because decoding and re-encoding would rewrite
// every file that is not valid UTF-8.
async function logicalBytes(baseDir, name, stored) {
  if (!baseDir || !name) return stored;
  const state = await readPageState(baseDir, name);
  if (!state) return stored;
  return Buffer.from(rooms().composePage(stored.toString('utf8'), state), 'utf8');
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

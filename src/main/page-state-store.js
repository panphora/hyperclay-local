// The page editor's merge state for one document, kept out of the user's file.
// A record is { v: 1, rev, tag }, the shape splitPage and composePage use.
const fs = require('fs').promises;
const path = require('path');
const { splitPage, composePage } = require('@panphora/clayjs/server/rooms');
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

function pageStatePath(baseDir, name) {
  const base = name.replace(/\.(html|htmlclay)$/i, '');
  const abs = path.resolve(path.join(baseDir, PAGE_STATE_DIR, base + '.json'));
  const root = path.resolve(baseDir, PAGE_STATE_DIR);
  if (!abs.startsWith(root + path.sep)) throw new Error('Page state path escapes base directory');
  return abs;
}

async function readPageState(baseDir, name) {
  let text;
  try {
    text = await fs.readFile(pageStatePath(baseDir, name), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const state = JSON.parse(text);
    return state && state.v === 1 && typeof state.rev === 'string' && typeof state.tag === 'string' ? state : null;
  } catch {
    return null;
  }
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

// The document editors and comparisons see: the stored file with its merge state put back.
async function logicalDocument(baseDir, name, stored) {
  if (typeof stored !== 'string') return stored;
  if (!baseDir || !name) return stored;
  return composePage(stored, await readPageState(baseDir, name));
}

// The same composition for a caller holding the file's BYTES: a document with no
// state is handed back untouched, because decoding and re-encoding would rewrite
// every file that is not valid UTF-8.
async function logicalBytes(baseDir, name, stored) {
  if (!baseDir || !name) return stored;
  const state = await readPageState(baseDir, name);
  if (!state) return stored;
  return Buffer.from(composePage(stored.toString('utf8'), state), 'utf8');
}

// Writes the sidecar (before the caller writes the file) and returns the file to store.
async function storePageState(baseDir, name, html) {
  const { file, state } = splitPage(html);
  if (state) await writePageState(baseDir, name, state);
  return file;
}

module.exports = {
  pageStatePath, readPageState, writePageState, dropPageState, movePageState, movePageStateDir,
  logicalDocument, logicalBytes, storePageState
};

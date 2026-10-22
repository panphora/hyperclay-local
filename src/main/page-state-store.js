// The page editor's merge state for one document, kept out of the user's file.
// A record is { v: 1, rev, tag }, the shape splitPage and composePage use.
const fs = require('fs').promises;
const path = require('path');
const { PAGE_STATE_DIR } = require('./utils/artifact-paths');
const { atomicWriteFile } = require('./utils/write-queue');

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
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { pageStatePath, readPageState, writePageState, dropPageState, movePageState };

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAP_FILE = 'node-map.json';
const STATE_FILE = 'sync-state.json';

async function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

async function load(metaDir) {
  const filePath = path.join(metaDir, MAP_FILE);
  let data;
  try {
    data = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    console.warn(`[SYNC] Corrupt ${MAP_FILE}; starting with empty map`);
    return new Map();
  }
  const map = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      map.set(key, { path: value, checksum: null, inode: null });
    } else {
      map.set(key, value);
    }
  }
  return map;
}

async function save(metaDir, map) {
  await fs.mkdir(metaDir, { recursive: true });
  const obj = Object.fromEntries(map);
  await atomicWrite(path.join(metaDir, MAP_FILE), JSON.stringify(obj, null, 2));
}

async function loadState(metaDir) {
  const filePath = path.join(metaDir, STATE_FILE);
  let data;
  try {
    data = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(data);
  } catch (err) {
    console.warn(`[SYNC] Corrupt ${STATE_FILE}; using empty state`);
    return {};
  }
}

async function saveState(metaDir, state) {
  await fs.mkdir(metaDir, { recursive: true });
  await atomicWrite(path.join(metaDir, STATE_FILE), JSON.stringify(state, null, 2));
}

async function getInode(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.ino;
  } catch {
    return null;
  }
}

module.exports = { load, save, loadState, saveState, getInode };

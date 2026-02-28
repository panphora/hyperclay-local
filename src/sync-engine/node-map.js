const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const META_DIR = '.sync-meta';
const MAP_FILE = 'node-map.json';
const STATE_FILE = 'sync-state.json';

async function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

async function load(syncFolder) {
  const filePath = path.join(syncFolder, META_DIR, MAP_FILE);
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

async function save(syncFolder, map) {
  const dir = path.join(syncFolder, META_DIR);
  await fs.mkdir(dir, { recursive: true });
  const obj = Object.fromEntries(map);
  await atomicWrite(path.join(dir, MAP_FILE), JSON.stringify(obj, null, 2));
}

async function loadState(syncFolder) {
  const filePath = path.join(syncFolder, META_DIR, STATE_FILE);
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

async function saveState(syncFolder, state) {
  const dir = path.join(syncFolder, META_DIR);
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2));
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

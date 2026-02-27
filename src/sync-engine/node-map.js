const fs = require('fs/promises');
const path = require('path');

const META_DIR = '.sync-meta';
const MAP_FILE = 'node-map.json';
const STATE_FILE = 'sync-state.json';

async function load(syncFolder) {
  const filePath = path.join(syncFolder, META_DIR, MAP_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    const map = new Map();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        map.set(key, { path: value, checksum: null, inode: null });
      } else {
        map.set(key, value);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

async function save(syncFolder, map) {
  const dir = path.join(syncFolder, META_DIR);
  await fs.mkdir(dir, { recursive: true });
  const obj = Object.fromEntries(map);
  await fs.writeFile(path.join(dir, MAP_FILE), JSON.stringify(obj, null, 2));
}

async function loadState(syncFolder) {
  const filePath = path.join(syncFolder, META_DIR, STATE_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveState(syncFolder, state) {
  const dir = path.join(syncFolder, META_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2));
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

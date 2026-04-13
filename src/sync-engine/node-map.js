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

async function load(metaDir, logger = null) {
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
    if (logger) {
      logger.error('SYNC', 'node-map.json is corrupt — all node mappings lost, full re-sync required', {
        error: err.message,
        filePath
      });
    }
    return new Map();
  }
  const map = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    let entry;
    if (typeof value === 'string') {
      entry = { path: value, checksum: null, inode: null };
    } else {
      entry = { ...value };
    }

    if (!entry.type && entry.path) {
      entry.type = /\.(html|htmlclay)$/i.test(entry.path) ? 'site' : 'upload';
    }

    map.set(key, entry);
  }
  return map;
}

async function save(metaDir, map, logger = null) {
  await fs.mkdir(metaDir, { recursive: true });
  const obj = Object.fromEntries(map);
  try {
    await atomicWrite(path.join(metaDir, MAP_FILE), JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error(`[SYNC] Failed to save ${MAP_FILE}:`, err);
    if (logger) {
      logger.error('SYNC', 'Failed to persist node-map to disk — sync state may be lost on restart', {
        error: err.message,
        metaDir
      });
    }
    throw err;
  }
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

function walkDescendants(map, folderPath) {
  if (!folderPath) return [];
  const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
  const results = [];
  for (const [nodeId, entry] of map) {
    if (entry.path && entry.path.startsWith(prefix)) {
      results.push({ nodeId, entry });
    }
  }
  return results;
}

module.exports = { load, save, loadState, saveState, getInode, walkDescendants };

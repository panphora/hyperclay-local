const fs = require('fs');
const path = require('path');
const { atomicWriteFile } = require('./utils/write-queue');

function servedRootsPath(userDataDir) {
  return path.join(userDataDir, 'served-roots.json');
}

function resolvedRoot(root) {
  try {
    return { path: fs.realpathSync.native(root.path), port: root.port };
  } catch {
    return null;
  }
}

async function writeServedRoots(filePath, roots) {
  const body = {
    v: 1,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    roots: roots.map(resolvedRoot).filter(Boolean),
  };
  await atomicWriteFile(filePath, JSON.stringify(body, null, 2));
}

function removeServedRoots(filePath) {
  try {
    const current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (current.pid !== process.pid) return;
    fs.unlinkSync(filePath);
  } catch {}
}

module.exports = { servedRootsPath, writeServedRoots, removeServedRoots };

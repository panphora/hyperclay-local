const fs = require('fs/promises');
const path = require('path');
const { identityOf } = require('../node-map');

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

async function snapshotDisk(root, { ignore = () => false } = {}) {
  const entries = new Map();
  const unreadable = new Set();

  async function walk(rel) {
    let dirents;
    try {
      dirents = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') unreadable.add(rel);
      return;
    }
    dirents.sort(byName);
    for (const dirent of dirents) {
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink() || ignore(childRel, dirent)) continue;
      let stat;
      try {
        stat = await fs.lstat(path.join(root, childRel), { bigint: true });
      } catch (err) {
        if (err.code !== 'ENOENT') unreadable.add(childRel);
        continue;
      }
      if (stat.isDirectory()) {
        entries.set(childRel, { type: 'folder', inode: identityOf(stat) });
        await walk(childRel);
      } else if (stat.isFile()) {
        entries.set(childRel, {
          type: 'file',
          inode: identityOf(stat),
          size: Number(stat.size),
          mtimeMs: Number(stat.mtimeMs)
        });
      }
    }
  }

  await walk('');
  return { entries, unreadable };
}

module.exports = { snapshotDisk };

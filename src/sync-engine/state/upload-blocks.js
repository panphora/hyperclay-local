const fs = require('fs').promises;
const path = require('path');
const { withFileLock, atomicWriteFile } = require('../../main/utils/write-queue');

// Attachments kept on this computer because the account's plan refuses files
// that large. Keyed by root-relative path. `limit` is the last per-file cap the
// server reported for this session, kept so a cold start offline still knows it.
const FILE = 'upload-blocks.json';

async function load(metaDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(metaDir, FILE), 'utf8'));
    return {
      limit: Number.isFinite(data.limit) && data.limit > 0 ? data.limit : null,
      files: data.files && typeof data.files === 'object' ? data.files : {},
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { limit: null, files: {} };
    throw error;
  }
}

function save(metaDir, data) {
  const file = path.join(metaDir, FILE);
  return withFileLock(file, () => atomicWriteFile(file, JSON.stringify(data, null, 2)));
}

module.exports = { load, save, FILE };

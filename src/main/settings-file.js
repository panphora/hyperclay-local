const fs = require('fs');
const path = require('path');

function renameWithRetry(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    // Windows: an indexer or antivirus holding the old file open makes the first rename fail.
    if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
    fs.renameSync(from, to);
  }
}

/**
 * Write `data` as JSON to `file` atomically: a temp file beside it, flushed to disk, then a
 * rename. On any failure the old file is left as it was and the error is returned, never thrown.
 */
function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(tmp, file);
    return { ok: true };
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, error };
  }
}

module.exports = { writeJsonAtomic };

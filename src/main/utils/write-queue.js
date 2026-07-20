// Shared serialization + atomic publication for every writer that touches a
// served file. Both the route server (src/main/server.js) and the sync engine
// (src/sync-engine/*) must go through here, or an older request can still land
// after a newer one.
//
// The queue key is ALWAYS the canonical resolved absolute path produced by
// path-resolver.js. Any other key (a raw request path, a pre-realpath join)
// hands two names for one file two different slots and makes the queue a
// silent no-op.
//
// Callers must wrap the ENTIRE read-modify-write region, not just the write:
// serializing only the write still lets two requests read the same stale base.

const fs = require('fs').promises;
const path = require('upath');

const chains = new Map();

/**
 * Run `fn` with exclusive access to `key`. Returns fn's promise; a rejection
 * propagates to the caller but never poisons the next waiter.
 * @param {string} key - canonical resolved absolute path
 * @param {() => Promise<any>} fn
 */
function withFileLock(key, fn) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('withFileLock requires a non-empty key');
  }
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(() => fn());
  const tail = run.then(() => {}, () => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

let tmpCounter = 0;

/**
 * Write via a same-directory temp file + rename, so a crash, a full disk, or a
 * killed process can never leave partial bytes at `filePath`. The rename also
 * replaces the target rather than following it, which is why callers must pass
 * an already-canonicalized path (see path-resolver.resolveWritePath).
 * @param {string} filePath - canonical resolved absolute path
 * @param {string|Buffer} content
 * @param {string|null} encoding - null for Buffer content
 */
async function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  tmpCounter = (tmpCounter + 1) % 1e6;
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${tmpCounter}.tmp`);

  // Inherit the target's permissions so a save never silently re-modes a file
  // the user chose to make group/world readable. 0o644 for a brand-new file.
  let mode = 0o644;
  try {
    mode = (await fs.stat(filePath)).mode & 0o777;
  } catch {}

  let handle = null;
  try {
    // Created 0600 so a partially written temp is never readable by anyone
    // else, then re-moded to the target's permissions just before publication.
    handle = await fs.open(tmpPath, 'wx', 0o600);
    await handle.writeFile(content, encoding === null ? undefined : encoding);
    await handle.sync();
    await handle.chmod(mode);
    await handle.close();
    handle = null;
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    try { await fs.unlink(tmpPath); } catch {}
    throw error;
  }
}

// Test seam: which keys currently hold or queue work.
function pendingKeys() {
  return [...chains.keys()];
}

module.exports = { withFileLock, atomicWriteFile, pendingKeys };

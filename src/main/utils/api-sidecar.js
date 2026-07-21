// `/_/api` data sidecar for hyperclay-local. Ports server-lib/api-sidecar.js minus
// the platform's private-site guard (local owns every file). The extracted data is
// written as a bare JSON file (no wrapper, no hash) under a HIDDEN directory:
//
//   {baseDir}/.hyperclay/api/<name-minus-ext>.json
//
// Hidden (not a visible `api/` like `tailwindcss/`) on purpose: a bare user folder
// named `api` is a real, supported site path on the platform, so a visible local
// `api/` would collide with user content and break syncing a user's own `api/`
// folder. The `.hyperclay/` directory is already excluded by every local sync scan
// (file-operations.js shouldSkipEntry, engine-watcher.js ignored, the dir listing,
// and validateAndResolvePath), so this needs zero sync-ignore edits.
//
// Every export is non-fatal: a sidecar failure must never break a save or a
// request. The file IS the data — it is served raw and regenerated on every save
// and lazily on a request miss.
const fs = require('fs').promises;
const fsConstants = require('fs').constants;
const path = require('upath');
const { extractViaTag } = require('./data-extractor');
const { realpathNearestParent, isContained } = require('./path-resolver');
const { atomicWriteFile } = require('./write-queue');
const { assertRealDirChain } = require('./real-dir-chain');

const SIDECAR_DIR = '.hyperclay/api';

// The CANONICAL base, not the lexical one — on macOS the served folder commonly
// sits under the /var -> /private/var symlink, so comparing a realpath'd target
// against a lexical base rejects every legitimate path in the folder.
async function canonicalBase(baseDir) {
  try {
    return path.resolve(await fs.realpath(baseDir));
  } catch {
    return path.resolve(baseDir);
  }
}

// Phase-4 resolution for the sidecar itself: canonicalize the nearest existing
// parent (the file usually does not exist yet), then recheck containment.
async function resolveSidecarWritePath(baseDir, abs) {
  const parentReal = await realpathNearestParent(path.dirname(abs));
  const target = path.join(parentReal, path.basename(abs));
  if (!isContained(await canonicalBase(baseDir), target)) {
    throw new Error('Sidecar path escapes base directory');
  }
  return target;
}

// The single resolver EVERY sidecar operation goes through — stat, read, write
// and unlink alike. The lexical check runs first so a crafted name is rejected
// before it touches the filesystem; canonicalizing the nearest existing parent
// then stops a planted directory symlink from redirecting the operation out of
// tree. That second half is what a lexical `path.resolve` cannot do: with
// `.hyperclay/api/blog` linked to an external folder, `blog/post.json` resolves
// lexically inside the tree while `fs.unlink` deletes the external file.
async function resolveSidecarCanonical(baseDir, name) {
  return await resolveSidecarWritePath(baseDir, resolveSidecarPath(baseDir, name));
}

// USE-TIME guarded primitives (C2). resolveSidecarCanonical does the naming +
// containment, but it canonicalizes at resolve time; a directory symlink swapped
// in before the actual syscall would still redirect it. These re-verify the
// directory chain immediately before the op and bind the final component so a
// symlink cannot be followed.

// unlink never follows the final component, so only the directory chain matters.
async function guardedUnlink(canonicalBase, target) {
  await assertRealDirChain(canonicalBase, path.dirname(target));
  try {
    await fs.unlink(target);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

// Open with O_NOFOLLOW so a symlinked final component fails the open outright
// (ELOOP), then take stat and bytes off the SAME handle so they describe one
// inode with no reopen gap. O_NOFOLLOW is a no-op on Windows; the chain check
// carries the load there.
async function guardedOpenRead(canonicalBase, target) {
  await assertRealDirChain(canonicalBase, path.dirname(target));
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  const handle = await fs.open(target, flags);
  try {
    const stat = await handle.stat();
    const text = await handle.readFile('utf8');
    return { stat, text };
  } finally {
    await handle.close();
  }
}

// "blog/post.html" -> ".hyperclay/api/blog/post.json" (strips .html / .htmlclay,
// mirroring the platform's sidecarFileName).
function sidecarRelPath(name) {
  const base = name.replace(/\.(html|htmlclay)$/, '');
  return path.join(SIDECAR_DIR, base + '.json');
}

// Absolute sidecar path with a containment check, so a crafted name can never
// escape baseDir even though callers already validate the source name.
function resolveSidecarPath(baseDir, name) {
  const abs = path.resolve(path.join(baseDir, sidecarRelPath(name)));
  const base = path.resolve(baseDir);
  if (!abs.startsWith(base + path.sep)) {
    throw new Error('Sidecar path escapes base directory');
  }
  return abs;
}

// Write the bare JSON, or delete the file when data is null (page lost its api
// tag). Empty [] / {} are valid data and ARE written. Non-fatal.
async function writeApiSidecarData(baseDir, name, data) {
  try {
    const cbase = await canonicalBase(baseDir);
    const target = await resolveSidecarCanonical(baseDir, name);
    if (data === null) {
      await guardedUnlink(cbase, target);
      return;
    }
    // Re-verify the directory chain immediately before publishing (atomicWriteFile
    // renames a temp into place, replacing rather than following a final symlink).
    await assertRealDirChain(cbase, path.dirname(target));
    await atomicWriteFile(target, JSON.stringify(data));
  } catch (e) {
    console.error('writeApiSidecarData failed (non-fatal):', e && e.message ? e.message : e);
  }
}

// Extract the api rules from html, then write/refresh the bare file (or remove it).
// A malformed / unknown-version tag can't yield valid data, so delete any stale
// file rather than keep serving outdated data. Non-fatal.
async function writeApiSidecar(baseDir, name, html) {
  let data;
  try {
    data = await extractViaTag(html, 'api'); // null when no api tag
  } catch (e) {
    console.error('writeApiSidecar extract failed (non-fatal):', e && e.message ? e.message : e);
    await writeApiSidecarData(baseDir, name, null);
    return;
  }
  await writeApiSidecarData(baseDir, name, data);
}

// Remove the sidecar if present. Non-fatal.
async function deleteApiSidecar(baseDir, name) {
  try {
    const cbase = await canonicalBase(baseDir);
    await guardedUnlink(cbase, await resolveSidecarCanonical(baseDir, name));
  } catch (e) {
    console.error('deleteApiSidecar failed (non-fatal):', e && e.message ? e.message : e);
  }
}

// Return the sidecar text only when it exists AND is at least as new as the source
// file; otherwise null (caller regenerates). The mtime check closes the
// hand-edit / external-delete staleness gap the platform never has (its files only
// change through lifecycle paths that rewrite the sidecar).
async function readFreshSidecar(baseDir, name, sourceMtimeMs) {
  try {
    const cbase = await canonicalBase(baseDir);
    const target = await resolveSidecarCanonical(baseDir, name);
    const { stat, text } = await guardedOpenRead(cbase, target);
    return stat.mtimeMs >= sourceMtimeMs ? text : null;
  } catch {
    return null;
  }
}

module.exports = {
  sidecarRelPath,
  resolveSidecarPath,
  resolveSidecarWritePath,
  resolveSidecarCanonical,
  writeApiSidecarData,
  writeApiSidecar,
  deleteApiSidecar,
  readFreshSidecar,
  guardedUnlink,
  guardedOpenRead
};

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
const path = require('upath');
const { extractViaTag } = require('./data-extractor');

const SIDECAR_DIR = '.hyperclay/api';

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
    const abs = resolveSidecarPath(baseDir, name);
    if (data === null) {
      await unlinkIfPresent(abs);
      return;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(data), 'utf8');
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
    await unlinkIfPresent(resolveSidecarPath(baseDir, name));
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
    const abs = resolveSidecarPath(baseDir, name);
    const stat = await fs.stat(abs);
    if (stat.mtimeMs >= sourceMtimeMs) {
      return await fs.readFile(abs, 'utf8');
    }
    return null;
  } catch {
    return null;
  }
}

async function unlinkIfPresent(abs) {
  try {
    await fs.unlink(abs);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

module.exports = {
  sidecarRelPath,
  resolveSidecarPath,
  writeApiSidecarData,
  writeApiSidecar,
  deleteApiSidecar,
  readFreshSidecar
};

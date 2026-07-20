// One canonical pass from "a request" to "a file operation", in explicit phases:
//
//   1. decode exactly once      — req.path is never decoded by Express, so files
//                                 with spaces or non-ASCII were unreachable. A
//                                 malformed `%` is a 400, not a 500.
//   2. validate segments        — `..`, NUL, dotfiles, reserved internals.
//   3. canonical read           — realpath, then containment.
//   4. canonical write          — realpath the NEAREST EXISTING PARENT, since
//                                 realpath(target) breaks new-file creation,
//                                 then recheck containment.
//
// Symlink policy is CONSENT, not denial, matching htmlclay. A link that already
// existed when the folder was opened is auto-registered by a bounded walk and
// logged; serving a folder that legitimately links out of tree keeps working.
// A link that appears afterwards is not registered, so both GET and POST refuse
// to follow it.
//
// Every resolved path returned here is also the queue key for write-queue.js.

const fs = require('fs').promises;
const path = require('upath');

// Bounds for the open-time consent walk, so a huge or deeply nested folder can
// never turn "open a folder" into an unbounded filesystem crawl.
const MAX_CONSENT_ENTRIES = 5000;
const MAX_CONSENT_DEPTH = 8;

// Internal directories that are never addressable over HTTP. `sites-versions`
// holds every backup of every file; the static catch-all used to serve it on
// the same origin as the save endpoint.
const RESERVED_ROOT_SEGMENTS = new Set(['sites-versions']);

class PathError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PathError';
    this.status = status;
  }
}

// upath always emits forward slashes, so containment is a plain prefix test and
// needs no platform-specific separator.
function isContained(baseReal, target) {
  if (target === baseReal) return true;
  const prefix = baseReal.endsWith('/') ? baseReal : `${baseReal}/`;
  return target.startsWith(prefix);
}

/** Phase 1. Decode exactly once; a malformed `%` sequence is a client error. */
function decodeOnce(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    throw new PathError(400, 'Malformed URL encoding');
  }
}

/**
 * Phase 2. Reject traversal and NUL outright; hide dotfiles and reserved
 * internals behind a 404 so their existence never leaks.
 */
function validateSegments(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new PathError(400, 'Invalid path');
  }
  if (relPath.includes('\0')) {
    throw new PathError(400, 'Invalid path');
  }
  if (relPath.includes('\\')) {
    throw new PathError(400, 'Invalid path');
  }
  if (path.isAbsolute(relPath)) {
    throw new PathError(400, 'Invalid path');
  }

  const segments = relPath.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new PathError(400, 'Invalid path');
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new PathError(400, 'Invalid path');
    }
    if (segment.startsWith('.')) {
      throw new PathError(404, 'File not found');
    }
    if (segment.length > 255) {
      throw new PathError(400, 'Invalid path');
    }
  }
  if (RESERVED_ROOT_SEGMENTS.has(segments[0])) {
    throw new PathError(404, 'File not found');
  }

  return segments;
}

/**
 * Walk up until realpath succeeds, then re-append the not-yet-existing tail.
 * This is what makes phase 4 work for a file that is about to be created.
 */
async function realpathNearestParent(dir) {
  const missing = [];
  let current = dir;
  for (;;) {
    try {
      const real = path.resolve(await fs.realpath(current));
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new PathError(403, 'Access denied');
      const parent = path.dirname(current);
      if (parent === current) throw new PathError(403, 'Access denied');
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The consent registry. Built once per served folder by a bounded walk at open
 * time; every out-of-tree symlink target found is registered and logged.
 */
function createConsentRegistry(baseDir, log = console.log) {
  // Starts as the lexical resolve and is replaced by the true realpath once
  // ready() runs. It MUST be canonical before any containment test: on macOS
  // the served folder often sits under /var, which is itself a symlink to
  // /private/var, so comparing a realpath'd target against a lexical base
  // rejects every legitimate path in the folder.
  let baseReal = path.resolve(baseDir);
  let roots = [];
  let scan = null;

  async function walk(dir, depth, budget, found) {
    if (depth > MAX_CONSENT_DEPTH || budget.count >= MAX_CONSENT_ENTRIES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget.count >= MAX_CONSENT_ENTRIES) return;
      budget.count += 1;

      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          RESERVED_ROOT_SEGMENTS.has(entry.name)) {
        continue;
      }

      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = path.resolve(await fs.realpath(full));
        } catch {
          continue;
        }
        if (!isContained(baseReal, target) && !found.includes(target)) {
          found.push(target);
          log(`[Server] Registered out-of-tree symlink: ${full} -> ${target}`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full, depth + 1, budget, found);
      }
    }
  }

  async function init() {
    try {
      baseReal = path.resolve(await fs.realpath(baseDir));
    } catch {
      // Folder not created yet: canonicalize it through its nearest existing
      // ancestor anyway, so containment keeps comparing like with like.
      try {
        baseReal = await realpathNearestParent(path.resolve(baseDir));
      } catch {}
    }
    // Rebuilt, not appended to: consent describes the links present at THIS
    // open, so a link that has since been removed stops being consented.
    const found = [];
    await walk(baseReal, 0, { count: 0 }, found);
    roots = found;
  }

  return {
    get baseReal() {
      return baseReal;
    },
    /** Idempotent; resolves once the base is canonical and the walk has finished. */
    ready() {
      if (!scan) scan = init().catch(() => {});
      return scan;
    },
    /**
     * Re-run the open-time registration. Called when a folder is (re)opened —
     * the registry instance is cached per folder so the write-queue keys stay
     * consistent, but "registered at open time" has to mean each open.
     */
    rescan() {
      scan = init().catch(() => {});
      return scan;
    },
    isConsented(realPath) {
      return roots.some((root) => realPath === root || realPath.startsWith(`${root}/`));
    },
    consentedRoots() {
      return [...roots];
    }
  };
}

/** Phase 3. Canonical read resolution. */
async function resolveReadPath(registry, relPath) {
  await registry.ready();
  const joined = path.resolve(path.join(registry.baseReal, relPath));
  if (!isContained(registry.baseReal, joined) && joined !== registry.baseReal) {
    throw new PathError(403, 'Access denied');
  }

  let real;
  try {
    real = path.resolve(await fs.realpath(joined));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new PathError(404, 'File not found');
    }
    throw new PathError(403, 'Access denied');
  }

  if (!isContained(registry.baseReal, real) && real !== registry.baseReal) {
    await registry.ready();
    if (!registry.isConsented(real)) {
      throw new PathError(403, 'Access denied');
    }
  }
  return real;
}

/** Phase 4. Canonical create/write resolution. */
async function resolveWritePath(registry, relPath) {
  await registry.ready();
  const joined = path.resolve(path.join(registry.baseReal, relPath));
  if (!isContained(registry.baseReal, joined)) {
    throw new PathError(403, 'Access denied');
  }

  let real;
  try {
    real = path.resolve(await fs.realpath(joined));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      throw new PathError(403, 'Access denied');
    }
    const parentReal = await realpathNearestParent(path.dirname(joined));
    real = path.join(parentReal, path.basename(joined));
  }

  if (!isContained(registry.baseReal, real)) {
    await registry.ready();
    if (!registry.isConsented(real)) {
      throw new PathError(403, 'Access denied');
    }
  }
  return real;
}

// One registry per served folder, shared process-wide. The route server and the
// sync engine MUST resolve through the same instance: the write queue is keyed
// on the resolved path, so two registries that disagree would hand one file two
// queue slots and the serialization would silently stop working.
const registries = new Map();

function getConsentRegistry(baseDir) {
  const key = path.resolve(baseDir);
  let registry = registries.get(key);
  if (!registry) {
    registry = createConsentRegistry(baseDir);
    registries.set(key, registry);
  }
  return registry;
}

/** Decode + validate + canonical read, the shape the static routes want. */
async function resolveRequestRead(registry, urlPath) {
  const decoded = decodeOnce(urlPath);
  const relPath = decoded.replace(/^\/+/, '');
  validateSegments(relPath);
  return { relPath, realPath: await resolveReadPath(registry, relPath) };
}

module.exports = {
  PathError,
  MAX_CONSENT_ENTRIES,
  MAX_CONSENT_DEPTH,
  RESERVED_ROOT_SEGMENTS,
  isContained,
  decodeOnce,
  validateSegments,
  realpathNearestParent,
  createConsentRegistry,
  getConsentRegistry,
  resolveReadPath,
  resolveWritePath,
  resolveRequestRead
};

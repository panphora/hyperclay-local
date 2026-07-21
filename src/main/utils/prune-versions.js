// Retention for sites-versions/. Delete anything older than 60 days, always keep
// the newest 20 per site, and retain the UNION of those two sets.
//
// ORDERING IS A CORRECTNESS REQUIREMENT, NOT A NICETY. This is a delete path, so
// ranking the newest version as oldest destroys the one copy the user wants back.
// Sorting must therefore go through a parsed instant, never the filename:
//
//   - New names are LOCAL WALL TIME with an explicit signed UTC offset, e.g.
//     `2026-11-01-01-30-00-431-0400` (see backup.generateTimestamp). The offset
//     resolves each name to exactly one instant, which is the whole point: local
//     time alone repeats for one hour every DST fall-back.
//   - Older names are UTC with a trailing `Z`. Also an exact instant; still
//     parsed exactly.
//   - Legacy names are LOCAL WALL TIME with NO zone. Those are genuinely
//     ambiguous, so we do not guess. For them we fall back to the file's mtime,
//     which is a real instant and cannot repeat.
//
// Note that these names no longer sort lexically, because a local timestamp with
// an offset does not. Nothing here sorts by filename, so that is fine — but any
// new caller must go through compareNewestFirst rather than comparing names.

const fs = require('fs').promises;
const path = require('upath');
const { canonicalizeBase, rebaseOntoCanonical, assertRealDirChain } = require('./real-dir-chain');

const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const KEEP_NEWEST = 20;

// `YYYY-MM-DD-HH-MM-SS-mmm`, an optional zone (a signed four-digit UTC offset,
// or the older bare `Z`), and an optional zero-padded collision suffix
// (backup.publishVersion appends `-001`, `-002`, ... when several
// versions land in one millisecond). The suffix MUST be matched here: an
// unrecognised name is one this pruner refuses to touch, so without it every
// collision-suffixed version would accumulate forever.
//
// The offset group is fixed width and positional, so `431-0400` splits into
// millis `431` and offset `-0400`; the `-` cannot be mistaken for a separator.
const VERSION_NAME = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})(Z|[+-]\d{4})?(?:-(\d{3}))?\.[A-Za-z0-9]+$/;

/**
 * Epoch ms for a version filename, or null when the name is not a version name
 * or is legacy local wall time with no zone (ambiguous — the caller must use
 * mtime instead).
 */
function parseVersionTimestamp(filename) {
  const match = VERSION_NAME.exec(filename);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds, ms, zone] = match;
  if (!zone) return null; // legacy local wall time: not a trustworthy instant

  const wallClock = Date.UTC(+year, +month - 1, +day, +hours, +minutes, +seconds, +ms);
  if (zone === 'Z') return wallClock;

  // The wall clock is local; subtract the offset to land on the real instant.
  const offsetMinutes = (+zone.slice(1, 3) * 60 + +zone.slice(3, 5)) * (zone[0] === '-' ? -1 : 1);
  return wallClock - offsetMinutes * 60 * 1000;
}

/**
 * Sort key for one entry. Prefers the unambiguous parsed instant and falls back
 * to mtime, so a legacy DST-ambiguous name can never outrank a real one.
 */
function sortKey(entry) {
  const parsed = parseVersionTimestamp(entry.name);
  return parsed === null ? entry.mtimeMs : parsed;
}

/**
 * Collision suffix as a number, 0 when absent. Two versions written in the same
 * millisecond share an instant, so the suffix is the only thing that orders
 * them — and it records the order they were actually written in.
 */
function collisionSuffix(filename) {
  const match = VERSION_NAME.exec(filename);
  return match && match[9] ? Number(match[9]) : 0;
}

/**
 * The timestamp portion of a version name, without the collision suffix or the
 * extension — i.e. the exact string generateTimestamp() produced. Used by the
 * monotonic publisher to reuse the newest committed instant when the wall clock
 * has rolled backwards. Null for a non-version name.
 */
function versionStamp(filename) {
  const m = VERSION_NAME.exec(filename);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}-${m[6]}-${m[7]}${m[8] || ''}`;
}

/**
 * Newest first. Instant, then collision suffix. Shared with data-loss-guard so
 * the delete path and the recovery path can never disagree about which version
 * is newest.
 */
function compareNewestFirst(a, b) {
  return (sortKey(b) - sortKey(a)) || (collisionSuffix(b.name) - collisionSuffix(a.name));
}

/**
 * Prune one site's versions directory.
 *
 * `baseDir` is the served folder; `siteVersionsDir` is its
 * sites-versions/<site> subtree. The chain from the served folder down to the
 * site directory is verified symlink-free on entry AND again immediately before
 * every unlink, so a directory symlink planted under sites-versions can never
 * redirect a delete out of tree. A symlinked prefix refuses the prune (no-op
 * with a log line) — the accepted break.
 * @returns {{kept: number, deleted: string[]}}
 */
async function pruneSiteVersions(baseDir, siteVersionsDir, now = Date.now()) {
  let canonicalBase;
  let chainDir;
  try {
    canonicalBase = await canonicalizeBase(baseDir);
    chainDir = rebaseOntoCanonical(canonicalBase, baseDir, siteVersionsDir);
    await assertRealDirChain(canonicalBase, chainDir);
  } catch (error) {
    console.warn(`[BACKUP] Refusing to prune ${siteVersionsDir} (non-fatal): ${error && error.message ? error.message : error}`);
    return { kept: 0, deleted: [] };
  }

  let names;
  try {
    names = await fs.readdir(siteVersionsDir);
  } catch {
    return { kept: 0, deleted: [] };
  }

  const entries = [];
  for (const name of names) {
    if (!VERSION_NAME.test(name)) continue; // never touch anything we did not write
    const full = path.join(siteVersionsDir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      entries.push({ name, full, mtimeMs: stat.mtimeMs });
    } catch {}
  }

  if (entries.length === 0) return { kept: 0, deleted: [] };

  // Newest first, by instant then collision suffix.
  entries.sort(compareNewestFirst);

  const keep = new Set();
  // Rule 1: always keep the newest 20, however old they are.
  entries.slice(0, KEEP_NEWEST).forEach((entry) => keep.add(entry.name));
  // Rule 2: keep everything inside the 60-day window. The union of the two.
  for (const entry of entries) {
    if (now - sortKey(entry) <= MAX_AGE_MS) keep.add(entry.name);
  }

  const deleted = [];
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    try {
      // Re-check the directory chain immediately before the destructive op: a
      // few lstats per rare deletion is cheap, and unlink never follows the
      // final component, so only the directory chain matters here.
      await assertRealDirChain(canonicalBase, chainDir);
      await fs.unlink(entry.full);
      deleted.push(entry.name);
    } catch {}
  }

  return { kept: keep.size, deleted };
}

/** Walk sites-versions/ and prune every site directory beneath it. */
async function pruneAllVersions(baseDir, now = Date.now()) {
  const results = { sites: 0, deleted: 0 };

  // Verify the sites-versions root is a real directory before walking. A
  // symlinked sites-versions refuses the whole sweep (the accepted break); a
  // merely-absent one is a silent no-op.
  let canonicalBase;
  try {
    canonicalBase = await canonicalizeBase(baseDir);
    await assertRealDirChain(canonicalBase, path.join(canonicalBase, 'sites-versions'));
  } catch (error) {
    console.warn(`[BACKUP] Refusing to prune sites-versions under ${baseDir} (non-fatal): ${error && error.message ? error.message : error}`);
    return results;
  }

  const root = path.join(baseDir, 'sites-versions');

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // A site directory holds version files; intermediate directories mirror the
    // site's own folder nesting, so recurse and prune wherever files appear.
    if (entries.some((entry) => entry.isFile() && VERSION_NAME.test(entry.name))) {
      const { deleted } = await pruneSiteVersions(baseDir, dir, now);
      results.sites += 1;
      results.deleted += deleted.length;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
    }
  }

  await walk(root);
  return results;
}

module.exports = {
  MAX_AGE_MS,
  KEEP_NEWEST,
  VERSION_NAME,
  parseVersionTimestamp,
  sortKey,
  collisionSuffix,
  versionStamp,
  compareNewestFirst,
  pruneSiteVersions,
  pruneAllVersions
};

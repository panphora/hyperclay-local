// Retention for sites-versions/. Delete anything older than 60 days, always keep
// the newest 20 per site, and retain the UNION of those two sets.
//
// ORDERING IS A CORRECTNESS REQUIREMENT, NOT A NICETY. This is a delete path, so
// ranking the newest version as oldest destroys the one copy the user wants back.
// Sorting must therefore go through a parsed instant, never the filename:
//
//   - New names are UTC and carry a trailing `Z` (see backup.generateTimestamp).
//     They parse unambiguously and also happen to sort lexically.
//   - Legacy names are LOCAL WALL TIME with no zone. Local wall time repeats for
//     one hour every DST fall-back, so both a lexical sort and a parsed-local
//     sort can rank two versions in the wrong order. For those we fall back to
//     the file's mtime, which is a real instant and cannot repeat.

const fs = require('fs').promises;
const path = require('upath');

const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const KEEP_NEWEST = 20;

// `YYYY-MM-DD-HH-MM-SS-mmm`, an optional trailing `Z`, and an optional
// zero-padded collision suffix (backup.writeVersionExclusive appends `-001`,
// `-002`, ... when several versions land in one millisecond). The suffix MUST be
// matched here: an unrecognised name is one this pruner refuses to touch, so
// without it every collision-suffixed version would accumulate forever.
const VERSION_NAME = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})(Z)?(?:-(\d{3}))?\.[A-Za-z0-9]+$/;

/**
 * Epoch ms for a version filename, or null when the name is not a version name
 * or is legacy local wall time (ambiguous — the caller must use mtime instead).
 */
function parseVersionTimestamp(filename) {
  const match = VERSION_NAME.exec(filename);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds, ms, zulu] = match;
  if (!zulu) return null; // legacy local wall time: not a trustworthy instant
  return Date.UTC(+year, +month - 1, +day, +hours, +minutes, +seconds, +ms);
}

/**
 * Sort key for one entry. Prefers the unambiguous parsed UTC instant and falls
 * back to mtime, so a legacy DST-ambiguous name can never outrank a real one.
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
 * Newest first. Instant, then collision suffix. Shared with data-loss-guard so
 * the delete path and the recovery path can never disagree about which version
 * is newest.
 */
function compareNewestFirst(a, b) {
  return (sortKey(b) - sortKey(a)) || (collisionSuffix(b.name) - collisionSuffix(a.name));
}

/**
 * Prune one site's versions directory.
 * @returns {{kept: number, deleted: string[]}}
 */
async function pruneSiteVersions(siteVersionsDir, now = Date.now()) {
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
      await fs.unlink(entry.full);
      deleted.push(entry.name);
    } catch {}
  }

  return { kept: keep.size, deleted };
}

/** Walk sites-versions/ and prune every site directory beneath it. */
async function pruneAllVersions(baseDir, now = Date.now()) {
  const root = path.join(baseDir, 'sites-versions');
  const results = { sites: 0, deleted: 0 };

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
      const { deleted } = await pruneSiteVersions(dir, now);
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
  parseVersionTimestamp,
  sortKey,
  collisionSuffix,
  compareNewestFirst,
  pruneSiteVersions,
  pruneAllVersions
};

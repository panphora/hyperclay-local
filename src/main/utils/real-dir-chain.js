// In-app symlink containment for the destructive filesystem paths (version
// pruning, backup writes, sidecar unlink/read/write, guard recovery).
//
// Node exposes no handle-relative unlink/rename/open (no `unlinkat`/`openat`),
// so a STRUCTURAL containment — the kind the Go side gets from os.Root — is
// impossible here. This is the strongest in-process stand-in: immediately before
// a destructive op, lstat every directory component from just below the served
// folder down to the operating directory and require each to be a real
// directory, never a symlink. A directory symlink planted under sites-versions
// or .hyperclay can then no longer redirect an unlink or a write out of tree.
//
// RESIDUAL (accepted, documented per decision): an active same-user process that
// swaps a real directory for a symlink in the sub-millisecond window between this
// lstat and the following syscall is NOT closed. Such a process already holds the
// user's full filesystem authority and gains nothing from winning that race.
// Closing it would need the handle-relative syscalls Node does not surface.

const fs = require('fs').promises;
const path = require('upath');

// Resolve the served folder to its canonical, symlink-free form ONCE per entry
// point. On macOS the served folder commonly sits under /var -> /private/var, so
// a lexical base would never line up with a realpath'd child.
async function canonicalizeBase(baseDir) {
  return path.resolve(await fs.realpath(baseDir));
}

// A path built by lexically joining onto `baseDir` (e.g. baseDir/sites-versions/
// site) still carries baseDir's own symlinked prefix. Cancel it against the
// lexical base, then re-root the remainder onto the canonical base so the chain
// walk lstats real, symlink-free prefixes.
function rebaseOntoCanonical(canonicalBase, baseDir, dir) {
  const rel = path.relative(path.resolve(baseDir), path.resolve(dir));
  return path.join(canonicalBase, rel);
}

// Assert every directory component from just below `canonicalBase` down to `dir`
// is a real directory, never a symlink. `dir` must already sit under
// `canonicalBase` (rebase it with rebaseOntoCanonical first if it was joined
// onto a lexical base). A component that does not exist yet stops the walk: it
// will be freshly mkdir'd as a real directory, or the op it guards is a no-op.
async function assertRealDirChain(canonicalBase, dir) {
  const target = path.resolve(dir);
  if (target === canonicalBase) return;

  const rel = path.relative(canonicalBase, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path chain escapes the served folder: ${dir}`);
  }

  let prefix = canonicalBase;
  for (const segment of rel.split('/')) {
    if (!segment) continue;
    prefix = path.join(prefix, segment);
    let stat;
    try {
      stat = await fs.lstat(prefix);
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isDirectory()) {
      throw new Error(`Refusing filesystem op: '${prefix}' is a symlink or not a directory`);
    }
  }
}

module.exports = { canonicalizeBase, rebaseOntoCanonical, assertRealDirChain };

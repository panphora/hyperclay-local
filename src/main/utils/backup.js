/**
 * Unified backup utility for Hyperclay Local
 * Handles backups for both server saves and sync operations
 */

const fs = require('fs').promises;
const path = require('upath');
const crypto = require('crypto');
const {
  pruneSiteVersions,
  VERSION_NAME,
  sortKey,
  collisionSuffix,
  versionStamp,
  compareNewestFirst
} = require('./prune-versions');
const { withFileLock } = require('./write-queue');
const { canonicalizeBase, rebaseOntoCanonical, assertRealDirChain } = require('./real-dir-chain');

/**
 * Generate a backup timestamp: LOCAL wall time plus the signed UTC offset in
 * force at that moment, e.g. `2026-11-01-01-30-00-431-0400`.
 *
 * Local time is what the user reads in their file browser. The offset is what
 * makes it orderable: local wall time repeats for one hour on every DST
 * fall-back, and the pruner DELETES, so a name that cannot be resolved to one
 * instant can cost the user the version they wanted back. With the offset
 * recorded, the two 01:30s carry different zones and rank correctly.
 *
 * Note the sign. getTimezoneOffset() returns POSITIVE minutes for zones BEHIND
 * UTC — New York in summer returns 240 — so it is negated here to render as
 * `-0400`. Getting that backwards inverts every ordering.
 *
 * Older names stay readable: prune-versions.js still parses the all-UTC `Z`
 * form exactly, and still falls back to mtime for legacy names with no zone.
 *
 * `now` is injectable so the monotonic publisher can render a chosen instant
 * (and tests can freeze one); it defaults to the real clock.
 */
function generateTimestamp(now = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');

  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absMinutes = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absMinutes / 60))}${pad(absMinutes % 60)}`;

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-` +
    `${pad(now.getMilliseconds(), 3)}${offset}`;
}

// The bare name plus suffixes `-001` through `-999`, so at most 1000 versions
// can share one instant before we roll the instant forward. Well past any real
// burst.
const MAX_COLLISION_ATTEMPTS = 1000;

// fs.link fails with one of these on a filesystem that has no hard links (exFAT
// USB sticks, some network shares). We fall back to a rename there so backups
// keep working rather than failing closed.
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'ENOSYS']);

const pad3 = (n) => String(n).padStart(3, '0');

// fsync a directory so a freshly linked/renamed entry survives a crash.
// Best-effort: unsupported on some platforms, and never allowed to fail a save.
async function fsyncDir(dir) {
  let handle;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch {
    // best-effort
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// Choose a name that sorts strictly AFTER every committed version (H5). Normally
// the fresh clock instant already does; but if the wall clock has rolled
// backwards to at-or-before the newest committed instant, reuse that instant's
// timestamp string and take the next collision suffix so the new file still
// ranks first under compareNewestFirst. `compareNewestFirst` stays the ONE
// ordering function shared with the pruner and the guard.
async function planVersionName(dir, candidateDate) {
  let stamp = generateTimestamp(candidateDate);
  let suffix = 0;
  let reuseInstant = null;

  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    names = [];
  }

  const committed = [];
  for (const name of names) {
    if (!VERSION_NAME.test(name)) continue; // ignore the dot-prefixed temp and foreign files
    try {
      committed.push({ name, mtimeMs: (await fs.stat(path.join(dir, name))).mtimeMs });
    } catch {}
  }

  if (committed.length) {
    committed.sort(compareNewestFirst);
    const newest = committed[0];
    const newestInstant = sortKey(newest);
    if (candidateDate.getTime() <= newestInstant) {
      stamp = versionStamp(newest.name);
      suffix = collisionSuffix(newest.name) + 1;
      reuseInstant = newestInstant;
    }
  }

  return { stamp, suffix, reuseInstant };
}

/**
 * Publish one version atomically and monotonically (H4 + H5), the whole thing
 * under a per-history withFileLock(dir).
 *
 * H4 (never a partial file): the full content is written to a dot-prefixed temp
 * in the same directory, fsynced, chmod'd and closed FIRST. The dot prefix can
 * never match VERSION_NAME, so the pruner, the data-loss guard and the listing
 * all ignore whatever a crash leaves behind. The final version name is then
 * produced by fs.link (atomic, no-replace) — or, on a filesystem without hard
 * links, by fs.rename, which is still safe because the temp is already whole and
 * durable. On any failure after the temp exists it is unlinked in `finally`, so
 * the final name never points at partial bytes.
 *
 * H5 (never mis-ranked): planVersionName picks a name that sorts strictly after
 * every committed version even across a clock rollback.
 */
async function publishVersion(dir, ext, content, encoding) {
  return await withFileLock(dir, async () => {
    const tempPath = path.join(dir, `.hyperclay-ver-${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
      const handle = await fs.open(tempPath, 'wx', 0o644);
      try {
        await handle.writeFile(content, encoding === null ? undefined : encoding);
        await handle.sync();
        await handle.chmod(0o644);
      } finally {
        await handle.close();
      }

      const plan = await planVersionName(dir, new Date());
      let { stamp, reuseInstant } = plan;
      let suffix = plan.suffix;

      for (;;) {
        if (suffix >= MAX_COLLISION_ATTEMPTS) {
          // Every suffix for this instant is taken. When reusing a committed
          // instant (clock rollback), advance it by 1ms and reset the suffix so
          // the name still sorts strictly after everything. In the ordinary
          // forward-clock case this is a genuine 1000-in-one-instant wall, so
          // surface it as before.
          if (reuseInstant == null) {
            throw new Error(`No free backup name for ${stamp}${ext} after ${MAX_COLLISION_ATTEMPTS} attempts`);
          }
          reuseInstant += 1;
          stamp = generateTimestamp(new Date(reuseInstant));
          suffix = 0;
        }

        const filename = suffix === 0 ? `${stamp}${ext}` : `${stamp}-${pad3(suffix)}${ext}`;
        const full = path.join(dir, filename);
        try {
          await fs.link(tempPath, full);
          return { filename, full };
        } catch (error) {
          if (error.code === 'EEXIST') { suffix += 1; continue; }
          if (LINK_UNSUPPORTED.has(error.code)) {
            // No hard links on this filesystem: publish by rename. The temp is
            // already fully written and fsynced, so no partial file can appear;
            // the only property lost vs link is no-replace exclusivity, which the
            // per-history withFileLock(dir) already provides.
            await fs.rename(tempPath, full);
            return { filename, full };
          }
          throw error;
        }
      }
    } finally {
      await fs.unlink(tempPath).catch(() => {}); // gone already on the rename path
      await fsyncDir(dir);
    }
  });
}

// The directory chain from the served folder down to the versions directory must
// be symlink-free before a backup writes, or a planted directory symlink could
// redirect the write out of tree (a recursive mkdir over an existing symlinked
// dir succeeds silently). Throws on violation; the caller's non-fatal catch turns
// that into a skipped backup.
async function assertVersionsChain(baseDir, versionsDir) {
  const canonicalBase = await canonicalizeBase(baseDir);
  await assertRealDirChain(canonicalBase, rebaseOntoCanonical(canonicalBase, baseDir, versionsDir));
}

// Opportunistic pruning: at most once an hour per site directory, never on the
// caller's critical path, and never able to fail a save.
const lastPruneAt = new Map();
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function maybePrune(baseDir, siteVersionsDir) {
  const now = Date.now();
  const previous = lastPruneAt.get(siteVersionsDir) || 0;
  if (now - previous < PRUNE_INTERVAL_MS) return;
  lastPruneAt.set(siteVersionsDir, now);
  pruneSiteVersions(baseDir, siteVersionsDir)
    .then(({ deleted }) => {
      if (deleted.length) {
        console.log(`[BACKUP] Pruned ${deleted.length} old version(s) from ${siteVersionsDir}`);
      }
    })
    .catch((error) => {
      console.error('[BACKUP] Prune failed (non-fatal):', error && error.message ? error.message : error);
    });
}

/**
 * Create a backup of a file
 * @param {string} baseDir - Base directory (sync folder or server folder)
 * @param {string} siteName - Site name (e.g., "mysite" or "folder1/folder2/mysite")
 * @param {string} content - Content to backup
 * @param {function} emit - Optional event emitter function
 * @param {object} logger - Optional logger instance
 */
async function createBackup(baseDir, siteName, content, emit, logger = null) {
  try {
    const versionsDir = path.join(baseDir, 'sites-versions');
    const siteVersionsDir = path.join(versionsDir, siteName);

    // Create sites-versions directory if it doesn't exist
    await fs.mkdir(versionsDir, { recursive: true });

    // Create site-specific directory if it doesn't exist
    await fs.mkdir(siteVersionsDir, { recursive: true });

    // Refuse to write through a symlinked chain (the mkdir above can silently
    // create a directory *through* an existing symlink).
    await assertVersionsChain(baseDir, siteVersionsDir);

    // Publish atomically and monotonically: a same-instant burst keeps every
    // version, a crash mid-write never leaves a partial version, and a clock
    // rollback never mis-ranks the newest.
    const { filename: backupFilename, full: backupPath } =
      await publishVersion(siteVersionsDir, '.html', content, 'utf8');
    console.log(`[BACKUP] Created: sites-versions/${siteName}/${backupFilename}`);

    maybePrune(baseDir, siteVersionsDir);

    // Log backup creation
    if (logger) {
      logger.info('BACKUP', 'Backup created', {
        site: siteName,
        backupFile: backupFilename
      });
    }

    // Emit event if emitter provided
    if (emit) {
      emit('backup-created', {
        original: siteName,
        backup: backupPath
      });
    }

    return backupPath;
  } catch (error) {
    console.error(`[BACKUP] Failed to create backup for ${siteName}:`, error.message);

    // Log backup error
    if (logger) {
      logger.error('BACKUP', 'Backup creation failed', {
        site: siteName,
        error
      });
    }

    // Don't throw error - backup failure shouldn't prevent save/sync
    return null;
  }
}

/**
 * Create backup if file exists
 * Reads the file content and creates a backup
 * @param {string} filePath - Absolute path to file
 * @param {string} siteName - Site name for backup directory
 * @param {string} baseDir - Base directory
 * @param {function} emit - Optional event emitter function
 * @param {object} logger - Optional logger instance
 */
async function createBackupIfExists(filePath, siteName, baseDir, emit, logger = null) {
  try {
    await fs.access(filePath);
    // File exists, read and backup
    const content = await fs.readFile(filePath, 'utf8');
    return await createBackup(baseDir, siteName, content, emit, logger);
  } catch {
    // File doesn't exist, no backup needed
    return null;
  }
}

/**
 * Create a binary backup of a file (for uploads - images, etc.)
 * @param {string} baseDir - Base directory (sync folder)
 * @param {string} uploadPath - Upload path (e.g., "folder/image.png")
 * @param {Buffer} content - Binary content to backup
 * @param {function} emit - Optional event emitter function
 * @param {object} logger - Optional logger instance
 */
async function createBinaryBackup(baseDir, uploadPath, content, emit, logger = null) {
  try {
    const versionsDir = path.join(baseDir, 'sites-versions');

    // Get directory and filename from path
    const pathParts = uploadPath.split('/');
    const filename = pathParts.pop();
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);

    // Build backup directory: sites-versions/uploads/<path>/<basename>/
    const backupSubdir = pathParts.length > 0
      ? path.join(...pathParts, basename)
      : basename;
    const uploadVersionsDir = path.join(versionsDir, backupSubdir);

    // Create directory if it doesn't exist
    await fs.mkdir(uploadVersionsDir, { recursive: true });

    // Refuse to write through a symlinked chain (see createBackup).
    await assertVersionsChain(baseDir, uploadVersionsDir);

    // Same atomic + monotonic publication as the HTML path — a burst of upload
    // syncs collides on the instant just as easily as a burst of saves.
    const { filename: backupFilename, full: backupPath } =
      await publishVersion(uploadVersionsDir, ext, content, null);
    console.log(`[BACKUP] Created: sites-versions/${backupSubdir}/${backupFilename}`);

    maybePrune(baseDir, uploadVersionsDir);

    // Log backup creation
    if (logger) {
      logger.info('BACKUP', 'Binary backup created', {
        upload: uploadPath,
        backupFile: backupFilename
      });
    }

    // Emit event if emitter provided
    if (emit) {
      emit('backup-created', {
        original: uploadPath,
        backup: backupPath,
        type: 'upload'
      });
    }

    return backupPath;
  } catch (error) {
    console.error(`[BACKUP] Failed to create backup for ${uploadPath}:`, error.message);

    // Log backup error
    if (logger) {
      logger.error('BACKUP', 'Binary backup creation failed', {
        upload: uploadPath,
        error
      });
    }

    // Don't throw error - backup failure shouldn't prevent sync
    return null;
  }
}

/**
 * Create binary backup if file exists
 * @param {string} filePath - Absolute path to file
 * @param {string} uploadPath - Upload path for backup directory
 * @param {string} baseDir - Base directory
 * @param {function} emit - Optional event emitter function
 * @param {object} logger - Optional logger instance
 */
async function createBinaryBackupIfExists(filePath, uploadPath, baseDir, emit, logger = null) {
  try {
    await fs.access(filePath);
    // File exists, read as binary and backup
    const content = await fs.readFile(filePath);  // No encoding = Buffer
    return await createBinaryBackup(baseDir, uploadPath, content, emit, logger);
  } catch {
    // File doesn't exist, no backup needed
    return null;
  }
}

module.exports = {
  generateTimestamp,
  createBackup,
  createBackupIfExists,
  createBinaryBackup,
  createBinaryBackupIfExists
};

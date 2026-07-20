/**
 * Unified backup utility for Hyperclay Local
 * Handles backups for both server saves and sync operations
 */

const fs = require('fs').promises;
const path = require('upath');
const { pruneSiteVersions } = require('./prune-versions');

/**
 * Generate a backup timestamp, in UTC with an explicit `Z`.
 *
 * Local wall time repeats for one hour on every DST fall-back, which makes two
 * distinct versions carry names that cannot be ordered — fatal for the pruner,
 * which deletes. UTC never repeats, so these names are both a correct instant
 * and correctly lexically sortable. Legacy local-time names already on disk stay
 * readable: prune-versions.js falls back to mtime for anything without the `Z`.
 */
function generateTimestamp() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-${milliseconds}Z`;
}

// Opportunistic pruning: at most once an hour per site directory, never on the
// caller's critical path, and never able to fail a save.
const lastPruneAt = new Map();
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function maybePrune(siteVersionsDir) {
  const now = Date.now();
  const previous = lastPruneAt.get(siteVersionsDir) || 0;
  if (now - previous < PRUNE_INTERVAL_MS) return;
  lastPruneAt.set(siteVersionsDir, now);
  pruneSiteVersions(siteVersionsDir)
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

    // Generate timestamp filename
    const timestamp = generateTimestamp();
    const backupFilename = `${timestamp}.html`;
    const backupPath = path.join(siteVersionsDir, backupFilename);

    // Write backup file
    await fs.writeFile(backupPath, content, 'utf8');
    console.log(`[BACKUP] Created: sites-versions/${siteName}/${backupFilename}`);

    maybePrune(siteVersionsDir);

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

    // Generate timestamp filename with original extension
    const timestamp = generateTimestamp();
    const backupFilename = `${timestamp}${ext}`;
    const backupPath = path.join(uploadVersionsDir, backupFilename);

    // Write backup file as binary
    await fs.writeFile(backupPath, content);
    console.log(`[BACKUP] Created: sites-versions/${backupSubdir}/${backupFilename}`);

    maybePrune(uploadVersionsDir);

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

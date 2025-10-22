/**
 * Unified backup utility for Hyperclay Local
 * Handles backups for both server saves and sync operations
 */

const fs = require('fs').promises;
const path = require('upath');

/**
 * Generate timestamp in same format as hyperclay hosted platform
 */
function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-${milliseconds}`;
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

module.exports = {
  generateTimestamp,
  createBackup,
  createBackupIfExists
};

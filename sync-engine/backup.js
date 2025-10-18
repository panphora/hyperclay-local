/**
 * Backup management for the sync engine
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { generateTimestamp } = require('./utils');
const { SYNC_CONFIG } = require('./constants');

/**
 * Create local backup before file modifications
 * Follows the same convention as hyperclay-local server.js
 */
async function createLocalBackup(filePath, syncFolder, emit) {
  try {
    // Extract site name from filename (remove .html extension)
    const fileName = path.basename(filePath);
    const siteName = fileName.replace('.html', '');

    // Create backup directory structure: sites-versions/{siteName}/
    const backupDir = path.join(
      syncFolder,
      'sites-versions',
      siteName
    );

    // Generate timestamp using same format as local server
    const timestamp = generateTimestamp();
    const backupFilename = `${timestamp}.html`;
    const backupPath = path.join(backupDir, backupFilename);

    // Ensure backup directory exists
    await fs.mkdir(backupDir, { recursive: true });

    // Copy file to backup
    await fs.copyFile(filePath, backupPath);

    console.log(`[SYNC] Backup created: sites-versions/${siteName}/${backupFilename}`);

    // Emit backup event
    if (emit) {
      emit('backup-created', {
        original: fileName,
        siteName: siteName,
        backup: backupFilename,
        path: backupPath
      });
    }

    // Clean old backups for this site
    await cleanOldBackups(backupDir, siteName);

    return backupPath;
  } catch (error) {
    console.error('[SYNC] Backup creation failed:', error);
    throw error;
  }
}

/**
 * Create backup if file exists and this is the first backup
 */
async function createBackupIfNeeded(localPath, filename, syncFolder, emit) {
  if (fsSync.existsSync(localPath)) {
    try {
      // Check if this is the first backup (no versions exist yet)
      const siteName = filename.replace('.html', '');
      const siteVersionsDir = path.join(syncFolder, 'sites-versions', siteName);
      let isFirstSave = false;

      try {
        const versionFiles = await fs.readdir(siteVersionsDir);
        isFirstSave = versionFiles.length === 0;
      } catch (error) {
        // Directory doesn't exist yet, so this is the first save
        isFirstSave = true;
      }

      // If first save, backup the existing content first (matches server.js behavior)
      if (isFirstSave) {
        console.log(`[SYNC] Creating initial backup of existing ${filename}`);
      }

      await createLocalBackup(localPath, syncFolder, emit);
    } catch (backupError) {
      // Log but continue - better to sync than fail
      console.error('[SYNC] Backup failed, continuing:', backupError);
    }
  }
}

/**
 * Keep only the most recent N backups per site
 * Backups are in sites-versions/{siteName}/ directory
 */
async function cleanOldBackups(backupDir, siteName, maxBackups = SYNC_CONFIG.MAX_BACKUPS_PER_SITE) {
  try {
    const entries = await fs.readdir(backupDir);

    // All files in this directory are backups for this site
    // They're named with timestamps: YYYY-MM-DD-HH-MM-SS-MMM.html
    const backups = entries
      .filter(f => f.endsWith('.html'))
      .sort((a, b) => b.localeCompare(a)); // Newest first (timestamps sort naturally)

    // Delete old backups beyond the limit
    const toDelete = backups.slice(maxBackups);
    for (const backup of toDelete) {
      const backupPath = path.join(backupDir, backup);
      await fs.unlink(backupPath);
      console.log(`[SYNC] Deleted old backup: sites-versions/${siteName}/${backup}`);
    }
  } catch (error) {
    console.error('[SYNC] Backup cleanup failed:', error);
  }
}

module.exports = {
  createLocalBackup,
  createBackupIfNeeded,
  cleanOldBackups
};
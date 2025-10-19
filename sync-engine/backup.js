/**
 * Backup management for the sync engine
 */

const fs = require('fs').promises;
const path = require('upath'); // Use upath for cross-platform compatibility

/**
 * Get backup directory for a file, preserving folder structure
 */
function getBackupDir(syncFolder, relativePath) {
  // Remove .html and create nested backup structure
  const parts = relativePath.replace(/\.html$/i, '').split('/');
  return path.join(syncFolder, 'sites-versions', ...parts);
}

/**
 * Create a local backup of a file
 */
async function createLocalBackup(filePath, relativePath, syncFolder, emit) {
  try {
    // Use relative path to create unique backup directory
    const backupDir = getBackupDir(syncFolder, relativePath);

    // Ensure backup directory exists
    await fs.mkdir(backupDir, { recursive: true });

    // Create timestamped backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup-${timestamp}.html`;
    const backupPath = path.join(backupDir, backupName);

    // Copy file to backup location
    await fs.copyFile(filePath, backupPath);

    console.log(`[BACKUP] Created backup: ${backupPath}`);

    if (emit) {
      emit('backup-created', {
        original: relativePath,
        backup: backupPath
      });
    }

    return backupPath;
  } catch (error) {
    console.error(`[BACKUP] Failed to create backup for ${relativePath}:`, error);
    return null;
  }
}

/**
 * Create backup if file exists
 */
async function createBackupIfNeeded(localPath, relativePath, syncFolder, emit) {
  try {
    await fs.access(localPath);
    // File exists, create backup
    return await createLocalBackup(localPath, relativePath, syncFolder, emit);
  } catch {
    // File doesn't exist, no backup needed
    return null;
  }
}

module.exports = {
  createLocalBackup,
  createBackupIfNeeded
};
/**
 * Local file operations for the sync engine
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/**
 * Get list of local HTML files
 */
async function getLocalFiles(syncFolder) {
  const files = new Map();

  try {
    const entries = await fs.readdir(syncFolder);

    for (const entry of entries) {
      // Only sync .html files
      if (!entry.endsWith('.html')) continue;

      const filePath = path.join(syncFolder, entry);
      const stat = await fs.stat(filePath);

      if (stat.isFile()) {
        files.set(entry, {
          path: filePath,
          mtime: stat.mtime,
          size: stat.size
        });
      }
    }
  } catch (error) {
    console.error('[SYNC] Error reading local files:', error);
  }

  return files;
}

/**
 * Read file content
 */
async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

/**
 * Write file with content and set modification time
 */
async function writeFile(filePath, content, mtime = null) {
  await fs.writeFile(filePath, content, 'utf8');

  if (mtime) {
    const mtimeDate = new Date(mtime);
    await fs.utimes(filePath, mtimeDate, mtimeDate);
  }
}

/**
 * Check if file exists
 */
function fileExists(filePath) {
  return fsSync.existsSync(filePath);
}

/**
 * Get file stats
 */
async function getFileStats(filePath) {
  return fs.stat(filePath);
}

/**
 * Ensure directory exists
 */
async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Copy file from source to destination
 */
async function copyFile(source, destination) {
  await fs.copyFile(source, destination);
}

/**
 * Delete file
 */
async function deleteFile(filePath) {
  await fs.unlink(filePath);
}

/**
 * Read directory contents
 */
async function readDirectory(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch (error) {
    // Directory doesn't exist
    return [];
  }
}

module.exports = {
  getLocalFiles,
  readFile,
  writeFile,
  fileExists,
  getFileStats,
  ensureDirectory,
  copyFile,
  deleteFile,
  readDirectory
};
/**
 * Local file operations for the sync engine
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('upath'); // Use upath for cross-platform compatibility
const crypto = require('crypto');

/**
 * Get all local HTML files recursively with relative paths
 */
async function getLocalFiles(syncFolder) {
  const files = new Map();

  async function scanDirectory(dirPath, relativePath = '') {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name;

        if (entry.isDirectory()) {
          // Skip system directories and uploads folder (uploads have their own sync)
          if (!entry.name.startsWith('.') &&
              entry.name !== 'node_modules' &&
              entry.name !== 'sites-versions' &&
              entry.name !== 'tailwindcss') {
            // Recursively scan subdirectories
            await scanDirectory(fullPath, relPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
          const stats = await fs.stat(fullPath);

          // relPath is already normalized by upath.join() to forward slashes
          files.set(relPath, {
            path: fullPath,
            relativePath: relPath,
            mtime: stats.mtime,
            size: stats.size
          });
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  await scanDirectory(syncFolder);
  return files;
}

/**
 * Read file content
 */
async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

/**
 * Write file ensuring parent directories exist
 */
async function writeFile(filePath, content, modifiedTime) {
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Write the file
  await fs.writeFile(filePath, content, 'utf8');

  // Set modification time if provided
  if (modifiedTime) {
    const mtime = new Date(modifiedTime);
    await fs.utimes(filePath, mtime, mtime);
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
 * Move file from source to destination, creating parent directories as needed.
 * Falls back to copy+delete for cross-device moves.
 */
async function moveFile(source, destination) {
  const dir = path.dirname(destination);
  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (error.code === 'EXDEV') {
      await fs.copyFile(source, destination);
      await fs.unlink(source);
    } else {
      throw error;
    }
  }
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

// =============================================================================
// UPLOAD-SPECIFIC FILE OPERATIONS
// =============================================================================

/**
 * Get all local uploads recursively
 * Scans <syncFolder>/uploads/ and returns all files
 * @returns {Map<string, {path: string, relativePath: string, mtime: Date, size: number}>}
 */
async function getLocalUploads(syncFolder) {
  const files = new Map();

  async function scanDirectory(dirPath, relativePath = '') {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'sites-versions' ||
            entry.name === 'tailwindcss') {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name;

        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relPath);
        } else if (entry.isFile() && !entry.name.endsWith('.html')) {
          const stats = await fs.stat(fullPath);
          files.set(relPath, {
            path: fullPath,
            relativePath: relPath,
            mtime: stats.mtime,
            size: stats.size
          });
        }
      }
    } catch (error) {
      console.error(`Error scanning uploads directory ${dirPath}:`, error);
    }
  }

  await scanDirectory(syncFolder);
  return files;
}

/**
 * Read file as Buffer (for binary files)
 */
async function readFileBuffer(filePath) {
  return fs.readFile(filePath); // No encoding = returns Buffer
}

/**
 * Write Buffer to file
 */
async function writeFileBuffer(filePath, buffer, modifiedTime) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  if (modifiedTime) {
    const mtime = new Date(modifiedTime);
    await fs.utimes(filePath, mtime, mtime);
  }
}

/**
 * Calculate checksum from Buffer
 */
function calculateBufferChecksum(buffer) {
  return crypto.createHash('sha256')
    .update(buffer)
    .digest('hex')
    .substring(0, 16);
}

module.exports = {
  getLocalFiles,
  readFile,
  writeFile,
  fileExists,
  getFileStats,
  ensureDirectory,
  copyFile,
  moveFile,
  deleteFile,
  readDirectory,
  // Upload-specific
  getLocalUploads,
  readFileBuffer,
  writeFileBuffer,
  calculateBufferChecksum
};
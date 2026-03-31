/**
 * Validation rules for local file operations
 * Platform-specific restrictions (reserved names) are validated server-side during sync
 */

const WINDOWS_RESERVED = [
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
];

/**
 * Validate folder name
 * Must be lowercase letters, numbers, underscore, hyphen only
 */
function validateFolderName(name) {
  // Check if empty
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: 'Folder name cannot be empty'
    };
  }

  // Check for invalid characters
  if (!name.match(/^[a-z0-9_-]+$/)) {
    return {
      valid: false,
      error: 'Folder names can only contain lowercase letters, numbers, hyphens and underscores'
    };
  }

  // Check length
  if (name.length > 255) {
    return {
      valid: false,
      error: 'Folder name is too long (max 255 characters)'
    };
  }

  return { valid: true };
}

/**
 * Validate site name — must include .html or .htmlclay extension
 */
function validateSiteName(name) {
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: `Invalid site name: "${name}". Site name cannot be empty`
    };
  }

  if (name.length > 255) {
    return {
      valid: false,
      error: `Invalid site name: "${name}". Site name is too long (max 255 characters)`
    };
  }

  if (!/^[a-z0-9_-]+\.(html|htmlclay)$/.test(name)) {
    return {
      valid: false,
      error: `Invalid site name: "${name}". Must be lowercase letters, numbers, hyphens, underscores, ending with .html or .htmlclay`
    };
  }

  const baseName = name.replace(/\.(html|htmlclay)$/, '');

  if (baseName.startsWith('-') || baseName.endsWith('-')) {
    return {
      valid: false,
      error: `Invalid site name: "${name}". Cannot start or end with a hyphen`
    };
  }

  if (baseName.includes('--')) {
    return {
      valid: false,
      error: `Invalid site name: "${name}". Cannot contain consecutive hyphens`
    };
  }

  if (WINDOWS_RESERVED.includes(baseName)) {
    return {
      valid: false,
      error: `"${baseName}" is a reserved system name`
    };
  }

  return { valid: true };
}

/**
 * Validate upload/file name
 * More permissive than sites/folders but still has restrictions
 */
function validateUploadName(name) {
  // Check if empty
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: 'File name cannot be empty'
    };
  }

  // Check length (byte length for UTF-8)
  const byteLength = Buffer.from(name).length;
  if (byteLength > 255) {
    return {
      valid: false,
      error: 'File name is too long (max 255 bytes)'
    };
  }

  // Prevent leading/trailing dots
  if (name.startsWith('.') || name.endsWith('.')) {
    return {
      valid: false,
      error: 'File name cannot start or end with a dot'
    };
  }

  // Prevent control characters and problematic chars
  // Blocks: Control chars, /, \, <, >, :, ", |, ?, *, null byte
  // Also blocks full-width punctuation that server sanitizes: ：？｜，。！￥…（）—
  if (/[\x00-\x1F\x7F\/\\<>:"|?*\u0000：？｜，。！￥…（）—]/u.test(name)) {
    return {
      valid: false,
      error: 'File name contains invalid characters'
    };
  }

  // Check for Windows reserved names
  const lowerName = name.toLowerCase();
  const baseName = lowerName.split('.')[0];
  if (WINDOWS_RESERVED.includes(baseName)) {
    return {
      valid: false,
      error: 'This file name is reserved by the system'
    };
  }

  return { valid: true };
}

/**
 * Validate full upload path (folder/folder/file.ext)
 * Used for upload sync validation
 */
function validateUploadPath(fullPath) {
  const parts = fullPath.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { valid: false, error: 'Empty path' };
  }

  // Check folder depth (max 5 folders)
  if (parts.length > 6) {  // 5 folders + 1 filename
    return {
      valid: false,
      error: 'Folder depth cannot exceed 5 levels'
    };
  }

  // Validate each folder in the path
  for (let i = 0; i < parts.length - 1; i++) {
    const folderResult = validateFolderName(parts[i]);
    if (!folderResult.valid) {
      return {
        valid: false,
        error: `Invalid folder "${parts[i]}": ${folderResult.error}`
      };
    }
  }

  // Validate the filename (last part)
  const filename = parts[parts.length - 1];
  const fileResult = validateUploadName(filename);

  if (!fileResult.valid) {
    return {
      valid: false,
      error: `Invalid filename: ${fileResult.error}`
    };
  }

  return { valid: true };
}

/**
 * Determine file type from filename/path
 */
function getFileType(filename, isDirectory = false) {
  if (isDirectory) {
    return 'folder';
  }

  // Sites have .html or .htmlclay extension
  if (filename.endsWith('.html') || filename.endsWith('.htmlclay')) {
    return 'site';
  }

  // Everything else would be an upload (when we support them)
  return 'upload';
}

/**
 * Main validation function
 * Returns { valid: boolean, error?: string, type: string }
 */
function validateFileName(filename, isDirectory = false) {
  const type = getFileType(filename, isDirectory);

  const nameToValidate = filename;

  let result;
  switch (type) {
    case 'folder':
      result = validateFolderName(nameToValidate);
      break;
    case 'site':
      result = validateSiteName(nameToValidate);
      break;
    case 'upload':
      result = validateUploadName(nameToValidate);
      break;
    default:
      result = { valid: false, error: 'Unknown file type' };
  }

  return { ...result, type };
}

/**
 * Validate a full path (folder/folder/file.html)
 */
function validateFullPath(fullPath) {
  const parts = fullPath.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { valid: false, error: 'Empty path' };
  }

  // Check folder depth (parts.length - 1 because last part is filename)
  const folderDepth = parts.length - 1;
  if (folderDepth > 5) {
    return {
      valid: false,
      error: 'Folder depth cannot exceed 5 levels. Please reorganize your files into a shallower structure.'
    };
  }

  // Validate each folder in the path
  for (let i = 0; i < parts.length - 1; i++) {
    const folderResult = validateFolderName(parts[i]);
    if (!folderResult.valid) {
      return {
        valid: false,
        error: `Invalid folder "${parts[i]}": ${folderResult.error}`
      };
    }
  }

  // Validate the filename (last part)
  const filename = parts[parts.length - 1];
  const isDirectory = !filename.includes('.');
  const fileResult = validateFileName(filename, isDirectory);

  if (!fileResult.valid) {
    return {
      valid: false,
      error: `Invalid ${fileResult.type} name "${filename}": ${fileResult.error}`
    };
  }

  return { valid: true, type: fileResult.type };
}

module.exports = {
  validateFileName,
  validateFolderName,
  validateSiteName,
  validateUploadName,
  validateUploadPath,
  validateFullPath,
  getFileType
};
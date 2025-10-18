/**
 * Validation rules that match server-side requirements
 * Validates names BEFORE attempting to sync to prevent failures
 */

// Reserved words that cannot be used as site names
const RESERVED_WORDS = [
  'about', 'account', 'admin', 'api', 'app', 'apps', 'auth', 'backup',
  'billing', 'blog', 'cdn', 'checkout', 'code', 'config', 'console',
  'contact', 'dashboard', 'data', 'delete', 'demo', 'dev', 'docs',
  'download', 'edit', 'email', 'error', 'faq', 'feed', 'file', 'files',
  'forum', 'ftp', 'git', 'help', 'home', 'host', 'hosting', 'http',
  'https', 'image', 'images', 'imap', 'info', 'install', 'invoice',
  'javascript', 'js', 'json', 'legal', 'license', 'load', 'local',
  'localhost', 'log', 'login', 'logout', 'mail', 'manage', 'media',
  'message', 'mobile', 'mx', 'my', 'new', 'news', 'ns', 'ns1', 'ns2',
  'order', 'page', 'pages', 'pay', 'payment', 'policy', 'pop', 'pop3',
  'portal', 'post', 'privacy', 'private', 'profile', 'public', 'purchase',
  'redirect', 'register', 'remove', 'report', 'root', 'rss', 'sale',
  'save', 'search', 'secure', 'security', 'server', 'service', 'services',
  'settings', 'setup', 'shop', 'signin', 'signup', 'site', 'sites',
  'smtp', 'sql', 'ssh', 'ssl', 'static', 'stats', 'status', 'store',
  'style', 'styles', 'subdomain', 'subscribe', 'support', 'system',
  'team', 'terms', 'test', 'theme', 'themes', 'tmp', 'tools', 'tos',
  'transfer', 'update', 'upgrade', 'upload', 'uploads', 'url', 'user',
  'users', 'verify', 'video', 'view', 'web', 'webmail', 'website',
  'welcome', 'widget', 'widgets', 'wiki', 'www', 'www1', 'www2', 'xml'
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
 * Validate site name
 * Must follow hyperclay rules for site names
 */
function validateSiteName(name) {
  // Check if empty
  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: 'Site name cannot be empty'
    };
  }

  // Strip .html extension if present (we add it back later)
  const baseName = name.replace(/\.html$/i, '');

  // Check length
  if (baseName.length < 1) {
    return {
      valid: false,
      error: 'Site name is too short'
    };
  }
  if (baseName.length > 63) {
    return {
      valid: false,
      error: 'Site name is too long (max 63 characters)'
    };
  }

  // Check format - only letters, numbers, and hyphens
  if (!baseName.match(/^[a-zA-Z0-9-]+$/)) {
    return {
      valid: false,
      error: 'Site name can only contain letters (A-Z), numbers (0-9), and hyphens (-)'
    };
  }

  // Cannot start or end with hyphen
  if (baseName.startsWith('-') || baseName.endsWith('-')) {
    return {
      valid: false,
      error: 'Site name cannot start or end with a hyphen'
    };
  }

  // Check for consecutive hyphens
  if (baseName.includes('--')) {
    return {
      valid: false,
      error: 'Site name cannot contain consecutive hyphens'
    };
  }

  // Check reserved words (case-insensitive)
  const lowerName = baseName.toLowerCase();
  if (RESERVED_WORDS.includes(lowerName)) {
    return {
      valid: false,
      error: `"${baseName}" is a reserved word and cannot be used as a site name`
    };
  }

  // Check for common typos/variations of reserved words
  if (lowerName === 'wwww' || lowerName.match(/^www\d+$/)) {
    return {
      valid: false,
      error: 'This variation of "www" cannot be used as a site name'
    };
  }

  return { valid: true };
}

/**
 * Validate upload/file name
 * More permissive than sites/folders but still has restrictions
 * NOTE: This is a placeholder for future upload sync support
 */
function validateUploadName(name) {
  // For now, we don't sync uploads, so this is just a placeholder
  // that shows the structure for when we do implement it

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
      error: 'File name is too long'
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
  if (/[\x00-\x1F\x7F\/\\<>:"|?*\u0000]/u.test(name)) {
    return {
      valid: false,
      error: 'File name contains invalid characters'
    };
  }

  // Check for Windows reserved names
  const lowerName = name.toLowerCase();
  const baseName = lowerName.split('.')[0];
  const problematicNames = [
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
  ];

  if (problematicNames.includes(baseName)) {
    return {
      valid: false,
      error: 'This file name is reserved by the system'
    };
  }

  // For now, since we don't sync uploads, always return valid
  // This structure is here for future implementation
  return { valid: true };
}

/**
 * Determine file type from filename/path
 */
function getFileType(filename, isDirectory = false) {
  if (isDirectory) {
    return 'folder';
  }

  // Sites have .html extension
  if (filename.endsWith('.html')) {
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

  // Remove .html extension for site validation
  const nameToValidate = type === 'site'
    ? filename.replace(/\.html$/i, '')
    : filename;

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
  validateFullPath,
  getFileType,
  RESERVED_WORDS
};
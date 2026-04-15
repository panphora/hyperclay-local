/**
 * Pure path helpers used across the sync engine.
 * No state, no I/O — safe to import anywhere.
 */

const path = require('upath');

function hasHiddenSegment(filePath) {
  return filePath.split('/').some(segment => segment.startsWith('.'));
}

function toFileId(relPath) {
  return path.normalize(relPath).replace(/\.(html|htmlclay)$/i, '');
}

function classifyPath(relativePath, eventType) {
  if (eventType === 'addDir' || eventType === 'unlinkDir') {
    return 'folder';
  }
  if (/\.(html|htmlclay)$/i.test(relativePath)) {
    return 'site';
  }
  return 'upload';
}

function ancestorPaths(normalizedPath) {
  if (!normalizedPath || normalizedPath === '' || normalizedPath === '.') return [];
  const parts = normalizedPath.split('/').filter(Boolean);
  const ancestors = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

module.exports = {
  hasHiddenSegment,
  toFileId,
  classifyPath,
  ancestorPaths
};

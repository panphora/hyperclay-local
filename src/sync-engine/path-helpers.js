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

module.exports = {
  hasHiddenSegment,
  toFileId,
  classifyPath
};

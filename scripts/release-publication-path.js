'use strict';

function publicationAttemptDirectoryName(attemptId, platform = process.platform) {
  return platform === 'win32' ? encodeURIComponent(attemptId) : attemptId;
}

module.exports = { publicationAttemptDirectoryName };

/**
 * Error handling utilities for the sync engine
 */

const { ERROR_PRIORITY, ERROR_TYPES } = require('./constants');

/**
 * Classify error and determine priority and type
 */
function classifyError(error, context = {}) {
  const { filename, action } = context;

  let priority = ERROR_PRIORITY.HIGH;
  let errorType = ERROR_TYPES.UNKNOWN;
  let userMessage = error.message;

  const errorMsg = error.message.toLowerCase();

  // Authentication errors
  if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('unauthorized')) {
    priority = ERROR_PRIORITY.CRITICAL;
    errorType = ERROR_TYPES.AUTH_FAILURE;
    userMessage = 'Authentication failed. Please reconnect with a valid API key.';
  }
  // Name conflict errors
  else if (errorMsg.includes('already taken') || errorMsg.includes('name conflict')) {
    priority = ERROR_PRIORITY.CRITICAL;
    errorType = ERROR_TYPES.NAME_CONFLICT;
    if (filename) {
      const siteName = filename.replace('.html', '');
      userMessage = `The name "${siteName}" is already taken by another user. Please rename your local file.`;
    } else {
      userMessage = 'This name is already taken by another user. Please rename your local file.';
    }
  }
  // Network errors
  else if (errorMsg.includes('fetch failed') || errorMsg.includes('enotfound') ||
           errorMsg.includes('network') || errorMsg.includes('etimedout')) {
    priority = ERROR_PRIORITY.MEDIUM;
    errorType = ERROR_TYPES.NETWORK_ERROR;
    userMessage = 'Network connection issue. Will retry automatically.';
  }
  // File access errors
  else if (errorMsg.includes('eacces') || errorMsg.includes('eperm') ||
           errorMsg.includes('permission') || errorMsg.includes('access denied')) {
    priority = ERROR_PRIORITY.HIGH;
    errorType = ERROR_TYPES.FILE_ACCESS;
    userMessage = filename
      ? `Cannot write to file: ${filename}. Check file permissions.`
      : 'File access error. Check file permissions.';
  }
  // Sync conflict errors
  else if (errorMsg.includes('conflict') || errorMsg.includes('mismatch')) {
    priority = ERROR_PRIORITY.HIGH;
    errorType = ERROR_TYPES.SYNC_CONFLICT;
    userMessage = 'Sync conflict detected. Manual resolution may be required.';
  }
  // Reserved name errors (from server validation)
  else if (errorMsg.includes(' is reserved')) {
    priority = ERROR_PRIORITY.HIGH;
    errorType = ERROR_TYPES.NAME_CONFLICT;
    const siteName = filename ? filename.replace(/\.html$/i, '') : 'This name';
    userMessage = `"${siteName}" is a reserved name. Rename to sync.`;
  }

  return {
    priority,
    errorType,
    userMessage,
    originalError: error.message,
    dismissable: priority > ERROR_PRIORITY.CRITICAL,
    action,
    filename,
    timestamp: Date.now()
  };
}

/**
 * Format error for logging
 */
function formatErrorForLog(error, context = {}) {
  const classified = classifyError(error, context);
  const timestamp = new Date().toISOString();

  return {
    time: timestamp,
    file: context.filename,
    action: context.action,
    error: error.message,
    type: classified.errorType,
    priority: classified.priority
  };
}

/**
 * Determine if error is retryable
 */
function isRetryableError(error) {
  const errorMsg = error.message.toLowerCase();

  // Non-retryable errors
  if (errorMsg.includes('already taken') ||
      errorMsg.includes('401') ||
      errorMsg.includes('403') ||
      errorMsg.includes('unauthorized') ||
      errorMsg.includes('permission')) {
    return false;
  }

  // Retryable errors (network issues, temporary failures)
  if (errorMsg.includes('fetch failed') ||
      errorMsg.includes('enotfound') ||
      errorMsg.includes('network') ||
      errorMsg.includes('etimedout') ||
      errorMsg.includes('500') ||
      errorMsg.includes('502') ||
      errorMsg.includes('503') ||
      errorMsg.includes('504')) {
    return true;
  }

  // Default to not retrying unknown errors
  return false;
}

module.exports = {
  classifyError,
  formatErrorForLog,
  isRetryableError
};
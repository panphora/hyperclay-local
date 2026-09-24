/**
 * Utility functions for the sync engine
 */

const crypto = require('crypto');
const { SYNC_CONFIG } = require('./constants');
const { syncUrl, authHeaders } = require('./api-client');

/**
 * Calculate file checksum
 */
async function calculateChecksum(content) {
  return crypto.createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate timestamp in same format as hyperclay local server
 * Format: YYYY-MM-DD-HH-MM-SS-MMM
 */
function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-${milliseconds}`;
}

/**
 * Check if local file is newer than server file
 */
function isLocalNewer(localMtime, serverTime, clockOffset) {
  const adjustedLocalTime = localMtime.getTime() + clockOffset;
  const serverMtime = new Date(serverTime).getTime();

  // If times are within buffer, they're considered "same time"
  const diff = Math.abs(adjustedLocalTime - serverMtime);
  if (diff <= SYNC_CONFIG.TIME_BUFFER) {
    return false; // Within buffer, use server version
  }

  return adjustedLocalTime > serverMtime;
}

/**
 * Check if file is in the future (likely intentional)
 */
function isFutureFile(mtime, clockOffset) {
  const adjustedTime = mtime.getTime() + clockOffset;
  const now = Date.now();
  return adjustedTime > now + 60000; // More than 1 minute in future
}

/**
 * Calibrate local clock with server
 */
async function calibrateClock(conn, logger = null) {
  try {
    const response = await fetch(syncUrl(conn, '/status'), {
      headers: authHeaders(conn)
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const serverTime = new Date(data.serverTime).getTime();
    const localTime = Date.now();

    const clockOffset = serverTime - localTime;

    console.log(`[SYNC] Clock offset: ${clockOffset}ms`);
    return clockOffset;
  } catch (error) {
    console.error('[SYNC] Failed to calibrate clock:', error);
    if (logger) {
      logger.warn('SYNC', 'Clock calibration failed - using zero offset, timestamps may be unreliable', {
        error: error.message,
        statusCode: error.statusCode
      });
    }
    return 0; // Assume no offset if calibration fails
  }
}

/**
 * Read (and clear) what this root's server owes the platform for a file: the
 * live-sync snapshot from /live-sync/save, plus the userDriven bit from /save.
 * Lazy require — main/server.js pulls in Electron-only modules that cannot
 * load at the top level during unit tests, and a missing server is not an error.
 */
function getLegacySnapshot(rel) {
  try {
    const { getAndClearSnapshot } = require('../main/server.js');
    return getAndClearSnapshot(rel);
  } catch (err) {
    return null;
  }
}

module.exports = {
  calculateChecksum,
  generateTimestamp,
  isLocalNewer,
  isFutureFile,
  calibrateClock,
  getLegacySnapshot
};
/**
 * Utility functions for the sync engine
 */

const crypto = require('crypto');
const { SYNC_CONFIG } = require('./constants');

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
async function calibrateClock(serverUrl, apiKey) {
  try {
    const response = await fetch(`${serverUrl}/sync/status`, {
      headers: {
        'X-API-Key': apiKey
      }
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
    return 0; // Assume no offset if calibration fails
  }
}

module.exports = {
  calculateChecksum,
  generateTimestamp,
  isLocalNewer,
  isFutureFile,
  calibrateClock
};
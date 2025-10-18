/**
 * Shared utility functions for Hyperclay Local
 */

/**
 * Determine the base server URL for sync operations
 * @param {string} serverUrl - Optional custom server URL
 * @returns {string} The base server URL
 */
function getServerBaseUrl(serverUrl) {
  if (serverUrl) {
    return serverUrl;
  }

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  return isDev ? 'http://localhyperclay.com:8989' : 'https://hyperclay.com';
}

module.exports = {
  getServerBaseUrl
};
/**
 * Constants and configuration for the sync engine
 */

// Error priority levels
const ERROR_PRIORITY = {
  CRITICAL: 1,   // Show immediately, don't auto-dismiss
  HIGH: 2,       // Show immediately, auto-dismiss after 10s
  MEDIUM: 3,     // Show in queue, auto-dismiss after 5s
  LOW: 4         // Log only, don't show UI
};

// Error type mappings
const ERROR_TYPES = {
  NAME_CONFLICT: 'name_conflict',
  AUTH_FAILURE: 'auth_failure',
  NETWORK_ERROR: 'network_error',
  FILE_ACCESS: 'file_access',
  SYNC_CONFLICT: 'sync_conflict',
  UNKNOWN: 'unknown'
};

// Sync configuration
const SYNC_CONFIG = {
  POLL_INTERVAL: 30000,      // Poll every 30 seconds
  TIME_BUFFER: 10000,        // 10 seconds buffer for "same time"
  MAX_RETRIES: 3,
  RETRY_DELAYS: [5000, 15000, 60000], // 5s, 15s, 60s exponential backoff
  FILE_STABILIZATION: {
    stabilityThreshold: 1000,
    pollInterval: 100
  }
};

module.exports = {
  ERROR_PRIORITY,
  ERROR_TYPES,
  SYNC_CONFIG
};
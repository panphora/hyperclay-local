const fs = require('fs').promises;
const path = require('upath');
const { app } = require('electron');

// Helper functions for formatting timestamps
function formatDate(date) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function formatTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace('Z', ''); // YYYY-MM-DD HH:MM:SS.mmm
}

// Safe serializer for metadata - handles circular refs and Error objects
function safeStringify(obj) {
  try {
    // Handle Error objects specially - include stack trace
    if (obj instanceof Error) {
      return JSON.stringify({
        name: obj.name,
        message: obj.message,
        stack: obj.stack
      });
    }

    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      // Filter out circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    return '[Unserializable]';
  }
}

// Sanitize paths to remove base directory (privacy protection)
function sanitizePath(fullPath, baseDir) {
  if (!fullPath || !baseDir) return fullPath;
  if (fullPath.startsWith(baseDir)) {
    return fullPath.slice(baseDir.length + 1); // Remove base + separator
  }
  return fullPath;
}

class SyncLogger {
  constructor() {
    this.logDir = null;
    this.currentLogFile = null;
    this.currentDate = null;
    this.baseDir = null; // Store base directory for path sanitization
  }

  // Initialize logger with log directory
  async init(baseDir = null) {
    try {
      const logsPath = app.getPath('logs');
      this.logDir = path.join(logsPath, 'sync');
      this.baseDir = baseDir; // Store for sanitizing paths
      await fs.mkdir(this.logDir, { recursive: true });

      // Clean up old logs (older than 30 days)
      await this.cleanupOldLogs();
    } catch (error) {
      console.error('[SyncLogger] Failed to initialize:', error);
      // Don't throw - allow sync to continue without logging
    }
  }

  // Delete log files older than 30 days
  async cleanupOldLogs() {
    try {
      const files = await fs.readdir(this.logDir);
      const now = Date.now();
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(this.logDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtimeMs < thirtyDaysAgo) {
          await fs.unlink(filePath);
          console.log(`[SyncLogger] Deleted old log file: ${file}`);
        }
      }
    } catch (error) {
      console.error('[SyncLogger] Failed to cleanup old logs:', error);
      // Don't throw - not critical
    }
  }

  // Get current log file path
  getCurrentLogFile() {
    const now = new Date();
    const dateStr = formatDate(now); // YYYY-MM-DD

    // Check if we need a new file (day changed)
    if (dateStr !== this.currentDate) {
      this.currentDate = dateStr;
      this.currentLogFile = path.join(this.logDir, `${dateStr}.log`);
    }

    return this.currentLogFile;
  }

  // Append log entry - fire-and-forget (non-blocking)
  log(level, context, message, metadata = {}) {
    // Fire and forget - don't await
    this._writeLog(level, context, message, metadata).catch(error => {
      // Graceful fallback to console logging if filesystem fails
      console.log(`[SYNC-LOG-FALLBACK] [${level}] [${context}] ${message}`, metadata);
    });
  }

  // Internal async write method
  async _writeLog(level, context, message, metadata) {
    // Lazy initialization - ensure logger is ready before first use
    if (!this.logDir) {
      await this.init();
    }

    const timestamp = formatTimestamp(new Date());
    const logFile = this.getCurrentLogFile();

    let logEntry = `[${timestamp}] [${level}] [${context}] ${message}`;

    // Add metadata if present (using safe serializer)
    if (Object.keys(metadata).length > 0) {
      logEntry += ` | ${safeStringify(metadata)}`;
    }

    logEntry += '\n';

    await fs.appendFile(logFile, logEntry, 'utf8');
  }

  // Convenience methods
  info(context, message, metadata = {}) {
    this.log('INFO', context, message, metadata);
  }

  success(context, message, metadata = {}) {
    this.log('SUCCESS', context, message, metadata);
  }

  skip(context, message, metadata = {}) {
    this.log('SKIP', context, message, metadata);
  }

  warn(context, message, metadata = {}) {
    this.log('WARN', context, message, metadata);
  }

  error(context, message, metadata = {}) {
    this.log('ERROR', context, message, metadata);
  }

  // Helper to sanitize file paths before logging
  sanitizePath(fullPath) {
    return sanitizePath(fullPath, this.baseDir);
  }
}

// Export singleton instance
module.exports = new SyncLogger();

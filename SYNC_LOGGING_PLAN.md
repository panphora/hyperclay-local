# Sync Logging System Plan

## 1. Architecture Overview

**Module:** `/sync-engine/logger.js` - Centralized logging module for sync operations (singleton)

**Log Location:** `app.getPath('logs')/sync/` directory
- macOS: `~/Library/Logs/Hyperclay Local/sync/`
- Windows: `%USERPROFILE%\AppData\Roaming\Hyperclay Local\logs\sync\`
- Linux: `~/.config/Hyperclay Local/logs/sync/`

**File Naming:** `YYYY-MM-DD.log` (e.g., `2025-10-21.log`)

**Log Rotation:** Automatic - new file created each day based on local date

**Log Retention:** Auto-delete logs older than 30 days on startup

---

## 2. What to Log

### Success Events:
- ✅ Sync initialization (username, folder, server URL)
- ✅ File uploaded (filename, size, checksum)
- ✅ File downloaded (filename, size, checksum)
- ✅ File skipped (filename, reason: "checksum match", "local newer", "future-dated")
- ✅ Backup created (original file, backup path)
- ✅ Initial sync complete (stats summary)
- ✅ Polling check (files checked, changes found)

### Error Events:
- ❌ API key validation failed (401/403)
- ❌ Network errors (timeout, DNS, connection refused)
- ❌ Server errors (404, 500, 502, 503, 504)
- ❌ File access errors (permissions, file locked)
- ❌ Name conflicts (file already taken by another user)
- ❌ Validation errors (invalid filename, reserved words)
- ❌ Sync queue failures (retry attempts, permanent failures)
- ❌ Clock calibration issues
- ❌ General sync engine errors

### State Changes:
- 🔄 Sync started
- 🔄 Sync stopped
- 🔄 File watcher started/stopped
- 🔄 Polling started/stopped

---

## 3. Log Format

**Standard Format:**
```
[TIMESTAMP] [LEVEL] [CONTEXT] Message | {metadata}
```

**Example Entries:**
```
[2025-10-21 14:32:15.123] [INFO] [SYNC] Sync initialized for user 'jeet' - Server: https://hyperclay.com | {"apiKeyPrefix":"hcsk_abc123..."}
[2025-10-21 14:32:16.456] [SUCCESS] [UPLOAD] Uploaded 'myapp.html' (2.3 KB) | {"checksum":"abc123...","size":2300}
[2025-10-21 14:32:17.789] [SKIP] [UPLOAD] Skipped 'dashboard.html' - server has same checksum
[2025-10-21 14:32:18.012] [ERROR] [API] Failed to upload 'test.html' - 409 Name conflict: already taken by user 'other_user'
[2025-10-21 14:32:19.345] [SUCCESS] [DOWNLOAD] Downloaded 'notes/ideas.html' (1.8 KB) | {"checksum":"def456...","size":1800}
[2025-10-21 14:32:20.678] [INFO] [DOWNLOAD] Created backup for 'ideas.html' | {"backupPath":"sites-versions/ideas/2025-10-21-14-32-20-678.html"}
[2025-10-21 14:32:21.901] [WARN] [QUEUE] Retry 1/3 for 'myapp.html' - Network timeout
[2025-10-21 14:32:25.234] [ERROR] [API] API key validation failed - 401 Unauthorized | {"apiKeyPrefix":"hcsk_abc123..."}
[2025-10-21 14:35:42.567] [INFO] [STATS] Initial sync complete - Downloaded: 5, Uploaded: 3, Skipped: 2, Protected: 1
```

**Note:** All file paths are relative to the sync folder (not absolute paths) for privacy protection.

---

## 4. Implementation Details

### Module Structure: `/sync-engine/logger.js`

```javascript
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
```

### Log Levels (5 total):
- `INFO` - General information (init, stats, state changes, backups)
- `SUCCESS` - Successful operations (upload, download)
- `SKIP` - Files skipped (with reason)
- `WARN` - Warnings (retries, non-critical issues)
- `ERROR` - Errors (API failures, network issues, validation failures)

### Contexts (10 total):
- `SYNC` - Initialization, start, stop
- `UPLOAD` - File upload operations
- `DOWNLOAD` - File download operations
- `API` - API/network/auth errors
- `VALIDATION` - File validation
- `WATCHER` - File watcher events
- `POLL` - Polling operations
- `QUEUE` - Queue processing
- `STATS` - Statistics summaries

---

## 5. Integration Points

### Files to Modify:

1. **`/sync-engine/index.js`** - Main sync engine
   - Add `this.logger = null` property to constructor
   - Add `setLogger(logger)` method to accept logger instance
   - Add logging in:
     - `init()` - Log sync start with settings
     - `performInitialSync()` - Log each file operation
     - `downloadFile()` - Log download success/failure
     - `uploadFile()` - Log upload success/failure/skip
     - `processQueue()` - Log queue processing, retries
     - `checkForRemoteChanges()` - Log polling results
     - `stop()` - Log sync stop

   **Example setLogger implementation:**
   ```javascript
   class SyncEngine extends EventEmitter {
     constructor() {
       super();
       this.logger = null;
       // ... existing properties
     }

     setLogger(logger) {
       this.logger = logger;
     }

     // Use throughout the code:
     async init(apiKey, username, syncFolder, serverUrl) {
       if (this.logger) {
         this.logger.info('SYNC', `Sync initialized for user '${username}' - Server: ${serverUrl}`, {
           apiKeyPrefix: apiKey.substring(0, 12) + '...'
         });
       }
       // ... rest of init
     }
   }
   ```

2. **`/sync-engine/api-client.js`** - API calls
   - Log all HTTP responses (status codes, errors)
   - Log network timeouts/failures
   - Log authentication failures

3. **`/sync-engine/error-handler.js`** - Error classification
   - Log all classified errors with context
   - Include error priority and type

4. **`/sync-engine/sync-queue.js`** - Queue management
   - Log retry attempts
   - Log permanent failures

5. **`/backup.js`** - Backup operations
   - Log backup creation with paths

6. **`/main.js`** - Main process
   - Initialize logger when sync starts
   - Pass logger instance to sync engine via `setLogger()`

   **Example initialization:**
   ```javascript
   const syncLogger = require('./sync-engine/logger');
   const syncEngine = require('./sync-engine');

   // When starting sync:
   async function handleSyncStart(apiKey, username, syncFolder, serverUrl) {
     try {
       syncEngine.removeAllListeners();
       setupSyncEventHandlers();

       // Initialize logger once with baseDir for path sanitization
       await syncLogger.init(syncFolder);
       syncEngine.setLogger(syncLogger);

       const result = await syncEngine.init(apiKey, username, syncFolder, serverUrl);
       // ... rest of handler
     }
   }
   ```

---

## 6. UI Updates

### Update "logs" link behavior:

**Current:** Opens `app.getPath('logs')` → `~/Library/Logs/Hyperclay Local/`

**New:** Open `app.getPath('logs')/sync/` → `~/Library/Logs/Hyperclay Local/sync/`

**Update in `main.js`:**
```javascript
ipcMain.handle('open-logs', () => {
  const logsPath = app.getPath('logs');
  const syncLogsPath = path.join(logsPath, 'sync');
  shell.openPath(syncLogsPath);
});
```

---

## 7. Error Handling

- If log directory creation fails, continue without logging (don't crash sync)
- Fire-and-forget logging - don't block sync operations
- Fallback to console logging if file writes fail
- Wrap all log writes in try/catch

---

## 8. Performance Considerations

- **Fire-and-forget logging** - Don't await log writes, let them happen in background
- Use async file operations (non-blocking)
- Sync operations already wait for network I/O, so logging overhead is negligible

---

## 9. Privacy Considerations

### Don't log:
- ❌ Full API keys (only log first 12 chars: `hcsk_abc123...`)
- ❌ File contents
- ❌ Full file paths (use relative paths from sync folder)

### Do log:
- ✅ Usernames
- ✅ Filenames
- ✅ Checksums
- ✅ File sizes
- ✅ Error messages (including stack traces)
- ✅ Server URLs

---

## 10. Testing Plan

1. Enable sync - verify `SYNC` log entry
2. Upload file - verify `SUCCESS` entry with filename/size
3. Download file - verify `SUCCESS` and `INFO` (backup) entries
4. Skip file (checksum match) - verify `SKIP` entry with reason
5. Trigger network error - verify `ERROR` entry with stack trace
6. Trigger validation error - verify `ERROR` entry
7. Complete initial sync - verify `STATS` entry
8. Quit and restart next day - verify new log file created
9. Click "logs" link - verify correct folder opens
10. Wait 31 days - verify old logs auto-deleted

---

## 11. Future Enhancements (not in initial implementation)

- Max file size limits with rotation
- Export logs feature in UI
- Search/filter logs in UI

---

## Summary

This plan creates a **self-contained, robust logging system** that:
- Writes daily log files to platform-specific locations
- Logs all sync operations, errors, and state changes
- Uses clear, parsable format with timestamps and contexts
- Integrates seamlessly with existing sync engine code
- Opens correct log directory when user clicks "logs" link
- Respects privacy (no API keys or file contents)
- Fails gracefully if logging fails (fire-and-forget)
- Auto-cleans logs older than 30 days
- Includes stack traces for debugging
- Singleton pattern (matches sync engine)
- Keeps existing console.log() calls for development

The implementation will be contained primarily in a new `/sync-engine/logger.js` module with minimal changes to existing files.

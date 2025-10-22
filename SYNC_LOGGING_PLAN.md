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

### Step-by-Step Implementation Guide:

---

### **STEP 1: Create the logger module**

Create file: `/sync-engine/logger.js`

Copy the complete module code from Section 4 above. This is the singleton logger instance.

---

### **STEP 2: Modify `/sync-engine/index.js`**

#### 2a. Add logger property to constructor

Find the constructor (around line 35):
```javascript
class SyncEngine extends EventEmitter {
  constructor() {
    super();
    this.apiKey = null;
    // ... other properties
```

**Add this line:**
```javascript
this.logger = null;
```

#### 2b. Add setLogger method

Add this method after the constructor:
```javascript
/**
 * Set the logger instance
 */
setLogger(logger) {
  this.logger = logger;
}
```

#### 2c. Add logging to init() method

Find the `init()` method (around line 63). After this line:
```javascript
this.serverUrl = getServerBaseUrl(serverUrl);
console.log(`[SYNC] Server: ${this.serverUrl}`);
```

**Add:**
```javascript
// Log sync initialization
if (this.logger) {
  this.logger.info('SYNC', `Sync initialized for user '${username}'`, {
    serverUrl: this.serverUrl,
    apiKeyPrefix: apiKey.substring(0, 12) + '...',
    syncFolder: this.logger.sanitizePath(syncFolder)
  });
}
```

At the end of `init()`, before `return { success: true, stats: this.stats };`, **add:**
```javascript
// Log successful initialization
if (this.logger) {
  this.logger.info('SYNC', 'Sync engine started successfully');
}
```

#### 2d. Add logging to performInitialSync() method

Find `performInitialSync()` (around line 176). After the stats summary console.log:
```javascript
console.log(`[SYNC] Stats: ${JSON.stringify(this.stats)}`);
```

**Add:**
```javascript
// Log initial sync completion
if (this.logger) {
  this.logger.info('STATS', 'Initial sync complete', {
    filesDownloaded: this.stats.filesDownloaded,
    filesUploaded: this.stats.filesUploaded,
    filesSkipped: this.stats.filesDownloadedSkipped,
    filesProtected: this.stats.filesProtected
  });
}
```

Inside the loop where files are downloaded (around line 197), after `this.stats.filesDownloaded++;`, **add:**
```javascript
if (this.logger) {
  this.logger.success('DOWNLOAD', `Downloaded '${this.logger.sanitizePath(relativePath)}'`);
}
```

Inside the loop where files are uploaded (around line 259), after `this.stats.filesUploaded++;`, **add:**
```javascript
if (this.logger) {
  this.logger.success('UPLOAD', `Uploaded '${this.logger.sanitizePath(relativePath)}'`);
}
```

When files are skipped for checksum match (around line 228), after the console.log, **add:**
```javascript
if (this.logger) {
  this.logger.skip('DOWNLOAD', `Skipped '${this.logger.sanitizePath(relativePath)}' - checksums match`);
}
```

When files are protected (around line 218), after the console.log, **add:**
```javascript
if (this.logger) {
  this.logger.info('DOWNLOAD', `Protected '${this.logger.sanitizePath(relativePath)}' - local is newer`);
}
```

#### 2e. Add logging to downloadFile() method

Find `downloadFile()` (around line 305). After the success console.log (around line 326):
```javascript
console.log(`[SYNC] Downloaded ${localFilename}`);
```

**Add:**
```javascript
if (this.logger) {
  const stats = await fs.promises.stat(localPath);
  this.logger.success('DOWNLOAD', `Downloaded '${this.logger.sanitizePath(localFilename)}'`, {
    size: stats.size,
    modifiedAt
  });
}
```

In the catch block (around line 334), after the console.error, **add:**
```javascript
if (this.logger) {
  this.logger.error('DOWNLOAD', `Failed to download '${filename}'`, error);
}
```

#### 2f. Add logging to uploadFile() method

Find `uploadFile()` (around line 349). When validation fails (around line 360), after the emit, **add:**
```javascript
if (this.logger) {
  this.logger.error('VALIDATION', `Validation failed for '${this.logger.sanitizePath(filename)}'`, {
    reason: validationResult.error
  });
}
```

When upload is skipped for checksum match (around line 390), after the console.log, **add:**
```javascript
if (this.logger) {
  this.logger.skip('UPLOAD', `Skipped '${this.logger.sanitizePath(filename)}' - server has same checksum`);
}
```

After successful upload (around line 410), after `console.log(\`[SYNC] Uploaded ${filename}\`);`, **add:**
```javascript
if (this.logger) {
  const stats = await getFileStats(localPath);
  this.logger.success('UPLOAD', `Uploaded '${this.logger.sanitizePath(filename)}'`, {
    size: stats.size
  });
}
```

In the catch block (around line 421), after the console.error, **add:**
```javascript
if (this.logger) {
  this.logger.error('UPLOAD', `Failed to upload '${this.logger.sanitizePath(filename)}'`, error);
}
```

#### 2g. Add logging to processQueue() method

Find `processQueue()` (around line 491). In the retry block (around line 540), after the emit for retry, **add:**
```javascript
if (this.logger) {
  this.logger.warn('QUEUE', `Retry ${retryResult.attempt}/${retryResult.maxAttempts} for '${this.logger.sanitizePath(item.filename)}'`, {
    error: error.message,
    nextRetryIn: retryResult.nextRetryIn
  });
}
```

In the permanent failure block (around line 530), after the emit, **add:**
```javascript
if (this.logger) {
  this.logger.error('QUEUE', `Permanent failure for '${this.logger.sanitizePath(item.filename)}' after ${retryResult.attempts} attempts`, error);
}
```

#### 2h. Add logging to startFileWatcher() method

Find `startFileWatcher()` (around line 563). After the final console.log (around line 601), **add:**
```javascript
if (this.logger) {
  this.logger.info('WATCHER', 'File watcher started');
}
```

#### 2i. Add logging to startPolling() method

Find `startPolling()` (around line 607). After the console.log (around line 612), **add:**
```javascript
if (this.logger) {
  this.logger.info('POLL', 'Polling started', {
    intervalMs: SYNC_CONFIG.POLL_INTERVAL
  });
}
```

#### 2j. Add logging to checkForRemoteChanges() method

Find `checkForRemoteChanges()` (around line 618). In the catch block (around line 663), after the console.error, **add:**
```javascript
if (this.logger) {
  this.logger.error('POLL', 'Failed to check for remote changes', error);
}
```

#### 2k. Add logging to stop() method

Find `stop()` (around line 672). After the console.log (around line 696), **add:**
```javascript
if (this.logger) {
  this.logger.info('SYNC', 'Sync stopped');
}
```

---

### **STEP 3: Modify `/backup.js`**

#### 3a. Accept logger parameter

Find the `createBackupIfExists()` function signature (around line 10):
```javascript
async function createBackupIfExists(filePath, siteName, baseDir, emitCallback) {
```

**Change to:**
```javascript
async function createBackupIfExists(filePath, siteName, baseDir, emitCallback, logger = null) {
```

#### 3b. Add logging after backup creation

Find where the backup is created successfully (after `await fs.copyFile(...)`). After the emit callback (around line 40), **add:**
```javascript
if (logger) {
  logger.info('DOWNLOAD', `Created backup for '${siteName}.html'`, {
    backupPath: logger.sanitizePath(backupFileName)
  });
}
```

#### 3c. Update the call in sync-engine/index.js

Find the call to `createBackupIfExists` in `downloadFile()` (around line 321):
```javascript
await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this));
```

**Change to:**
```javascript
await createBackupIfExists(localPath, siteName, this.syncFolder, this.emit.bind(this), this.logger);
```

---

### **STEP 4: Modify `/main.js`**

#### 4a. Import the logger

At the top of the file (around line 5), **add:**
```javascript
const syncLogger = require('./sync-engine/logger');
```

#### 4b. Initialize logger when sync starts

Find the `handleSyncStart()` function (around line 564). After `setupSyncEventHandlers();`, **add:**
```javascript
// Initialize logger with sync folder for path sanitization
await syncLogger.init(syncFolder);
syncEngine.setLogger(syncLogger);
```

#### 4c. Update open-logs handler

Find the `open-logs` IPC handler (around line 635). **Replace it with:**
```javascript
ipcMain.handle('open-logs', () => {
  const logsPath = app.getPath('logs');
  const syncLogsPath = path.join(logsPath, 'sync');
  shell.openPath(syncLogsPath);
});
```

---

### **STEP 5: Test the implementation**

1. Run the app in dev mode: `npm run dev`
2. Enable sync with your API key
3. Check that logs are being created in:
   - macOS: `~/Library/Logs/Hyperclay Local/sync/`
   - Windows: `%USERPROFILE%\AppData\Roaming\Hyperclay Local\logs\sync\`
   - Linux: `~/.config/Hyperclay Local/logs/sync/`
4. Verify log format matches examples in Section 3
5. Click "logs" link in UI - should open the sync logs folder
6. Upload a file - check for SUCCESS log entry
7. Download a file - check for SUCCESS and INFO (backup) entries
8. Trigger an error - check for ERROR entry with stack trace
9. Wait 31 days and restart - verify old logs are deleted

---

### **Common Issues & Solutions:**

**Issue:** Logger is undefined
- **Solution:** Make sure you imported it: `const syncLogger = require('./sync-engine/logger');`

**Issue:** Logs folder not opening
- **Solution:** Check that the path.join is correct and shell is imported from electron

**Issue:** No logs being written
- **Solution:** Check that logger.init() was called before any logging happens

**Issue:** Paths showing absolute instead of relative
- **Solution:** Always use `this.logger.sanitizePath(path)` when logging file paths

**Issue:** Stack traces not showing
- **Solution:** Make sure you're passing the Error object directly to metadata, not error.message

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

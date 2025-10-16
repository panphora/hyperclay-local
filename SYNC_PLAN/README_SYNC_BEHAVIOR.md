# Hyperclay Sync Behavior Documentation

**Version 3.0** - With Time-Based Protection

## Overview

This document outlines the intentional design decisions for how Hyperclay Local synchronizes files with the Hyperclay platform. The sync system uses intelligent time-based protection to ensure newer local files are never overwritten, while maintaining the server as the authoritative source for published content.

---

## Initial Sync Behavior: Smart Preserve-Newer Approach

### What Happens

When you first connect Hyperclay Local to your Hyperclay account and enable sync:

1. **Clock calibration** - System calculates time difference between your computer and server
2. **Smart comparison** - For each file, compares timestamps (with offset adjustment)
3. **Newer files protected** - Local files that are newer are NEVER overwritten
4. **Older files updated** - Only files older than server version are downloaded
5. **Local-only files** - Files that exist only locally are NOT immediately uploaded (will upload on next edit)

### Why This Design

**Smart Protection**: Preserves your recent local work while still getting updates from the server.

**Clock Skew Handling**: Automatically adjusts for incorrect computer clocks, ensuring accurate comparisons.

**Common Use Cases Protected**:
- Working offline then reconnecting - your work is safe
- Computer clock is wrong - sync still works correctly
- Just edited files locally - they won't be overwritten
- Setting up after local development - recent files preserved

### Example Scenario with Time Protection

```
Before Initial Sync (with timestamps):
┌──────────────────────────┐        ┌──────────────────────────┐
│      Local Folder        │        │    Hyperclay Server      │
├──────────────────────────┤        ├──────────────────────────┤
│ • draft.html (2 min ago) │        │ • site1.html (1 day old) │
│ • test.html (1 hour ago) │        │ • site2.html (1 day old) │
│ • site1.html (5 min ago) │        │ • logo.png (1 week old)  │
└──────────────────────────┘        └──────────────────────────┘

After Initial Sync:
┌──────────────────────────┐        ┌──────────────────────────┐
│      Local Folder        │        │    Hyperclay Server      │
├──────────────────────────┤        ├──────────────────────────┤
│ • draft.html (2 min ago) │        │ • site1.html (1 day old) │
│ • test.html (1 hour ago) │        │ • site2.html (1 day old) │
│ • site1.html (5 min ago) │        │ • logo.png (1 week old)  │
│ • site2.html (NEW) ✓     │        │                          │
│ • logo.png (NEW) ✓       │        │                          │
└──────────────────────────┘        └──────────────────────────┘

Results:
• site1.html - PRESERVED (local is newer: 5 min vs 1 day)
• site2.html - DOWNLOADED (doesn't exist locally)
• logo.png - DOWNLOADED (doesn't exist locally)
• draft.html & test.html - remain local-only until edited
```

### For Developers

The time-based protection is implemented in `sync-engine.js`:

```javascript
async performInitialSync() {
  // 1. Calibrate clock offset
  await this.calibrateClock();

  // 2. For each server file:
  if (this.isLocalNewer(localMtime, serverTime)) {
    // PRESERVE local file
  } else {
    // DOWNLOAD from server
  }
}
```

### For Users

**Important**: When first enabling sync:
- System automatically protects your newer local files
- Only older files are updated from the server
- Local-only files won't upload until you edit them
- Check the sync summary (ⓘ icon) to see what was preserved

---

## Local Delete Behavior: Non-Destructive Approach

### What Happens

When you delete a file locally while sync is enabled:

1. **The deletion is NOT synced to the server**
2. The file remains in your Hyperclay account
3. The file will NOT re-download unless it changes on the server
4. This prevents accidental data loss

### Why This Design

**Safety First**: Accidental local deletions won't destroy your online work.

**Use Cases Protected**:
- Accidentally deleting files in file explorer
- Cleaning up local workspace without affecting published sites
- Multiple devices with different local file needs

### Example Scenario

```
Before Local Delete:
┌──────────────────┐        ┌──────────────────┐
│   Local Folder   │        │  Hyperclay Server│
├──────────────────┤        ├──────────────────┤
│ • site1.html     │ ←────→ │ • site1.html     │
│ • site2.html     │ ←────→ │ • site2.html     │
│ • logo.png       │ ←────→ │ • logo.png       │
└──────────────────┘        └──────────────────┘

User deletes site2.html locally:
┌──────────────────┐        ┌──────────────────┐
│   Local Folder   │        │  Hyperclay Server│
├──────────────────┤        ├──────────────────┤
│ • site1.html     │ ←────→ │ • site1.html     │
│ ✗ site2.html     │        │ • site2.html ✓   │
│ • logo.png       │ ←────→ │ • logo.png       │
└──────────────────┘        └──────────────────┘

Result: site2.html remains safe on server
```

### For Developers

The delete behavior is implemented in `sync-engine.js`:

```javascript
startFileWatcher() {
  this.watcher
    .on('add', path => this.queueSync('add', path))
    .on('change', path => this.queueSync('change', path))
    .on('unlink', path => {
      // Intentionally ignores deletes
      console.log(`[SYNC] Local delete ignored: ${path}`);
    });
}
```

### For Users

**Important**:
- Files deleted locally remain safe in your Hyperclay account
- To delete files from both local and server:
  1. Delete the file on hyperclay.com
  2. The deletion will sync down to your local folder
- Think of local deletes as "removing from this device only"

---

## Clock Offset & Time Comparison

### How It Works

**Clock Calibration**: On each sync session start:
1. Request server time
2. Calculate offset = serverTime - localTime
3. Store in memory for the session
4. Apply to all timestamp comparisons

**Example**:
```
Your computer time: 2:00 PM (5 minutes slow)
Server time: 2:05 PM
Offset: +5 minutes

When comparing files:
Local file modified at: 1:55 PM (your time)
Adjusted time: 1:55 PM + 5 min = 2:00 PM
Server file modified at: 1:30 PM
Result: Local is newer → PRESERVE
```

### Why This Matters

- **Wrong clock?** No problem - sync still works correctly
- **Different timezones?** Handled automatically
- **Daylight savings?** Adjusted properly
- **NTP sync issues?** Compensated for

---

## The 10-Second Buffer Rule

### What It Means

Files modified within 10 seconds of each other are considered "same time":

**Behavior**:
- If |localTime - serverTime| ≤ 10 seconds → Use checksum comparison
- Prevents flip-flopping for nearly simultaneous edits
- Accounts for file system timestamp granularity

**Example**:
```
Local file: 2:00:05 PM
Server file: 2:00:08 PM
Difference: 3 seconds
Result: Within buffer → Compare checksums → Use server if different
```

### Why 10 Seconds?

- **Network delays**: Upload might take a few seconds
- **File system precision**: Some systems only update every few seconds
- **User perception**: Changes within 10 seconds feel simultaneous
- **Safety margin**: Prevents false conflicts

---

## Future File Protection

### Special Handling

Files with timestamps in the future (even after clock adjustment) are ALWAYS preserved:

**Example**:
```
Current time: Jan 15, 2024
Local file timestamp: Jan 20, 2024
Result: ALWAYS PRESERVE (intentionally future-dated)
Log: "WARNING: File dated in future - preserving"
```

### Use Cases

- **Testing**: Date-specific test files
- **Scheduling**: Content for future release
- **Templates**: Pre-dated templates
- **Intentional**: User knows what they're doing

---

## Daily Log System

### Structure

Logs are automatically organized by date:

```
hyperclay-local/
└── logs/
    ├── sync-2024-01-15.log
    ├── sync-2024-01-16.log
    └── sync-2024-01-17.log (today)
```

### What's Logged

Each session starts with:
```
=== Sync Session Started ===
Time: 2024-01-17 09:00:00
User: davidmiranda
Folder: /Users/davidmiranda/sites
Server Time: 2024-01-17 09:00:05
Local Time: 2024-01-17 09:00:00
Clock Offset: +5 seconds
Mode: preserve-newer (10s buffer)
===========================
```

Then for each file:
```
[09:00:01] INFO: PRESERVE index.html - local is newer (2 min ago)
[09:00:02] INFO: DOWNLOAD about.html - server is newer
[09:00:03] DEBUG: SKIP style.css - checksums match
[09:00:04] WARNING: future.html dated 2024-01-18 (future)
```

### Automatic Cleanup

- Logs older than 30 days are automatically deleted
- Prevents disk space issues
- Keeps relevant debugging information

---

## Sync Summary UI

### Accessing the Summary

Click the ⓘ icon next to "Sync Active" to see:

```
┌─────────────────────────────────┐
│       Sync Summary              │
├─────────────────────────────────┤
│ Files Protected:          12    │
│ Files Downloaded:         8     │
│ Files Uploaded:           3     │
│ Files Skipped:            45    │
│ Last Sync: 2 minutes ago        │
├─────────────────────────────────┤
│ Newer local files are always    │
│ protected. See logs for details.│
└─────────────────────────────────┘
```

### What the Numbers Mean

- **Files Protected**: Local files that were newer (preserved)
- **Files Downloaded**: Updates from server
- **Files Uploaded**: Your changes sent to server
- **Files Skipped**: No changes needed

---

## Additional Sync Behaviors

### Conflict Resolution

**Behavior**: When the same file is modified both locally and on the server:
1. **Time comparison first** - If local is newer (beyond 10s buffer), it's preserved
2. **Within buffer** - If timestamps within 10 seconds, server version wins
3. **Backup always created** - Before any overwrite, local version backed up to `sites-versions/`
4. **Manual merge available** - User can recover from backup if needed

### Binary Files

**Behavior**: Images, PDFs, and other binary files:
- Automatically detected by file extension
- Transferred as base64-encoded data
- Checksummed to avoid redundant transfers

### File Size Limits

**Behavior**:
- HTML files: 5MB maximum
- Assets/Binary files: 20MB maximum
- Larger files will fail to sync with an error message

### Sync Frequency

**Behavior**:
- Local changes: Synced immediately (with 500ms debounce)
- Remote changes: Polled every 10-60 seconds (adaptive)
- Network failures: Automatic retry with exponential backoff

---

## Design Philosophy

The Hyperclay sync system follows these principles:

1. **Protect recent work** - Never overwrite newer local files
2. **Smart time handling** - Automatic clock offset adjustment
3. **Conservative deletions** - Local deletes don't sync to server
4. **Transparent operations** - Daily logs and sync summary UI
5. **Fail safely** - Always backup before overwriting
6. **Performance conscious** - Efficient transfers using checksums
7. **User trust** - Assume users know what they're doing (future files)

---

## FAQ for Users

### Q: Will sync overwrite my recent local work?
**A:** No! The sync system automatically detects and preserves newer local files. Check the sync summary (ⓘ icon) to see how many files were protected.

### Q: What if my computer's clock is wrong?
**A:** No problem. The sync system automatically calibrates with the server time when it starts, so even if your clock is hours or days off, sync will work correctly.

### Q: Why didn't my local-only files upload when I first enabled sync?
**A:** Files that exist only on your computer (not on the server) won't upload until you edit them. This prevents accidentally filling your account with draft files.

### Q: I deleted a file locally but it's still on hyperclay.com. Is this a bug?
**A:** No, this is intentional. Local deletions don't sync to protect against accidental data loss. Delete files on hyperclay.com to remove them everywhere.

### Q: How can I see what sync is doing?
**A:** Two ways:
1. Click the ⓘ icon next to "Sync Active" for a summary
2. Check the `logs` folder in your sync directory for detailed daily logs

### Q: What happens if I edit the same file in two places?
**A:** If your local edit is newer (beyond 10 seconds), it's kept. If edits are within 10 seconds of each other, the server version is used. Either way, a backup is created first.

### Q: Can I sync multiple folders?
**A:** No. Each Hyperclay Local instance syncs one folder. Use multiple API keys for multiple folders.

---

## FAQ for Developers

### Q: How does the time comparison work with clock skew?
**A:** On session start, we calculate `offset = serverTime - localTime`. All local timestamps are adjusted by this offset before comparison. This handles wrong clocks, timezone differences, and NTP sync issues.

### Q: Why a 10-second buffer instead of exact timestamp comparison?
**A:** File systems have varying timestamp precision (1-2 seconds on some systems). Network delays can cause a few seconds difference. The 10-second buffer prevents false conflicts while still catching real changes.

### Q: What happens with future-dated files?
**A:** Any file with `timestamp > now + 60 seconds` (after offset adjustment) is considered intentionally future-dated and always preserved. A warning is logged but the file is never overwritten.

### Q: Why not make the preserve-newer behavior configurable?
**A:** Simplicity and safety. This is what 99% of users expect. Making it configurable adds complexity, testing burden, and support issues. The current behavior is universally safe.

### Q: How are the daily logs managed?
**A:** New log file created at midnight local time. Files older than 30 days are automatically deleted. Each log starts with session info including clock offset. All sync decisions are logged with timestamps.

### Q: Why poll instead of webhooks?
**A:** Simplicity and firewall compatibility. Webhooks require the local app to accept incoming connections, which many networks block. Polling works everywhere.

### Q: How do checksums work?
**A:** SHA-256 hash of file content, truncated to 16 characters. Used when timestamps are within the 10-second buffer or for detecting actual changes.

---

## Future Considerations

These behaviors may evolve based on user feedback:

1. **Configurable time buffer** - Allow users to adjust the 10-second window
2. **Optional delete sync** - Opt-in destructive sync for advanced users
3. **Selective sync** - Choose which files/folders to sync
4. **Conflict resolution UI** - Visual merge tool when timestamps are within buffer
5. **Version history browser** - UI to browse and restore from backups
6. **Two-way initial sync** - Optional mode to upload all local files immediately
7. **Log viewer in app** - Built-in log viewer instead of file system access
8. **Sync profiles** - Different settings for different project types

---

## Summary

The Hyperclay sync system (v3.0) provides intelligent, safe file synchronization that:

- **Protects your work** - Never overwrites newer local files
- **Handles time issues** - Works correctly even with wrong clocks
- **Provides transparency** - Daily logs and UI summary show exactly what happened
- **Respects intent** - Future-dated files and local deletions handled appropriately
- **Stays simple** - One mode that works for everyone, no configuration needed

The guiding principle: **Your recent local work is sacred and will never be lost.**

---

*Last Updated: 2025-10-15*
*Version: 3.0*
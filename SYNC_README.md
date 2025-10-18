# Hyperclay Sync System

This guide documents the current sync implementation that powers Hyperclay Local. It is aimed at developers working on the Electron app (`hyperclay-local`) and the platform API (`hyper/sync-actions`). The information below reflects the shipping code rather than the older plans in `SYNC_PLAN/`.

---

## High-Level Flow

1. The Electron main process (`main.js`) collects the user’s API key, target sync folder, and optional server override, then calls `sync-engine.init`.
2. `sync-engine/index.js` calibrates the local clock against `/sync/status`, performs an initial download-only sync, and then:
   - Watches the sync folder for `*.html` changes.
   - Polls the server every 30s for remote updates.
   - Queues uploads through a retry-aware `SyncQueue`.
3. The server exposes authenticated endpoints in `hyperclay/server-lib/sync-actions.js` that operate on the filesystem via `dx('sites', ...)` and the `Node` model.
4. The renderer process listens for sync events over IPC to update UI state (activity indicator, stats, errors).

The system is intentionally conservative:
- Only `.html` files at the root of the selected folder are synced.
- Newer local files are never overwritten.
- Local deletions do not propagate to the server.
- Move/rename detection is not implemented; renaming a file uploads it as a new site.

---

## Core Modules (Desktop)

| Area | File | Responsibility |
| ---- | ---- | -------------- |
| Engine | `sync-engine/index.js` | Orchestrates init, initial sync, watcher, polling, queue processing, stats, and IPC events. |
| Networking | `sync-engine/api-client.js` | Fetches `/sync/files`, `/sync/download/:filename`, `/sync/upload`, `/sync/status`. |
| File I/O | `sync-engine/file-operations.js` | Lists local `.html` files (non-recursive), reads/writes content, ensures directories, handles backups. |
| Validation | `sync-engine/validation.js` | Mirrors server-side rules for site names and full paths. |
| Utilities | `sync-engine/utils.js` | Clock calibration, checksum generation, timestamp formatter, “newer” decisions, future-file detection. |
| Queue | `sync-engine/sync-queue.js` | Deduplicated FIFO queue with retry backoff (3 attempts, 5s/15s/60s delays). |
| Backups | `sync-engine/backup.js` | Creates local `sites-versions/<site>/<timestamp>.html` copies before overwriting. |
| Errors | `sync-engine/error-handler.js` | Categorises errors (auth, name conflict, network, permissions, conflict) and shapes UI messages. |

Key configuration lives in `sync-engine/constants.js`:
- `POLL_INTERVAL = 30000ms`
- `TIME_BUFFER = 10000ms` (server vs local timestamps within 10s are treated as “same time”)
- `FILE_STABILIZATION` (1s stability window for chokidar)
- `MAX_RETRIES = 3`

---

## Server Components

All sync endpoints are configured in `hyperclay/hey.js` (see the “SPECIAL ROUTES” section) and implemented in `hyperclay/server-lib/sync-actions.js`.

### Authentication
- API keys are created via the state-machine route `dev:main_app:generate-sync-key`, which hashes keys using SHA-256 before storage.
- `authenticateApiKey` validates the `X-API-Key` header, checks expiry/active status (`ApiKey.findValidKey`), and loads the associated `Person`.
- Valid keys last one year, are tied to a person, and update their `lastUsedAt` timestamp on each request.

### Endpoint Contracts

| Endpoint | Method | Response / Behavior |
| -------- | ------ | ------------------- |
| `/sync/status` | GET | Returns `{ success, serverTime, username, email }` for clock calibration and UI display. |
| `/sync/files` | GET | Returns `{ success, serverTime, files }`. Each `file` includes `filename` (no `.html`), `checksum` (16 hex chars), `modifiedAt`, `size`, `lastSyncedAt`. No HTML content is transmitted here. |
| `/sync/download/:filename` | GET | Streams `{ content, modifiedAt, checksum }` for a single site. Path component is the bare site name; the server appends `.html`. |
| `/sync/upload` | POST | Accepts `{ filename, content, modifiedAt }` where `filename` is the bare site name (no extension). Creates a server-side backup via `BackupService` before overwriting and updates `lastSyncedAt`. Rejects reserved names and duplicates using `isValidName` and the `Node` model. |

All file I/O goes through the `dx` helper (e.g., `dx('sites').createFileOverwrite(...)`), so the API remains independent of the database storage.

---

## Lifecycle Details

### Initialization (`sync-engine/index.js#init`)
1. Ensures the local sync folder exists.
2. Calls `calibrateClock` to compute skew (`serverTime - localTime`).
3. Runs `performInitialSync`:
   - Fetches server metadata with `fetchServerFiles`.
   - Lists local `.html` files via `getLocalFiles`.
   - Downloads any remote file missing locally.
   - For conflicts, preserves local files that are newer (after applying clock offset) or deliberately future-dated (>60s ahead).
   - Compares SHA-256 checksums (first 16 hex chars) to avoid redundant downloads.
4. Starts the watcher and polling loop.
5. Emits `sync-start`, `sync-complete`, `file-synced`, `sync-stats`, `backup-created`, `sync-error`, `sync-retry`, `sync-failed` events for UI consumption.

### Watcher (`startFileWatcher`)
- Watches `*.html` in the sync root only.
- `add` and `change` events enqueue uploads after validation.
- `unlink` events are logged but ignored (no server delete).
- Uses chokidar’s `awaitWriteFinish` to avoid partial writes.

### Queue & Uploads
- `queueSync` validates names (`validateFileName` for root files, `validateFullPath` if slashes are present for future features) before adding to the queue.
- `processQueue` drains items, calling `uploadFile` for `add/change`. Failures go through `scheduleRetry` with exponential backoff; non-retryable errors (auth, name conflict, permissions) immediately emit `sync-failed`.
- `uploadFile`:
  - Revalidates file names.
  - Reads file content/stats with `readFile`/`getFileStats`.
  - Calls `uploadToServer`, passing the full filename (with `.html` trimmed inside the API client).
  - Updates `stats.filesUploaded`.

### Polling (`checkForRemoteChanges`)
- Skips polling if the queue is mid-processing (avoid overlapping writes).
- Refetches `/sync/files`, compares with local state, and downloads newer server versions.
- Preserves local versions if they are newer or future-dated.
- Emits updated stats when changes are detected.

### Shutdown (`stop`)
- Stops the watcher and polling interval.
- Clears the queue and leaves `stats` intact for UI display.

---

## Safety & Validation

| Mechanism | Location | Notes |
| --------- | -------- | ----- |
| Time-based protection | `isLocalNewer`, `isFutureFile` | Uses clock offset and 10s buffer to avoid overwriting recent local edits; future-dated files (>60s) are always preserved. |
| Name rules | `sync-engine/validation.js`, `server-lib/is-valid-name.js` | Enforce length, character sets, reserved words, and Windows device names. |
| Queue retries | `sync-engine/sync-queue.js` | Retryable errors: network, 5xx; permanent failures emit `sync-failed`. |
| Local backups | `sync-engine/backup.js` | Before overwriting a local file, saves a copy under `sites-versions/<site>/<timestamp>.html`. |
| Server backups | `sync-actions.uploadSyncFile` | Calls `BackupService.createBackup` when overwriting server content. |
| Local delete safety | `startFileWatcher` | Deletes are ignored; user must remove files via the web dashboard. |

---

## Persisted Settings & Security

- Settings live under the Electron `userData` directory (`settings.json`). API keys are encrypted using `electron.safeStorage` when available.
- On init, the API key is re-encrypted and stored in memory (`this.apiKeyEncrypted`) for quick restarts.
- `utils.getServerBaseUrl` defaults to production (`https://hyperclay.com`) unless `NODE_ENV=development` or `--dev` is present, in which case it uses `https://localhyperclay.com`.

---

## Testing & Debugging Tips

- Run the desktop app with `npm start -- --dev` to use the dev server base URL and enable live reload.
- Inspect sync activity in the console logs (Electron main process) or subscribe to IPC events in the renderer (`sync-update`, `file-synced`, `sync-stats`, `sync-error`, etc.).
- On the server, check the `nodes` table (`type = 'site'`) and `sites/` filesystem folder to confirm uploads.
- The local backup tree (`<syncFolder>/sites-versions/`) mirrors the server’s `BackupService` structure; use it to recover overwritten files.
- To simulate conflicts, edit the same file locally and on the server with different timestamps; verify that the newer version wins and the loser is backed up.
- Network failures can be forced by disconnecting or pointing to an invalid server URL; observe retry scheduling in logs.

---

## Current Limitations & Future Work

- **Flat namespace only**: the engine syncs files directly under the chosen folder and strips `.html`. Folder-aware sync (e.g., `folder/site.html`) will require recursive scanning, path validation updates, and server changes to the Node hierarchy.
- **HTML only**: binary assets are intentionally excluded from this client sync path.
- **Manual cleanup**: server content must be deleted via the Hyperclay dashboard; the client will not issue delete requests.
- **No rename/move detection**: renaming a local file creates a new site on upload; the original remains on the server.

When extending the system, update this document alongside code changes so new developers have an accurate reference.

---

## Reference

- Desktop entry: `hyperclay-local/main.js`
- Sync engine: `hyperclay-local/sync-engine/index.js`
- API client: `hyperclay-local/sync-engine/api-client.js`
- Validation: `hyperclay-local/sync-engine/validation.js`
- Server routes: `hyperclay/hey.js` (special routes section)
- Server handlers: `hyperclay/server-lib/sync-actions.js`
- Database models: `hyperclay/server-lib/database.js` (see `Node`, `ApiKey`)

Keep an eye on the `SYNC_PLAN/` directory for historical context, but rely on this README and the codebase for the authoritative picture of the sync system.


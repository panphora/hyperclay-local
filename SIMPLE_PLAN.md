# Hyperclay Local → Hosted Sync: Minimal Implementation Plan

## 1. Foundations
### Pseudocode

```js
// main.js (main process)
let authToken = null;

ipcMain.handle('get-auth-token', () => authToken);
ipcMain.handle('set-auth-token', (event, token) => {
  authToken = token;
  saveSettings({ ...settings, authToken });
});
ipcMain.handle('get-auth-headers', () =>
  authToken ? { Authorization: `Bearer ${authToken.token}` } : {}
);

// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
  getAuthHeaders: () => ipcRenderer.invoke('get-auth-headers'),
  // ... other methods
});

// main.js
const BASE_URL = process.env.IS_DEV ? process.env.LOCAL_BASE_URL : process.env.PROD_BASE_URL;

function logSyncEvent(message) {
  const logPath = path.join(app.getPath('userData'), 'sync.log');
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}
`);
}
```

- Add environment toggle (`LOCAL_BASE_URL`, `PROD_BASE_URL`) and wire Electron builds to choose `localhyperclay.com` for development, `hyperclay.com` for production.
- Create a lightweight logger that writes plaintext sync events to `userData/sync.log`.
- Store the authenticated JWT in the main process and expose IPC helpers (`get-auth-token`, `set-auth-token`, `get-auth-headers`) so renderer code never persists credentials directly.

## 2. Authentication & Session Toggle
### Pseudocode

```jsx
// HyperclayLocalApp.jsx
function SyncToggle() {
  const [isSyncOn, setSyncOn] = useState(false);

  const handleToggle = async () => {
    const existingToken = await window.electronAPI.getAuthToken();
    if (!existingToken) {
      await window.electronAPI.openAuthWindow();
      const token = await window.electronAPI.waitForAuthToken();
      await window.electronAPI.setAuthToken(token);
    }
    const newState = !isSyncOn;
    setSyncOn(newState);
    window.electronAPI.setSyncEnabled(newState);
  };

  return (
    <button onClick={handleToggle}>
      {isSyncOn ? 'sync: on' : 'sync: off'}
    </button>
  );
}
```

```js
// main.js
ipcMain.handle('set-sync-enabled', (event, enabled) => {
  settings.syncEnabled = enabled;
  saveSettings(settings);
  if (!enabled) stopSyncLoops();
  else startSyncLoops();
});

function handleOAuthCallback(url) {
  const token = extractToken(url);
  authToken = {
    token,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + TEN_DAYS,
    lastRefreshed: Date.now()
  };
  saveSettings({ ...settings, authToken });
}

async function checkAndRefreshToken() {
  if (!authToken) return false;

  const lastRefresh = authToken.lastRefreshed || authToken.fetchedAt;
  const daysSinceRefresh = (Date.now() - lastRefresh) / (1000 * 60 * 60 * 24);

  if (daysSinceRefresh >= 1) {
    await fetch(`${BASE_URL}/api/local-sync/refresh`, {
      headers: { Authorization: `Bearer ${authToken.token}` }
    });
    authToken = { ...authToken, lastRefreshed: Date.now() };
    saveSettings({ ...settings, authToken });
  }

  return true;
}

function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken.token}` } : {};
}
```

- Implement “Sync” toggle button in the renderer; on first enable, open browser to hosted auth URL (`/local-sync/auth`).
- Handle OAuth-style callback in Electron (custom URL scheme or local server) to capture JWT; store token in app settings; refresh token daily while active, expire after ~10 days idle.
- Expose logout button that clears token and disables sync.

## 3. Initial Sync Flow
### Pseudocode

```js
async function runInitialSync() {
  logSyncEvent('initial sync started');
  const metadata = await fetchJSON(`${BASE_URL}/api/local-sync/metadata`, authHeaders());
  for (const item of metadata.files) {
    if (!item.shouldDownload) continue;
    await backupLocalFile(item.localPath);
    const contents = await fetchBinary(`${BASE_URL}/api/local-sync/files/${item.id}`, authHeaders());
    await fs.promises.writeFile(item.localPath, contents);
  }
  logSyncEvent('initial sync complete');
}
```

- When sync turns on, call hosted “metadata” endpoint to list all apps/assets for the account; download everything once, writing HTML and assets into the selected local folder.
- For each downloaded file, run the standard local backup routine before overwriting.
- Match applications between local and remote by their unique Hyperclay app name (derived from the HTML filename). Directory structure does not matter—`HelloWorld.html` in a local root should sync with the corresponding remote app even if it lives inside nested folders on the hosted platform.

## 4. Continuous Local → Remote Sync
### Pseudocode

```js
// file-watcher.js
chokidar.watch(selectedFolder, { ignoreInitial: true })
  .on('change', path => queueUpload({ path, type: inferType(path) }));

async function processUploadQueue() {
  while (syncEnabled) {
    const job = uploadQueue.shift();
    if (!job) { await sleep(250); continue; }

    await backupLocalFile(job.path);

    if (job.type === 'html') {
      // HTML applications go through existing /save/:name endpoint (creates hosted backup automatically)
      await fetch(`${BASE_URL}/save/${job.appName}`, {
        method: 'POST',
        headers: authHeaders(),
        body: await fs.promises.readFile(job.path, 'utf8')
      });
    } else {
      // Non-HTML files treated as uploads/assets
      await uploadAsset(job);
    }

    logSyncEvent(`uploaded ${job.path}`);
  }
}
```

- Watch local folder (HTML + assets). On save, immediately:
  - Run local backup (existing logic).
  - POST raw content to hosted save endpoint; treat HTML as app updates, other files as uploads.
  - Skip deletions and treat renames as “new file” uploads.
  - Ensure the hosted service creates its own backup of the current file before overwriting with the uploaded content (local backup already ran when the user saved).
  - Route non-HTML uploads through a dedicated `/api/local-sync/upload` API so the server can mirror them into the correct `uploads/{username}/` structure.
  - Block `.html` files from the uploads pipeline entirely to avoid assets being misclassified as apps.

## 5. Continuous Remote → Local Sync
### Pseudocode

```js
let lastPollCursor = null;
let pollIntervalMs = 0; // trigger immediate poll when sync enables
let pollTimer = null;

async function pollRemoteChanges() {
  if (!syncEnabled || !networkOnline()) return;

  const resp = await fetchJSON(`${BASE_URL}/api/local-sync/changes?cursor=${lastPollCursor || ''}`, authHeaders());

  if (resp.changes.length > 0) {
    pollIntervalMs = 10000; // reset to 10s when remote is active
  } else {
    pollIntervalMs = Math.min((pollIntervalMs || 10000) + 5000, 60000); // back off by +5s up to 60s
  }

  for (const change of resp.changes) {
    await backupLocalFile(change.localPath);
    const contents = await fetchBinary(`${BASE_URL}/api/local-sync/files/${change.id}`, authHeaders());
    await fs.promises.writeFile(change.localPath, contents);
    logSyncEvent(`downloaded ${change.localPath}`);
  }

  lastPollCursor = resp.nextCursor;
  scheduleNextPoll();
}

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollRemoteChanges, pollIntervalMs || 10000);
}

function startPolling() {
  pollIntervalMs = 0;
  scheduleNextPoll();
}
```

```js
async function reconcileAfterReconnect() {
  const metadata = await fetchJSON(`${BASE_URL}/api/local-sync/metadata`, authHeaders());
  // reuse runInitialSync logic but skip unchanged files based on checksum
}
```

- Every 10 seconds (while online), poll hosted metadata endpoint for updates since the last poll.
  - When sync is enabled, poll immediately.
  - If remote changes are found, keep the interval at 10 seconds; otherwise, increase by 5 seconds per idle poll up to 60 seconds.
- For each changed remote file:
  - Backup current local version.
  - Download new content and write to disk.
- On reconnect after offline, run a metadata reconciliation pass (same as initial download) before resuming polling.

## 6. Conflict Policy & Safety Nets
### Pseudocode

```js
async function uploadAsset(job) {
  const path = require('path');
  const stat = await fs.promises.stat(job.path).catch(() => null);
  if (!stat) {
    logSyncEvent(`skip delete ${job.path}`);
    return; // never propagate deletions
  }

  if (stat.size > 20 * 1024 * 1024) {
    logSyncEvent(`skip ${job.path}: exceeds 20MB`);
    showErrorBanner(`${job.filename} exceeds 20MB limit`);
    return;
  }

  if (path.extname(job.path).toLowerCase() === '.html') {
    logSyncEvent(`skip ${job.path}: HTML files must be treated as apps`);
    showErrorBanner(`${job.filename} is HTML. Move it into the apps directory to sync.`);
    return;
  }

  const body = new FormData();
  body.append('appName', job.appName);
  body.append('file', fs.createReadStream(job.path));
  body.append('relativePath', job.relativePath); // preserve folder structure
  await fetch(`${BASE_URL}/api/local-sync/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body
  });
}

// Hosted side (hyperclay state-actions)
export async function localSyncSave(req, res) {
  const node = await findNodeByName(req.body.appName, req.authPersonId);
  const html = req.body.contents;

  await BackupService.createBackup(node.id, html, req.authPersonId);
  await dx('sites').createFileOverwrite(`${node.name}.html`, html);
  res.json({ ok: true });
}

export async function localSyncUpload(req, res) {
  const { appName } = req.body;
  const file = req.file; // handled by multer/FormData
  const node = await findNodeByName(appName, req.authPersonId);

  const targetPath = path.join(process.env.USER_CONTENT_PATH || '.', 'uploads', node.ownerUsername, req.body.relativePath);
  await dx('uploads', node.ownerUsername).ensureDir(path.dirname(req.body.relativePath));
  await dx('uploads', node.ownerUsername).createFileOverwrite(req.body.relativePath, file.buffer);

  res.json({ ok: true });
}

export async function processUpload(req, res, next) {
  const file = req.file;
  if (path.extname(file.originalFilename).toLowerCase() === '.html') {
    return sendError(req, res, 400, 'Upload HTML via the site editor, not the uploads tool.');
  }

  // existing upload pipeline continues here
  next();
}
```

- Enforce last-write-wins; rely on dual backup systems (local `sites-versions/`, hosted diff backups) for recovery.
- Never delete hosted files automatically; surface errors if remote quotas (e.g., max sites) block uploads.

## 7. UX Polish
### Pseudocode

```jsx
// HyperclayLocalApp.jsx (snippet)
return (
  <div>
    <SyncToggle />
    <button onClick={handleLogout}>logout</button>
    {error && <InlineBanner type="error">{error}</InlineBanner>}
  </div>
);
```

```js
function handleUploadError(err) {
  logSyncEvent(`upload failed: ${err.message}`);
  showErrorBanner('Upload failed. Retrying…');
}
```

- Keep UI minimal: sync toggle, status indicator (“sync: on/off”), logout button, inline error banner for quota/auth issues.
- No per-site statuses or frequent notifications; only show blocking errors and retry message when uploads fail repeatedly.

## 8. Error Handling & Retry
### Pseudocode

```js
async function safeFetch(requestFn) {
  let attempt = 0;
  const delays = [1000, 2000, 3000, 5000];

  while (attempt < delays.length) {
    try {
      return await requestFn();
    } catch (error) {
      logSyncEvent(`request failed attempt ${attempt + 1}: ${error.message}`);
      await sleep(delays[attempt]);
      attempt++;
    }
  }

  throw new Error('sync request failed after retries');
}

window.addEventListener('online', () => {
  logSyncEvent('network online');
  reconcileAfterReconnect();
});

window.addEventListener('offline', () => {
  logSyncEvent('network offline');
});
```

- Implement exponential backoff for failed uploads (1 s, 2 s, 3 s, stop after 5 s). Resume on connectivity restore.
- Monitor network state; pause sync while offline, then resume with metadata reconciliation.

## 9. Release Guardrails
### Pseudocode

```js
async function verifySubscription(token) {
  const resp = await fetchJSON(`${BASE_URL}/api/local-sync/verify`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.isPaid) throw new Error('Sync is available to paid plans only.');
  if (!resp.clientUpToDate) throw new Error('Please update Hyperclay Local to use sync.');
}

async function openAuthWindow() {
  const authUrl = `${BASE_URL}/local-sync/auth?clientVersion=${APP_VERSION}`;
  shell.openExternal(authUrl);
}
```

```js
// Hosted side verification route
export async function verifyLocalSync(req, res) {
  const person = await Person.findByPk(req.authPersonId);
  res.json({
    isPaid: person.hasActiveSubscription,
    clientUpToDate: compareVersions(req.query.clientVersion, MIN_SUPPORTED_VERSION) >= 0
  });
}
```

- Gate feature behind paid subscription check during auth.
- Support only current desktop version; if build is outdated, disable sync toggle.

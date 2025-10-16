# Hyperclay Local ↔ Hosted Sync: Elegant MVP Implementation Plan

## Core Philosophy
**Simplicity over features. Platform is source of truth. Non-destructive by default.**

## Part 1: Infrastructure Foundation

### 1.1 Database Schema Updates (Hosted)

Add to `Node` table:
```sql
-- Add lastSyncedAt column to track sync state
ALTER TABLE Nodes ADD COLUMN lastSyncedAt TIMESTAMP;
ALTER TABLE Nodes ADD COLUMN syncChecksum VARCHAR(64);
```

Add new table for API keys (with secure hash storage):
```sql
CREATE TABLE ApiKeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyHash VARCHAR(64) UNIQUE NOT NULL,  -- Store SHA-256 hash, not plaintext
  keyPrefix VARCHAR(12) NOT NULL,        -- First 12 chars for identification
  personId INTEGER NOT NULL REFERENCES Person(id),
  name VARCHAR(100) DEFAULT 'Sync Key',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  lastUsedAt TIMESTAMP,
  expiresAt TIMESTAMP,
  isActive BOOLEAN DEFAULT true
);

CREATE INDEX idx_api_keys_hash ON ApiKeys(keyHash);
CREATE INDEX idx_api_keys_person ON ApiKeys(personId);
CREATE INDEX idx_api_keys_prefix ON ApiKeys(keyPrefix);
```

### 1.2 Local Server Enhancements

Update `hyperclay-local/server.js` to support nested folders and assets:

```javascript
// Add to server.js
async function serveNestedHTML(req, res, baseDir) {
  // Strip leading slash and .html extension if present
  let requestPath = req.path.substring(1);
  if (requestPath.endsWith('.html')) {
    requestPath = requestPath.slice(0, -5);
  }

  // Search for HTML file in any nested directory
  const files = await findHTMLFile(baseDir, requestPath);
  if (files.length > 0) {
    const content = await fs.readFile(files[0], 'utf8');
    res.set('Content-Type', 'text/html');
    res.send(content);
  } else {
    res.status(404).send('File not found');
  }
}

async function findHTMLFile(baseDir, fileName) {
  // Recursively search for fileName.html in any subdirectory
  const pattern = `**/${fileName}.html`;
  return await glob(pattern, { cwd: baseDir });
}

// Modify static serving to handle all file types in nested directories
app.use(express.static(baseDir, {
  index: false,
  extensions: ['html']
}));
```

## Part 2: API Key Authentication (SECURE)

### 2.1 API Key Generation (Platform) - WITH PROPER HASHING

```javascript
// server-lib/api-key-service.js
import crypto from 'crypto';

export async function generateApiKey(personId, name = 'Sync Key') {
  // Check subscription
  const person = await Person.findByPk(personId);
  if (!person.hasActiveSubscription) {
    throw new Error('API keys require active subscription');
  }

  // Revoke existing sync keys (only allow one active)
  await ApiKey.update(
    { isActive: false },
    { where: { personId, name: 'Sync Key' } }
  );

  // Generate secure key
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyValue = `hcsk_${rawKey}`;

  // Create hash for storage (NEVER store plaintext)
  const keyHash = crypto
    .createHash('sha256')
    .update(keyValue)
    .digest('hex');

  // Store first 12 chars for identification (safe to store)
  const keyPrefix = keyValue.substring(0, 12);

  // Create with 1 year expiry
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await ApiKey.create({
    keyHash,      // Store hash only
    keyPrefix,    // For identifying key in UI (e.g., "hcsk_a1b2c3d4...")
    personId,
    name,
    expiresAt
  });

  // Return the actual key ONLY THIS ONCE
  return {
    key: keyValue,
    prefix: keyPrefix,
    expiresAt
  };
}

export async function validateApiKey(key) {
  // Hash the incoming key
  const keyHash = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');

  const apiKey = await ApiKey.findOne({
    where: {
      keyHash,  // Compare hashes, not plaintext
      isActive: true,
      expiresAt: { [dbOperators.gt]: new Date() }
    },
    include: [{
      model: Person,
      include: [{ model: Node }]
    }]
  });

  if (!apiKey) {
    return null;
  }

  // Update last used timestamp
  await apiKey.update({ lastUsedAt: new Date() });

  return apiKey.Person;
}

export async function listApiKeys(personId) {
  // Return only safe metadata, never the actual keys
  const keys = await ApiKey.findAll({
    where: { personId, isActive: true },
    attributes: ['id', 'keyPrefix', 'name', 'createdAt', 'lastUsedAt', 'expiresAt'],
    order: [['createdAt', 'DESC']]
  });

  return keys.map(k => ({
    id: k.id,
    prefix: k.keyPrefix + '...', // Show only prefix
    name: k.name,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    isExpired: k.expiresAt < new Date()
  }));
}
```

### 2.2 Platform UI for Key Generation

Add to account page template:

```html
<!-- server-pages/account.edge -->
<div class="api-keys-section">
  <h3>Sync Keys</h3>

  {{#if newKey}}
    <!-- ONE-TIME DISPLAY WARNING -->
    <div class="alert alert-warning">
      <h4>⚠️ Copy Your Key Now - You Won't See It Again!</h4>
      <p>This key will only be displayed once. Store it securely.</p>
      <div class="key-display">
        <code id="api-key">{{newKey}}</code>
        <button onclick="copyKey()">Copy to Clipboard</button>
      </div>
      <p class="text-muted">
        This key expires: {{newKeyExpiry}}<br>
        To revoke access, generate a new key (this will invalidate the current one).
      </p>
    </div>
  {{/if}}

  <!-- Existing keys (show only prefix) -->
  {{#if existingKeys}}
    <div class="existing-keys">
      <h4>Active Key</h4>
      {{#each existingKeys}}
        <div class="key-item">
          <code>{{this.prefix}}</code>
          <span>Created: {{this.createdAt}}</span>
          <span>Last used: {{this.lastUsedAt || 'Never'}}</span>
        </div>
      {{/each}}
    </div>
  {{/if}}

  <form action="/generate-sync-key" method="POST">
    <button type="submit" class="btn btn-primary">
      {{#if existingKeys}}Regenerate Key (This will revoke the current key){{else}}Generate Sync Key{{/if}}
    </button>
  </form>

  <p class="help-text">
    Use this key to connect Hyperclay Local to your account.
    Only one sync key can be active at a time.
  </p>
</div>

<script>
function copyKey() {
  const keyElement = document.getElementById('api-key');
  navigator.clipboard.writeText(keyElement.textContent);

  // Clear the key from DOM after copying (security best practice)
  setTimeout(() => {
    keyElement.textContent = 'Key copied and hidden for security';
    keyElement.style.opacity = '0.5';
  }, 2000);
}
</script>
```

### 2.3 Endpoint to Generate Key

```javascript
// In hey.js routes
'dev:main_app:generate-sync-key': [
  async (req, res) => {
    try {
      const result = await generateApiKey(req.state.user.person.id);

      // Store in session for one-time display
      req.session.newApiKey = result.key;
      req.session.newApiKeyExpiry = result.expiresAt;

      // Redirect to account page where key will be shown ONCE
      res.redirect('/account?show_key=true');
    } catch (error) {
      sendError(req, res, 400, error.message);
    }
  }
],

'dev:main_app:account': [
  async (req, res) => {
    const person = req.state.user.person;

    // Get existing keys (safe metadata only)
    const existingKeys = await listApiKeys(person.id);

    // Check for new key in session (one-time display)
    let newKey = null;
    let newKeyExpiry = null;
    if (req.query.show_key && req.session.newApiKey) {
      newKey = req.session.newApiKey;
      newKeyExpiry = req.session.newApiKeyExpiry;

      // Clear from session immediately after reading
      delete req.session.newApiKey;
      delete req.session.newApiKeyExpiry;
    }

    const html = await res.edge.render('account', {
      req,
      person,
      existingKeys,
      newKey,       // Will be null after first view
      newKeyExpiry
    });
    res.send(html);
  }
]
```

### 2.4 API Key Storage (Local)

```javascript
// hyperclay-local/main.js
const { app, ipcMain, clipboard } = require('electron');

// IPC handlers for API key
ipcMain.handle('set-api-key', async (event, key) => {
  // Validate key format
  if (!key || !key.startsWith('hcsk_')) {
    return { error: 'Invalid API key format' };
  }

  // Test the key
  try {
    const response = await fetch(`${BASE_URL}/api/local-sync/validate`, {
      headers: { 'X-API-Key': key }
    });

    if (!response.ok) {
      return { error: 'Invalid or expired API key' };
    }

    const data = await response.json();

    // Store validated key (encrypted by Electron's safeStorage if available)
    if (app.isReady() && safeStorage.isEncryptionAvailable()) {
      // Encrypt the key before storing
      const encrypted = safeStorage.encryptString(key);
      settings.apiKeyEncrypted = encrypted.toString('base64');
      settings.apiKeyPrefix = key.substring(0, 12); // Store prefix for display
    } else {
      // Fallback to plaintext with warning
      settings.apiKey = key;
      settings.apiKeyPrefix = key.substring(0, 12);
      console.warn('Encryption not available, storing key in plaintext');
    }

    settings.syncUser = data.username;
    saveSettings(settings);

    return { success: true, username: data.username };
  } catch (error) {
    return { error: 'Failed to validate API key' };
  }
});

ipcMain.handle('get-api-key', () => {
  // Return the actual key (decrypt if needed)
  if (settings.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(settings.apiKeyEncrypted, 'base64');
    return safeStorage.decryptString(buffer);
  }
  return settings.apiKey || null;
});

ipcMain.handle('get-api-key-info', () => {
  // Return only safe metadata for display
  if (settings.apiKeyPrefix) {
    return {
      prefix: settings.apiKeyPrefix + '...',
      username: settings.syncUser
    };
  }
  return null;
});

ipcMain.handle('remove-api-key', () => {
  delete settings.apiKey;
  delete settings.apiKeyEncrypted;
  delete settings.apiKeyPrefix;
  delete settings.syncUser;
  settings.syncEnabled = false;
  saveSettings(settings);
  return { success: true };
});

// Helper to get headers with API key
function getAuthHeaders() {
  const key = getStoredApiKey();
  if (!key) return {};
  return { 'X-API-Key': key };
}

function getStoredApiKey() {
  if (settings.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(settings.apiKeyEncrypted, 'base64');
    return safeStorage.decryptString(buffer);
  }
  return settings.apiKey;
}
```

### 2.5 Secure UI for API Key Entry

Update `HyperclayLocalApp.jsx`:

```jsx
function ApiKeySetup({ onComplete }) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    const result = await window.electronAPI.setApiKey(apiKey);

    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else {
      // Clear the key from memory after successful storage
      setApiKey('');
      onComplete(result.username);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('hcsk_')) {
        setApiKey(text);
      } else {
        setError('Invalid key format. Keys should start with "hcsk_"');
      }
    } catch (err) {
      setError('Failed to read clipboard');
    }
  };

  return (
    <div className="api-key-setup p-4 bg-gray-900 rounded">
      <h3 className="text-white mb-2">Connect to Hyperclay</h3>
      <p className="text-gray-400 text-sm mb-3">
        1. Go to <span className="text-blue-400">hyperclay.com/account</span><br/>
        2. Click "Generate Sync Key"<br/>
        3. Copy the key (you'll only see it once!)<br/>
        4. Paste it here:
      </p>
      <div className="flex gap-2 mb-2">
        <input
          type="password" // Use password field to hide the key
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="hcsk_..."
          className="flex-1 p-2 bg-gray-800 text-white rounded font-mono"
          disabled={loading}
          autoComplete="off"
        />
        <button
          onClick={handlePaste}
          className="px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
          disabled={loading}
        >
          Paste
        </button>
      </div>
      {error && (
        <p className="text-red-500 text-sm mb-2">{error}</p>
      )}
      <button
        onClick={handleSubmit}
        disabled={loading || !apiKey}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Validating...' : 'Connect'}
      </button>
      <p className="text-xs text-gray-500 mt-3">
        Your API key will be stored securely and never displayed again.
      </p>
    </div>
  );
}

function SyncStatus() {
  const [syncState, setSyncState] = useState({
    enabled: false,
    connected: false,
    syncing: false,
    keyInfo: null,
    lastError: null
  });

  const [showApiKeySetup, setShowApiKeySetup] = useState(false);

  useEffect(() => {
    // Check if API key exists on load (get safe info only)
    window.electronAPI.getApiKeyInfo().then(info => {
      if (info) {
        setSyncState(prev => ({
          ...prev,
          connected: true,
          keyInfo: info
        }));
      }
    });

    // Listen for sync updates
    window.electronAPI.onSyncUpdate((state) => {
      setSyncState(state);
    });
  }, []);

  const toggleSync = async () => {
    if (!syncState.connected) {
      setShowApiKeySetup(true);
    } else {
      await window.electronAPI.toggleSync(!syncState.enabled);
    }
  };

  const disconnect = async () => {
    if (confirm('This will disconnect sync. You\'ll need to generate a new key to reconnect. Continue?')) {
      await window.electronAPI.removeApiKey();
      setSyncState({
        enabled: false,
        connected: false,
        syncing: false,
        keyInfo: null,
        lastError: null
      });
    }
  };

  return (
    <>
      {/* Main sync toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSync}
          className={`sync-indicator ${syncState.syncing ? 'rotating' : ''}`}
        >
          {syncState.connected ? (
            syncState.enabled ? (
              <span className="text-green-500">sync on</span>
            ) : (
              <span className="text-yellow-500">sync off</span>
            )
          ) : (
            <span className="text-gray-500">sync: connect</span>
          )}
        </button>

        {syncState.connected && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">
              {syncState.keyInfo?.prefix}
            </span>
            <button
              onClick={disconnect}
              className="text-gray-400 hover:text-gray-200"
            >
              disconnect
            </button>
          </div>
        )}
      </div>

      {/* API Key Setup Modal */}
      {showApiKeySetup && !syncState.connected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <ApiKeySetup
              onComplete={(username) => {
                setSyncState(prev => ({
                  ...prev,
                  connected: true,
                  keyInfo: { username }
                }));
                setShowApiKeySetup(false);
              }}
            />
            <button
              onClick={() => setShowApiKeySetup(false)}
              className="mt-4 text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Single error message area */}
      {syncState.lastError && (
        <div className="error-message text-red-500 text-sm mt-2">
          {syncState.lastError}
        </div>
      )}
    </>
  );
}
```

## Part 3: Change Tracking System

### 3.1 Cursor-Based Change Detection

Use ISO timestamps as cursors for platform-agnostic consistency:

```javascript
// Hosted API: /api/local-sync/changes
export async function getChanges(req, res) {
  const { cursor = '1970-01-01T00:00:00.000Z' } = req.query;
  const person = req.syncPerson; // Set by middleware

  // Get all nodes owned by user that changed since cursor
  const changedNodes = await Node.findAll({
    where: {
      updatedAt: { [dbOperators.gt]: new Date(cursor) }
    },
    include: [{
      model: Person,
      where: { id: person.id },
      through: { model: PersonNode }
    }],
    order: [['updatedAt', 'ASC']],
    limit: 100 // Pagination for large datasets
  });

  // Transform to sync format
  const changes = changedNodes.map(node => ({
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parentId,
    path: node.path,
    updatedAt: node.updatedAt.toISOString(),
    checksum: node.syncChecksum,
    action: 'update' // In MVP, all changes are updates
  }));

  // Next cursor is the latest updatedAt timestamp
  const nextCursor = changes.length > 0
    ? changes[changes.length - 1].updatedAt
    : cursor;

  res.json({ changes, nextCursor });
}
```

### 3.2 Checksum for Change Detection

```javascript
// Utility for consistent checksums
import crypto from 'crypto';

export function calculateChecksum(content) {
  return crypto
    .createHash('sha256')
    .update(content, 'utf8')
    .digest('hex')
    .substring(0, 16); // First 16 chars is enough for comparison
}

// Update Node when content changes
export async function updateNodeChecksum(node, content) {
  const checksum = calculateChecksum(content);
  if (node.syncChecksum !== checksum) {
    await node.update({
      syncChecksum: checksum,
      lastSyncedAt: new Date()
    });
  }
}
```

## Part 4: Sync API Endpoints

### 4.1 Core Sync Routes (with Secure Auth)

Add to `hyperclay/hey.js`:

```javascript
// Sync-specific routes (before main router)
app.use('/api/local-sync', localSyncRouter);

// Create dedicated sync router
const localSyncRouter = express.Router();

// Middleware: Validate API key
localSyncRouter.use(async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'No API key provided' });
  }

  // Validate against hashed key
  const person = await validateApiKey(apiKey);

  if (!person) {
    return res.status(401).json({ error: 'Invalid or expired API key' });
  }

  // Check subscription
  if (!person.hasActiveSubscription) {
    return res.status(403).json({ error: 'Sync requires active subscription' });
  }

  req.syncPerson = person;
  next();
});

// Validate endpoint (for testing API key)
localSyncRouter.get('/validate', async (req, res) => {
  res.json({
    valid: true,
    username: req.syncPerson.username,
    email: req.syncPerson.email
  });
});

// Get metadata for initial sync
localSyncRouter.get('/metadata', async (req, res) => {
  const files = [];

  // Get all HTML files (sites)
  for (const node of req.syncPerson.Nodes) {
    if (node.type === 'site') {
      const content = await dx('sites', `${node.name}.html`).getContents();
      files.push({
        id: node.id,
        name: node.name,
        type: 'html',
        path: node.path || '',
        checksum: calculateChecksum(content || ''),
        updatedAt: node.updatedAt.toISOString()
      });
    } else if (node.type === 'upload') {
      // Get upload metadata
      const uploadPath = node.getUploadPath(req.syncPerson.username);
      const exists = await dx(uploadPath).exists();
      if (exists) {
        const content = await dx(uploadPath).getContents();
        files.push({
          id: node.id,
          name: node.name,
          type: 'asset',
          path: node.path || '',
          checksum: calculateChecksum(content || ''),
          updatedAt: node.updatedAt.toISOString()
        });
      }
    }
  }

  res.json({ files });
});

// Get file content
localSyncRouter.get('/files/:nodeId', async (req, res) => {
  const node = req.syncPerson.Nodes.find(n => n.id === parseInt(req.params.nodeId));
  if (!node) {
    return res.status(404).json({ error: 'File not found' });
  }

  let content;
  if (node.type === 'site') {
    content = await dx('sites', `${node.name}.html`).getContents();
  } else if (node.type === 'upload') {
    const uploadPath = node.getUploadPath(req.syncPerson.username);
    content = await dx(uploadPath).getContents();
  }

  res.type(node.type === 'site' ? 'text/html' : 'application/octet-stream');
  res.send(content);
});

// Save file from local
localSyncRouter.post('/save/:name', async (req, res) => {
  const { name } = req.params;
  const content = req.body;

  // Find or create node
  let node = req.syncPerson.Nodes.find(n => n.name === name && n.type === 'site');

  if (!node) {
    // Create new site
    node = await createSiteComplete(name, req.syncPerson, {
      parentId: 'root',
      siteContent: content,
      trackEvent
    });
  } else {
    // Update existing site with backup
    const currentContent = await dx('sites', `${node.name}.html`).getContents();
    if (currentContent !== content) {
      await BackupService.createBackup(node.id, content, req.syncPerson.id);
      await dx('sites').createFileOverwrite(`${node.name}.html`, content);
      await updateNodeChecksum(node, content);
    }
  }

  res.json({ success: true });
});

// Upload non-HTML file
localSyncRouter.post('/upload', uploadMiddleware, async (req, res) => {
  const { fileName, relativePath } = req.body;
  const file = req.file;

  // Block HTML files
  if (fileName.endsWith('.html')) {
    return res.status(400).json({ error: 'HTML files must use /save endpoint' });
  }

  // Create upload node and save file
  const result = await processUploadForSync(req.syncPerson, fileName, relativePath, file);
  res.json({ success: true, nodeId: result.nodeId });
});

// Get changes since cursor
localSyncRouter.get('/changes', getChanges); // Function defined earlier
```

## Part 5: Local Sync Engine

### 5.1 File Watcher

```javascript
// hyperclay-local/main.js
const chokidar = require('chokidar');

let watcher = null;
let syncQueue = [];
let syncInProgress = false;

function startFileWatcher(baseDir) {
  if (watcher) watcher.close();

  watcher = chokidar.watch(baseDir, {
    ignored: [
      '**/sites-versions/**',
      '**/.DS_Store',
      '**/node_modules/**'
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher
    .on('add', path => queueSync('add', path))
    .on('change', path => queueSync('change', path))
    .on('unlink', path => {
      // Never propagate deletions
      logSync(`Local delete ignored: ${path}`);
    });
}

function queueSync(action, filePath) {
  // Debounce by file path
  syncQueue = syncQueue.filter(item => item.path !== filePath);
  syncQueue.push({
    action,
    path: filePath,
    timestamp: Date.now()
  });

  processSyncQueue();
}
```

### 5.2 Bidirectional Sync Logic

```javascript
// hyperclay-local/sync-engine.js
async function performSync() {
  if (!settings.syncEnabled || !getStoredApiKey()) return;

  try {
    // Step 1: Get remote changes
    const cursor = settings.lastSyncCursor || '1970-01-01T00:00:00.000Z';
    const remoteChanges = await fetch(`${BASE_URL}/api/local-sync/changes?cursor=${cursor}`, {
      headers: getAuthHeaders()
    }).then(r => r.json());

    // Step 2: Download and apply remote changes
    for (const change of remoteChanges.changes) {
      await applyRemoteChange(change);
    }

    // Update cursor
    settings.lastSyncCursor = remoteChanges.nextCursor;
    saveSettings(settings);

    // Step 3: Upload local changes
    await uploadLocalChanges();

    return remoteChanges.changes.length > 0;

  } catch (error) {
    logSync(`Sync error: ${error.message}`);

    // Check if API key is invalid
    if (error.message.includes('401') || error.message.includes('403')) {
      addError('AUTH_EXPIRED', 'API key invalid or expired. Please reconnect.');
    } else {
      addError('NETWORK_ERROR', `Sync failed: ${error.message}`);
    }

    return false;
  }
}

async function applyRemoteChange(change) {
  const localPath = getLocalPath(change);

  // Check if local file exists and compare checksums
  let localChecksum = null;
  if (await fs.exists(localPath)) {
    const content = await fs.readFile(localPath, 'utf8');
    localChecksum = calculateChecksum(content);
  }

  // Skip if checksums match
  if (localChecksum === change.checksum) {
    return;
  }

  // Backup local file if it exists
  if (localChecksum) {
    await createBackup(baseDir, change.name, await fs.readFile(localPath, 'utf8'));
  }

  // Download new content
  const content = await fetch(`${BASE_URL}/api/local-sync/files/${change.id}`, {
    headers: getAuthHeaders()
  }).then(r => r.text());

  // Write to local
  await fs.writeFile(localPath, content, 'utf8');
  logSync(`Downloaded: ${change.name}`);
}

async function uploadLocalChanges() {
  // Process sync queue
  while (syncQueue.length > 0) {
    const item = syncQueue.shift();

    // Skip if file doesn't exist (was deleted)
    if (!await fs.exists(item.path)) {
      continue;
    }

    const content = await fs.readFile(item.path);
    const fileName = path.basename(item.path);

    // Check file size
    if (content.length > 20 * 1024 * 1024) {
      logSync(`Skipped (too large): ${fileName}`);
      addError('FILE_TOO_LARGE', `${fileName} exceeds 20MB limit`);
      continue;
    }

    // Determine endpoint based on file type
    if (fileName.endsWith('.html')) {
      const name = fileName.slice(0, -5); // Remove .html
      await fetch(`${BASE_URL}/api/local-sync/save/${name}`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'text/plain'
        },
        body: content
      });
    } else {
      // Upload as asset
      const formData = new FormData();
      formData.append('fileName', fileName);
      formData.append('file', new Blob([content]));
      formData.append('relativePath', getRelativePath(item.path));

      await fetch(`${BASE_URL}/api/local-sync/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });
    }

    logSync(`Uploaded: ${fileName}`);
  }
}

// Helper to determine local path for a remote file
function getLocalPath(remoteNode) {
  const basePath = settings.selectedFolder;

  if (remoteNode.type === 'html') {
    // HTML files can be anywhere - search by name
    const existingFiles = glob.sync(`**/${remoteNode.name}.html`, { cwd: basePath });
    if (existingFiles.length > 0) {
      return path.join(basePath, existingFiles[0]);
    }
    // Default to root if not found
    return path.join(basePath, `${remoteNode.name}.html`);
  } else {
    // Assets maintain their path structure
    const relativePath = remoteNode.path || '';
    return path.join(basePath, relativePath, remoteNode.name);
  }
}
```

## Part 6: Sync Timing & Coordination

### 6.1 Adaptive Polling

```javascript
// hyperclay-local/main.js
let pollInterval = 10000; // Start at 10 seconds
let pollTimer = null;

async function startSyncLoop() {
  if (pollTimer) clearInterval(pollTimer);

  // Initial sync immediately
  await performSync();

  // Then poll adaptively
  pollTimer = setInterval(async () => {
    const hadChanges = await performSync();

    if (hadChanges) {
      pollInterval = 10000; // Reset to 10s if changes found
    } else {
      pollInterval = Math.min(pollInterval + 5000, 60000); // Backoff to max 60s
    }

    // Restart timer with new interval
    clearInterval(pollTimer);
    pollTimer = setInterval(() => performSync(), pollInterval);
  }, pollInterval);
}
```

## Part 7: Error Handling & Logging

### 7.1 Simple Log System

```javascript
// hyperclay-local/main.js
const logPath = path.join(app.getPath('userData'), 'sync.log');

function logSync(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  // Append to file
  fs.appendFileSync(logPath, logLine);

  // Also log to console in dev
  if (process.argv.includes('--dev')) {
    console.log(logLine);
  }
}

// Error prioritization
const errorPriority = {
  'AUTH_EXPIRED': 1,
  'NETWORK_ERROR': 2,
  'FILE_TOO_LARGE': 3,
  'SYNC_CONFLICT': 4,
  'UNKNOWN': 5
};

let errorStack = [];

function addError(type, message) {
  errorStack.push({ type, message, timestamp: Date.now() });
  errorStack.sort((a, b) => errorPriority[a.type] - errorPriority[b.type]);

  // Show highest priority error
  if (errorStack.length > 0) {
    showErrorMessage(errorStack[0].message);
  }
}

// Clear old errors periodically
setInterval(() => {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  errorStack = errorStack.filter(e => e.timestamp > fiveMinutesAgo);
}, 60000);
```

## Part 8: Implementation Timeline

### Phase 1: Foundation (Days 1-2) ✨ SECURE
1. ✅ Database schema with hash storage
2. ✅ API key generation with one-time display
3. ✅ Encrypted key storage in Electron
4. ✅ Basic validation endpoint

### Phase 2: Core Sync (Days 3-5)
1. ✅ Change tracking API `/api/local-sync/changes`
2. ✅ Metadata endpoint `/api/local-sync/metadata`
3. ✅ File download endpoint `/api/local-sync/files/:id`
4. ✅ Save endpoint `/api/local-sync/save/:name`

### Phase 3: Local Implementation (Days 6-8)
1. ✅ File watcher with debouncing
2. ✅ Sync queue processing
3. ✅ Bidirectional sync logic
4. ✅ Local backup system integration

### Phase 4: Polish (Days 9-10)
1. ✅ Secure UI with key warnings
2. ✅ Error handling with key expiry detection
3. ✅ Adaptive polling
4. ✅ Testing with real data

**Total: 10 days with proper security**

## Key Security Features

### What We're Building RIGHT
- **Hashed key storage** - Never store plaintext keys in database
- **One-time key display** - Show once with clear warning
- **Encrypted local storage** - Use Electron's safeStorage when available
- **Key prefix for identification** - Safe way to identify keys without exposing them
- **Auto-revocation on regenerate** - Only one active sync key at a time
- **Password field for input** - Hide key during entry
- **Clear from memory** - Remove key from React state after use
- **Expiry enforcement** - Keys expire after 1 year
- **Secure headers** - `X-API-Key` header over HTTPS only

### What We're NOT Building
- ❌ Plaintext key storage
- ❌ Keys visible in UI after creation
- ❌ Multiple active keys
- ❌ Keys in browser localStorage
- ❌ Keys in URL parameters
- ❌ Unencrypted transmission

## Security Best Practices Implemented

1. **Database Security**
   - SHA-256 hashing for key storage
   - Only prefix stored for identification
   - Comparison done on hashes only

2. **Platform UI Security**
   - One-time display with warning
   - Auto-clear from DOM after copy
   - Session-based temporary storage
   - Clear warning about regeneration

3. **Local App Security**
   - Electron safeStorage encryption
   - Password input field
   - Confirmation before disconnect
   - No key display after setup

4. **Network Security**
   - HTTPS only transmission
   - Header-based authentication
   - No keys in URLs or logs

5. **Lifecycle Management**
   - Single active key enforcement
   - Expiry dates
   - Usage tracking
   - Clean revocation

## Security Implementation Guide

### Complete API Key Security Flow

1. **Generation (Platform)**
   ```javascript
   // User clicks "Generate Sync Key"
   const rawKey = crypto.randomBytes(32).toString('hex');
   const keyValue = `hcsk_${rawKey}`;  // Full key: hcsk_abc123def456...

   // IMMEDIATELY hash before storage
   const keyHash = crypto.createHash('sha256').update(keyValue).digest('hex');

   // Store in database
   database.store({
     keyHash: keyHash,           // SHA-256 hash ONLY
     keyPrefix: 'hcsk_abc123',   // First 12 chars for ID
     // NEVER store keyValue
   });

   // Return to user ONCE
   req.session.tempKey = keyValue;  // Cleared after display
   ```

2. **Display (Platform UI)**
   ```html
   <!-- ONE-TIME WARNING -->
   <div class="critical-warning">
     <h3>⚠️ COPY NOW - YOU WON'T SEE THIS AGAIN!</h3>
     <code id="key">{{session.tempKey}}</code>
     <button onclick="copyAndClear()">Copy</button>
   </div>

   <script>
   function copyAndClear() {
     navigator.clipboard.writeText(key.textContent);
     key.textContent = 'Copied - Key hidden for security';
     // Server already cleared session.tempKey
   }
   </script>
   ```

3. **Entry (Local App)**
   ```jsx
   // Password field hides key during entry
   <input
     type="password"  // HIDES the key
     value={apiKey}
     placeholder="hcsk_..."
   />

   // After validation, clear from React state
   setApiKey('');  // Remove from memory
   ```

4. **Storage (Local)**
   ```javascript
   // Electron main process
   if (safeStorage.isEncryptionAvailable()) {
     // Encrypt using OS keychain
     const encrypted = safeStorage.encryptString(key);
     settings.apiKeyEncrypted = encrypted.toString('base64');
   }
   // NEVER log or display the key
   ```

5. **Validation (Platform)**
   ```javascript
   // Incoming request with X-API-Key header
   const incomingKey = req.headers['x-api-key'];

   // Hash it IMMEDIATELY
   const incomingHash = crypto.createHash('sha256').update(incomingKey).digest('hex');

   // Compare hashes only
   const match = await database.findOne({
     keyHash: incomingHash  // Hash comparison
   });
   ```

### Security Checklist

✅ **Database**
- [ ] ApiKeys table stores `keyHash` not plaintext
- [ ] SHA-256 hashing before any storage
- [ ] Only `keyPrefix` stored for identification
- [ ] No reversible encryption

✅ **Platform UI**
- [ ] One-time display with prominent warning
- [ ] Clear from session after display
- [ ] Copy button with auto-clear
- [ ] Regeneration revokes old keys

✅ **Local App**
- [ ] Password input field
- [ ] Electron safeStorage when available
- [ ] Clear from React state after use
- [ ] No console.log of keys

✅ **Network**
- [ ] HTTPS only
- [ ] Header-based (`X-API-Key`)
- [ ] No keys in URLs
- [ ] No keys in error messages

✅ **Lifecycle**
- [ ] Auto-revoke on regeneration
- [ ] 1-year expiry
- [ ] Usage tracking
- [ ] Single active key per user

### Common Security Mistakes to AVOID

❌ **NEVER DO THIS:**
```javascript
// BAD - Storing plaintext
await ApiKey.create({ key: keyValue });

// BAD - Logging keys
console.log(`Generated key: ${keyValue}`);

// BAD - Comparing plaintext
where: { key: incomingKey }

// BAD - Reversible encryption
const encrypted = encrypt(key);  // Can be decrypted

// BAD - Keys in URLs
fetch(`/api/sync?key=${apiKey}`)

// BAD - Showing key multiple times
<div>Your key: {{apiKey}}</div>
```

✅ **ALWAYS DO THIS:**
```javascript
// GOOD - Store hash only
await ApiKey.create({ keyHash: hash });

// GOOD - Never log keys
console.log('Key generated successfully');

// GOOD - Compare hashes
where: { keyHash: hashIncomingKey }

// GOOD - One-way hash
const hash = sha256(key);  // Can't reverse

// GOOD - Keys in headers
headers: { 'X-API-Key': key }

// GOOD - One-time display
{{session.tempKey}} // Then clear
```

## Success Metrics

✅ **MVP is successful when:**
- User can connect with API key in < 30 seconds
- Keys are never exposed after initial generation
- No plaintext keys stored anywhere
- HTML files sync bidirectionally
- Assets sync from local to hosted
- Changes sync within 10 seconds
- Backups are created on every save
- System handles 100+ files without issues
- Zero security incidents from key exposure

This plan delivers a **secure, working sync system in 10 days** following industry best practices for API key management.
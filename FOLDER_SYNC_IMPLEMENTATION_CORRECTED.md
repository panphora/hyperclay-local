# Folder Sync Implementation - CORRECTED
## Working with Actual Hyperclay Architecture

This document provides the corrected implementation plan that aligns with the actual hyperclay codebase structure, addressing all blockers identified in the code review.

---

## Critical Architecture Facts

### What Actually Exists:
1. **Routes:** `/sync/status`, `/sync/files`, `/sync/upload`, `/sync/download/:filename`
2. **Database:** Uses `Node` model (polymorphic - sites, folders, uploads), NOT separate Site/Folder tables
3. **File Storage:** Sites are stored on disk via `dx('sites', filename)`, NOT in database
4. **Validation:** Uses `isValidName()` from `is-valid-name.js`
5. **Max Folder Depth:** Currently limited to 3 levels in database (Node model validator)

### Key Corrections:
- ❌ No `/sync/list` endpoint - it's `/sync/files`
- ❌ No `db.Site` or `db.Folder` - everything is `Node`
- ❌ Files are on disk, not in database
- ❌ Route registration is in `hey.js`, handlers in `sync-actions.js`
- ❌ Max depth is 3, not 10

---

## Implementation Plan

## Part 1: Server-Side Changes (Hyperclay)

### 1.1 Update Database Model - Increase Max Folder Depth

**File:** `server-lib/database.js`

```javascript
// Line 271 - Change MAX_LEVEL from 3 to 10
validate: {
  async maxNestingLevel() {
    if (this.parentId) {
      let currentNode = this;
      let level = 0;
      const MAX_LEVEL = 10; // CHANGED from 3

      while (currentNode.parentId) {
        level++;
        if (level > MAX_LEVEL) {
          throw new Error(`Exceeded max folder depth (${MAX_LEVEL})`);
        }
        currentNode = await Node.findByPk(currentNode.parentId);
        if (!currentNode) break;
      }
    }
  }
}
```

### 1.2 Update `/sync/files` to Return Paths

**File:** `server-lib/sync-actions.js`

```javascript
/**
 * Get list of all site files with metadata including folder paths
 * GET /sync/files
 */
export async function getSyncFiles(req, res) {
  const person = req.state.user.person;

  // Get all nodes owned by this person (sites and folders)
  const nodes = await Node.findAll({
    include: [{
      model: Person,
      where: { id: person.id },
      through: { attributes: [] }
    }],
    where: {
      type: ['site', 'folder'] // Include folders for hierarchy
    },
    order: [['path', 'ASC'], ['name', 'ASC']]
  });

  const files = [];

  // Process only sites (folders are just for path building)
  for (const node of nodes.filter(n => n.type === 'site')) {
    // Build full path from node's path and name
    const fullPath = node.path ? `${node.path}/${node.name}` : node.name;
    const fileNameWithExt = `${node.name}.html`;

    try {
      const exists = await dx('sites', fileNameWithExt).exists();

      if (exists) {
        const stat = await dx('sites', fileNameWithExt).stat();
        const content = await dx('sites', fileNameWithExt).getContents();

        // Calculate checksum
        const checksum = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

        files.push({
          filename: fullPath,  // CHANGED: Include full path
          path: `${fullPath}.html`, // NEW: Full path with extension
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          lastSyncedAt: node.lastSyncedAt?.toISOString() || null,
          checksum,
          // Include folder info for client to recreate structure
          folder: node.parentId ? {
            id: node.parentId,
            path: node.path
          } : null
        });
      }
    } catch (error) {
      console.error(`Error reading file ${fileNameWithExt}:`, error);
    }
  }

  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    files // Still called 'files' to maintain compatibility
  });
}
```

### 1.3 Update Upload Handler for Paths

**File:** `server-lib/sync-actions.js`

```javascript
/**
 * Upload/update a file with folder support
 * POST /sync/upload
 */
export async function uploadSyncFile(req, res) {
  const person = req.state.user.person;
  let { filename, content, modifiedAt } = req.body;

  if (!filename || !content) {
    return sendError(req, res, 400, 'Filename and content required');
  }

  // Parse path if present
  const pathParts = filename.split('/');
  const siteName = pathParts[pathParts.length - 1];
  const folderPath = pathParts.slice(0, -1).join('/');

  // Validate site name
  const [isValid, errorMessage] = isValidName(siteName, 'site');
  if (!isValid) {
    return sendError(req, res, 400, errorMessage);
  }

  let parentId = null;

  // Create folder hierarchy if needed
  if (folderPath) {
    const folderParts = folderPath.split('/');
    let currentPath = '';

    for (const folderName of folderParts) {
      // Validate folder name
      if (!folderName.match(/^[a-z0-9_-]+$/)) {
        return sendError(req, res, 400,
          `Invalid folder name "${folderName}": must be lowercase letters, numbers, hyphens, and underscores only`
        );
      }

      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

      // Find or create folder
      let folderNode = await Node.findOne({
        include: [{
          model: Person,
          where: { id: person.id },
          through: { attributes: [] }
        }],
        where: {
          name: folderName,
          type: 'folder',
          path: currentPath.split('/').slice(0, -1).join('/') || ''
        }
      });

      if (!folderNode) {
        // Create the folder
        folderNode = await Node.create({
          name: folderName,
          type: 'folder',
          parentId: parentId || null,
          path: currentPath.split('/').slice(0, -1).join('/') || ''
        });

        // Create ownership
        await person.addNode(folderNode);
        console.log(`[SYNC] Created folder: ${currentPath} for ${person.username}`);
      }

      parentId = folderNode.id;
    }
  }

  // Check if site exists
  let node = await Node.findOne({
    include: [{
      model: Person,
      where: { id: person.id },
      through: { attributes: [] }
    }],
    where: {
      name: siteName,
      type: 'site',
      parentId: parentId
    }
  });

  // If node doesn't exist, create it
  if (!node) {
    // Check if ANYONE ELSE owns this name
    const existingNode = await Node.findOne({
      where: { name: siteName, type: 'site' }
    });

    if (existingNode) {
      return sendError(req, res, 409,
        `The site name "${siteName}" is already taken by another user. Please rename your local file.`
      );
    }

    // Create the node
    try {
      node = await Node.create({
        name: siteName,
        type: 'site',
        parentId: parentId,
        path: folderPath || ''
      });

      // Create ownership
      await person.addNode(node);
      console.log(`[SYNC] Created new site: ${siteName} in ${folderPath || 'root'} for ${person.username}`);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return sendError(req, res, 409,
          `The site name "${siteName}" was just taken. Please try a different name.`
        );
      }
      throw error;
    }
  } else {
    // BACKUP before overwriting
    const fileNameWithExt = `${siteName}.html`;
    try {
      const exists = await dx('sites', fileNameWithExt).exists();
      if (exists) {
        const currentContent = await dx('sites', fileNameWithExt).getContents();
        if (currentContent && currentContent !== content) {
          await BackupService.createBackup(node.id, currentContent, person.id);
          console.log(`[SYNC] Backup created for ${fileNameWithExt}`);
        }
      }
    } catch (error) {
      console.error(`[SYNC] Backup failed for ${fileNameWithExt}:`, error);
    }
  }

  // Write the file content WITH .html extension
  const fileNameWithExt = `${siteName}.html`;
  await dx('sites').createFileOverwrite(fileNameWithExt, content);
  console.log(`[SYNC] Wrote file: ${fileNameWithExt}`);

  // Update sync timestamp
  await node.update({ lastSyncedAt: new Date() });

  // Set file mtime if provided
  if (modifiedAt) {
    try {
      await dx('sites', fileNameWithExt).setMtime(new Date(modifiedAt));
    } catch (error) {
      console.warn(`Could not set mtime for ${fileNameWithExt}:`, error);
    }
  }

  res.json({
    success: true,
    filename: siteName,
    path: filename,
    message: 'File uploaded successfully'
  });
}
```

### 1.4 Update Download Handler for Paths

**File:** `server-lib/sync-actions.js`

Update route registration in `hey.js` first:

```javascript
// Line 657 - Change route to accept paths
app.get('/sync/download/*', authenticateApiKey, downloadSyncFile);
```

Then update handler:

```javascript
/**
 * Download a file by path
 * GET /sync/download/*
 */
export async function downloadSyncFile(req, res) {
  const person = req.state.user.person;

  // Get the full path from URL (everything after /sync/download/)
  const fullPath = req.params[0] || req.path.replace('/sync/download/', '');

  if (!fullPath) {
    return sendError(req, res, 400, 'Filename required');
  }

  // Parse path
  const pathParts = fullPath.split('/');
  const siteName = pathParts[pathParts.length - 1];
  const folderPath = pathParts.slice(0, -1).join('/');

  // Build query to find the node
  const whereClause = {
    name: siteName,
    type: 'site'
  };

  // If in a folder, need to find the parent folder first
  let parentId = null;
  if (folderPath) {
    // Find the deepest folder
    const folderParts = folderPath.split('/');
    let currentPath = '';

    for (const folderName of folderParts) {
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

      const folder = await Node.findOne({
        include: [{
          model: Person,
          where: { id: person.id },
          through: { attributes: [] }
        }],
        where: {
          name: folderName,
          type: 'folder',
          path: currentPath.split('/').slice(0, -1).join('/') || ''
        }
      });

      if (!folder) {
        return sendError(req, res, 404, `Folder not found: ${currentPath}`);
      }

      parentId = folder.id;
    }

    whereClause.parentId = parentId;
  } else {
    whereClause.parentId = null;
  }

  // Find the site node
  const node = await Node.findOne({
    include: [{
      model: Person,
      where: { id: person.id },
      through: { attributes: [] }
    }],
    where: whereClause
  });

  if (!node) {
    return sendError(req, res, 404, 'File not found');
  }

  const fileNameWithExt = `${siteName}.html`;

  // Read the file from disk
  try {
    const exists = await dx('sites', fileNameWithExt).exists();

    if (!exists) {
      return sendError(req, res, 404, 'File not found on disk');
    }

    const content = await dx('sites', fileNameWithExt).getContents();
    const stat = await dx('sites', fileNameWithExt).stat();

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

    res.json({
      success: true,
      filename: fullPath,
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      checksum
    });
  } catch (error) {
    console.error(`Error reading file ${fileNameWithExt}:`, error);
    return sendError(req, res, 500, 'Error reading file');
  }
}
```

---

## Part 2: Client-Side Changes (Hyperclay Local)

### 2.1 Fix API Client to Use Correct Endpoints

**File:** `sync-engine/api-client.js`

```javascript
const path = require('path');

/**
 * Fetch list of files from server
 */
async function fetchServerFiles(serverUrl, apiKey) {
  const response = await fetch(`${serverUrl}/sync/files`, { // Correct endpoint
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch files: ${response.statusText}`);
  }

  const data = await response.json();

  // Handle both old format (data.files) and potential new format
  return data.files || data.sites || data;
}

/**
 * Download file from server
 */
async function downloadFromServer(serverUrl, apiKey, filename) {
  // URL encode the filename to handle paths with slashes
  const encodedFilename = encodeURIComponent(filename);

  const response = await fetch(`${serverUrl}/sync/download/${encodedFilename}`, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    content: data.content,
    modifiedAt: data.modifiedAt,
    checksum: data.checksum
  };
}

/**
 * Upload file to server with path support
 */
async function uploadToServer(serverUrl, apiKey, filename, content, modifiedAt) {
  // Don't use path.sep here - always use forward slashes for the server
  const normalizedFilename = filename.split('\\').join('/');

  const response = await fetch(`${serverUrl}/sync/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({
      filename: normalizedFilename, // Include full path
      content,
      modifiedAt: modifiedAt ? modifiedAt.toISOString() : undefined
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Upload failed');
  }

  return await response.json();
}
```

### 2.2 Fix Validation to Handle Paths

**File:** `sync-engine/index.js`

Update the uploadFile function:

```javascript
async uploadFile(filename) {
  try {
    // Normalize path for consistency
    filename = filename.split(path.sep).join('/');

    // Validate depth first
    const MAX_DEPTH = 10;
    const parts = filename.split('/');
    if (parts.length > MAX_DEPTH) {
      console.error(`[SYNC] Path too deep: ${filename}`);
      this.emit('sync-error', {
        file: filename,
        error: `Path exceeds maximum depth of ${MAX_DEPTH} levels`,
        type: 'validation',
        priority: ERROR_PRIORITY.HIGH,
        canRetry: false
      });
      return;
    }

    // For paths, validate using validateFullPath
    if (filename.includes('/')) {
      const validationResult = validateFullPath(filename);
      if (!validationResult.valid) {
        console.error(`[SYNC] Path validation failed: ${validationResult.error}`);
        this.emit('sync-error', {
          file: filename,
          error: validationResult.error,
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          canRetry: false
        });
        return;
      }
    } else {
      // Single file, use regular validation
      const validationResult = validateFileName(filename, false);
      if (!validationResult.valid) {
        console.error(`[SYNC] Validation failed: ${validationResult.error}`);
        this.emit('sync-error', {
          file: filename,
          error: validationResult.error,
          type: 'validation',
          priority: ERROR_PRIORITY.HIGH,
          canRetry: false
        });
        return;
      }
    }

    // Rest of upload logic...
    const localPath = path.join(this.syncFolder, ...filename.split('/'));
    const content = await readFile(localPath);
    const stat = await getFileStats(localPath);

    // Remove .html for server
    const serverFilename = filename.replace(/\.html$/i, '');

    await uploadToServer(
      this.serverUrl,
      this.apiKey,
      serverFilename,
      content,
      stat.mtime
    );

    console.log(`[SYNC] Uploaded ${filename}`);
    this.stats.filesUploaded++;

    this.emit('file-synced', {
      file: filename,
      action: 'upload'
    });

  } catch (error) {
    console.error(`[SYNC] Failed to upload ${filename}:`, error);

    const errorInfo = classifyError(error, { filename, action: 'upload' });
    this.stats.errors.push(formatErrorForLog(error, { filename, action: 'upload' }));

    this.emit('sync-error', errorInfo);
    throw error;
  }
}
```

### 2.3 Update File Watcher

**File:** `sync-engine/index.js`

```javascript
startFileWatcher() {
  // Watch all HTML files recursively
  this.watcher = chokidar.watch('**/*.html', {
    cwd: this.syncFolder,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: SYNC_CONFIG.FILE_STABILIZATION,
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.*',
      '**/backup/**'
    ]
  });

  this.watcher
    .on('add', relativePath => {
      // Normalize to forward slashes for consistency
      relativePath = relativePath.split(path.sep).join('/');
      console.log(`[SYNC] File added: ${relativePath}`);
      this.queueSync('add', relativePath);
    })
    .on('change', relativePath => {
      relativePath = relativePath.split(path.sep).join('/');
      console.log(`[SYNC] File changed: ${relativePath}`);
      this.queueSync('change', relativePath);
    })
    .on('unlink', relativePath => {
      relativePath = relativePath.split(path.sep).join('/');
      console.log(`[SYNC] File deleted locally: ${relativePath} (NOT syncing delete)`);
      // Never sync deletes
    })
    .on('error', error => {
      console.error('[SYNC] Watcher error:', error);
    });

  console.log('[SYNC] File watcher started (recursive)');
}
```

---

## Testing Checklist

### Server-Side Tests
- [ ] Increase MAX_LEVEL to 10 in database.js
- [ ] Test `/sync/files` returns paths correctly
- [ ] Test `/sync/upload` with `portfolio/projects/game` creates folders
- [ ] Test `/sync/download/portfolio/projects/game` works
- [ ] Verify folder validation (lowercase only)
- [ ] Verify site name validation (reserved words)

### Client-Side Tests
- [ ] Test recursive file watching (`**/*.html`)
- [ ] Test path validation with validateFullPath
- [ ] Test upload with nested paths
- [ ] Test download creates local folders
- [ ] Test Windows path normalization
- [ ] Verify no auto-deletion on rename/move

### Integration Tests
- [ ] Create `folder1/folder2/site.html` locally → syncs to server
- [ ] Download from server → creates local folder structure
- [ ] Rename file locally → old file stays on server
- [ ] Move file locally → creates new copy on server

---

## Key Differences from Original Plan

1. **Using Existing Infrastructure**
   - Works with Node model, not separate Site/Folder tables
   - Uses `/sync/files` not `/sync/list`
   - Files stored on disk via dx(), not in database

2. **Proper Route Registration**
   - Update route in hey.js to `/sync/download/*`
   - Handlers remain in sync-actions.js

3. **Correct Validation**
   - Use validateFullPath for paths
   - Use isValidName for individual names

4. **Database Constraints**
   - Must increase MAX_LEVEL from 3 to 10
   - Respect Node model's unique constraints

---

## Migration Notes

### Database Migration
```sql
-- No schema changes needed, just update MAX_LEVEL constant
-- Existing data remains compatible
```

### Backward Compatibility
- Old clients sending just `filename: "mysite"` still work
- New clients send `filename: "folder/subfolder/mysite"`
- Server handles both formats

---

This corrected implementation aligns with the actual hyperclay architecture and addresses all identified blockers.
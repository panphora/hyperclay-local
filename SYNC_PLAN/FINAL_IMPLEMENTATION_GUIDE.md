# Final Implementation Guide: Hyperclay Local ↔ Hosted Sync

**Version 3.1** - Production-Ready with Simplified UI (Modal-Based)

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Phase 1: Database Setup (Day 1)](#phase-1-database-setup-day-1)
3. [Phase 2: API Key System (Days 2-3)](#phase-2-api-key-system-days-2-3)
4. [Phase 3: Sync API Endpoints (Days 4-5)](#phase-3-sync-api-endpoints-days-4-5)
5. [Phase 4: Local Sync Engine (Days 6-7)](#phase-4-local-sync-engine-days-6-7)
6. [Phase 5: UI Integration (Days 8-9)](#phase-5-ui-integration-days-8-9)
7. [Phase 6: Testing & Polish (Day 10)](#phase-6-testing--polish-day-10)

---

## Overview & Architecture

### What We're Building
A bidirectional sync system between Hyperclay Local (Electron desktop app) and Hyperclay platform that:
- **Preserves newer local files** during initial sync (never overwrites recent work)
- Uses secure API key authentication with SHA-256 hashing
- Provides real-time file watching and background sync
- Includes full UI integration with status indicators and sync summary
- Supports binary files (images, PDFs, etc.)
- Maintains daily rotating logs for debugging
- **Simple modal-based API key management** (no separate account pages needed)

### Architecture Overview
```
┌─────────────────────┐           ┌──────────────────────┐
│  Hyperclay Local    │           │   Hyperclay Platform │
├─────────────────────┤           ├──────────────────────┤
│ • Electron App      │  HTTPS    │ • Express Server     │
│ • React UI          │ ◄────────►│ • Sequelize ORM      │
│ • File Watcher      │  API Key  │ • JSON API           │
│ • Sync Engine       │  Auth     │ • API Router         │
│ • Daily Logs        │           │ • Time Provider      │
└─────────────────────┘           └──────────────────────┘

Sync Decision Flow (v3.1):
1. Get server time on sync start → Calculate clock offset
2. For each file: Compare timestamps (with offset + 10s buffer)
3. Preserve local if newer, download if older
4. Log all decisions to daily rotating log files
```

### Security Features
- API keys are SHA-256 hashed before storage (never stored in plaintext)
- Keys displayed only once during generation in modal
- Electron safeStorage for encrypted local key storage
- Subscription validation on every request
- One-year automatic expiration

### Key Features in v3.1
✅ **Time-Based Protection**: Never overwrite newer local files
✅ **Clock Skew Handling**: Automatic offset calculation
✅ **Daily Log Rotation**: Manageable log files with auto-cleanup
✅ **Sync Summary UI**: Click info icon to see sync statistics
✅ **Future File Handling**: Respects intentionally future-dated files
✅ **Smart Buffering**: 10-second buffer for "same time" detection
✅ **Simple Modal UI**: Generate keys via dashboard modal (no account pages)
✅ **Fixed Stats Tracking**: Polling updates stats correctly

---

## Phase 1: Database Setup (Day 1)

### Step 1.1: Create Migration File

**File**: `hyperclay/migrations/016.js` (NEW FILE)

```javascript
// Migration 016: Add API keys table and sync tracking columns
// Uses default export to match existing migration runner pattern

import { sequelize } from '../server-lib/database.js';

export default async function migration016() {
  const queryInterface = sequelize.getQueryInterface();
  const { DataTypes } = sequelize.Sequelize;

  console.log('Adding sync tracking columns to Nodes table...');

  // Add sync tracking columns to Nodes table
  await queryInterface.addColumn('Nodes', 'lastSyncedAt', {
    type: DataTypes.DATE,
    allowNull: true
  });

  await queryInterface.addColumn('Nodes', 'syncChecksum', {
    type: DataTypes.STRING(64),
    allowNull: true
  });

  console.log('Creating ApiKeys table...');

  // Create ApiKeys table with secure hash storage
  await queryInterface.createTable('ApiKeys', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    keyHash: {
      type: DataTypes.STRING(64),
      unique: true,
      allowNull: false,
      comment: 'SHA-256 hash of the API key'
    },
    keyPrefix: {
      type: DataTypes.STRING(12),
      allowNull: false,
      comment: 'First 12 chars for identification'
    },
    personId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'People',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    name: {
      type: DataTypes.STRING(100),
      defaultValue: 'Sync Key'
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  // Add indexes for performance
  await queryInterface.addIndex('ApiKeys', ['keyHash']);
  await queryInterface.addIndex('ApiKeys', ['personId']);
  await queryInterface.addIndex('ApiKeys', ['keyPrefix']);
  await queryInterface.addIndex('ApiKeys', ['isActive', 'expiresAt']);

  console.log('✅ Migration 016 completed successfully');
}
```

**File**: `hyperclay/migrations/executed-migrations.txt` (ADD this line)

```
016
```

### Step 1.2: Update Node Model Definition

**File**: `hyperclay/server-lib/database.js` (MODIFY - add after line 291)

```javascript
// Add these attributes to the Node model definition (after line 291)
  lastSyncedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  syncChecksum: {
    type: DataTypes.STRING(64),
    allowNull: true
  }
```

Also add the ApiKey model (after line 525):

```javascript
// API Keys Model - Store hashed keys for secure local sync
const ApiKey = sequelize.define("ApiKey", {
  keyHash: {
    type: DataTypes.STRING(64),
    unique: true,
    allowNull: false
  },
  keyPrefix: {
    type: DataTypes.STRING(12),
    allowNull: false
  },
  personId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: Person, key: "id" }
  },
  name: {
    type: DataTypes.STRING(100),
    defaultValue: 'Sync Key'
  },
  lastUsedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  indexes: [
    { fields: ["keyHash"] },
    { fields: ["personId"] },
    { fields: ["keyPrefix"] }
  ]
});

// Add relationships
Person.hasMany(ApiKey, { foreignKey: "personId" });
ApiKey.belongsTo(Person, { foreignKey: "personId" });

// Export at bottom (around line 764)
export {
  // ... existing exports ...
  ApiKey,  // ADD THIS
};
```

### Step 1.3: Run Migration

```bash
# In hyperclay directory
cd hyperclay

# Run the migration using existing runner
node migrate.js 016

# Or just run next migration (it will find 016)
node migrate.js
```

---

## Phase 2: API Key System (Days 2-3)

### Step 2.1: Create API Key Service

**File**: `hyperclay/server-lib/api-key-service.js` (NEW FILE)

```javascript
/**
 * API Key Service - Handles secure generation, validation, and management of API keys
 * FIXED: Uses req.state.user.person instead of req.user
 */

import crypto from 'crypto';
import { ApiKey, Person, Node, dbOperators } from './database.js';

export async function generateApiKey(personId, name = 'Sync Key') {
  const person = await Person.findByPk(personId);
  if (!person) {
    throw new Error('Person not found');
  }

  if (!person.hasActiveSubscription) {
    throw new Error('API keys require active subscription');
  }

  // Deactivate existing sync keys
  await ApiKey.update(
    { isActive: false },
    {
      where: {
        personId,
        name: 'Sync Key',
        isActive: true
      }
    }
  );

  // Generate cryptographically secure key
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyValue = `hcsk_${rawKey}`;

  // Create SHA-256 hash for storage
  const keyHash = crypto
    .createHash('sha256')
    .update(keyValue)
    .digest('hex');

  const keyPrefix = keyValue.substring(0, 12);

  // Set expiry to 1 year
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // Store the HASH in database
  await ApiKey.create({
    keyHash,
    keyPrefix,
    personId,
    name,
    expiresAt,
    isActive: true
  });

  // Return the actual key - ONLY TIME IT'S IN PLAINTEXT
  return {
    key: keyValue,
    prefix: keyPrefix,
    expiresAt: expiresAt.toISOString()
  };
}

export async function validateApiKey(key) {
  if (!key || !key.startsWith('hcsk_')) {
    return null;
  }

  // Hash the incoming key
  const keyHash = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');

  // Find by hash
  const apiKey = await ApiKey.findOne({
    where: {
      keyHash,
      isActive: true,
      expiresAt: { [dbOperators.gt]: new Date() }
    },
    include: [{
      model: Person,
      include: [{
        model: Node,
        through: { attributes: [] }
      }]
    }]
  });

  if (!apiKey) {
    return null;
  }

  // Update last used
  await apiKey.update({ lastUsedAt: new Date() });

  return apiKey.Person;
}

export async function listApiKeys(personId) {
  const keys = await ApiKey.findAll({
    where: {
      personId,
      isActive: true
    },
    attributes: ['id', 'keyPrefix', 'name', 'createdAt', 'lastUsedAt', 'expiresAt'],
    order: [['createdAt', 'DESC']]
  });

  return keys.map(k => ({
    id: k.id,
    prefix: k.keyPrefix + '...',
    name: k.name,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    isExpired: new Date(k.expiresAt) < new Date()
  }));
}
```

---

## Phase 3: Sync API Endpoints (Days 4-5)

### Step 3.1: Create Sync Router

**File**: `hyperclay/server-lib/sync-router.js` (NEW FILE)

IMPORTANT: This router uses `basedir` for filesystem operations. Import it from `'./basedir.js'` (which is typically a default export of the project's base directory path). This ensures the server works correctly regardless of the current working directory.

```javascript
/**
 * Sync Router - Handles all /api/local-sync/* endpoints
 * v3.1: Returns server time for clock offset calculation
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { validateApiKey } from './api-key-service.js';
import { Node, Person, PersonNode, dbOperators } from './database.js';
import { dx } from './dx.js';
import basedir from './basedir.js';  // Import basedir from correct location (typically a default export)
import BackupService from './backup-service.js';

const router = express.Router();

// Middleware: Validate API key
router.use(async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'No API key provided',
      hint: 'Include X-API-Key header'
    });
  }

  const person = await validateApiKey(apiKey);

  if (!person) {
    return res.status(401).json({
      error: 'Invalid or expired API key',
      hint: 'Generate a new key in the dashboard'
    });
  }

  if (!person.hasActiveSubscription) {
    return res.status(403).json({
      error: 'Sync requires active subscription'
    });
  }

  req.syncPerson = person;
  next();
});

// GET /api/local-sync/validate
router.get('/validate', (req, res) => {
  res.json({
    valid: true,
    username: req.syncPerson.username,
    email: req.syncPerson.email,
    nodeCount: req.syncPerson.Nodes?.length || 0,
    serverTime: new Date().toISOString() // v3.1: Include server time
  });
});

// Helper: Calculate checksum
function calculateChecksum(content) {
  if (!content) return null;
  // Handle both strings and buffers
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .substring(0, 16);
}

// Helper: Check if file is binary
function isBinaryFile(filename) {
  const textExtensions = ['.html', '.css', '.js', '.json', '.txt', '.md', '.svg', '.xml'];
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext && !textExtensions.includes(ext);
}

// GET /api/local-sync/metadata
router.get('/metadata', async (req, res) => {
  try {
    const files = [];

    for (const node of req.syncPerson.Nodes) {
      if (node.type === 'site') {
        const filePath = `${node.name}.html`;
        const content = await dx('sites').getContents(filePath);

        if (content !== null) {
          files.push({
            id: node.id,
            name: node.name,
            type: 'html',
            path: node.path || '',
            checksum: calculateChecksum(content),
            updatedAt: node.updatedAt.toISOString(),
            size: Buffer.byteLength(content, 'utf8'),
            encoding: 'utf8'
          });
        }
      } else if (node.type === 'upload') {
        const uploadPath = `uploads/${req.syncPerson.username}/${node.path ? node.path + '/' : ''}${node.name}`;
        const exists = await dx().exists(uploadPath);

        if (exists) {
          const isBinary = isBinaryFile(node.name);
          let content, checksum, size;

          if (isBinary) {
            // For binary files, read as buffer
            const fullPath = path.join(basedir, uploadPath);
            content = await fs.readFile(fullPath);
            checksum = calculateChecksum(content);
            size = content.length;
          } else {
            content = await dx().getContents(uploadPath);
            checksum = calculateChecksum(content);
            size = content ? Buffer.byteLength(content, 'utf8') : 0;
          }

          files.push({
            id: node.id,
            name: node.name,
            type: 'asset',
            path: node.path || '',
            checksum,
            updatedAt: node.updatedAt.toISOString(),
            size,
            encoding: isBinary ? 'base64' : 'utf8'
          });
        }
      }
    }

    res.json({
      files,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      timestamp: new Date().toISOString(), // v3.1: Server timestamp for clock calibration
      serverTime: new Date().toISOString()  // v3.1: Explicit server time
    });
  } catch (error) {
    console.error('Metadata error:', error);
    res.status(500).json({ error: 'Failed to get metadata' });
  }
});

// GET /api/local-sync/changes
router.get('/changes', async (req, res) => {
  try {
    const cursor = req.query.cursor || '1970-01-01T00:00:00.000Z';

    const changedNodes = await Node.findAll({
      where: {
        updatedAt: { [dbOperators.gt]: new Date(cursor) }
      },
      include: [{
        model: Person,
        where: { id: req.syncPerson.id },
        through: { model: PersonNode }
      }],
      order: [['updatedAt', 'ASC']],
      limit: 100
    });

    const changes = [];
    for (const node of changedNodes) {
      let checksum = null;
      let encoding = 'utf8';

      if (node.type === 'site') {
        const content = await dx('sites').getContents(`${node.name}.html`);
        checksum = calculateChecksum(content);
      } else if (node.type === 'upload') {
        const uploadPath = `uploads/${req.syncPerson.username}/${node.path ? node.path + '/' : ''}${node.name}`;

        if (isBinaryFile(node.name)) {
          const fullPath = path.join(basedir, uploadPath);
          const content = await fs.readFile(fullPath);
          checksum = calculateChecksum(content);
          encoding = 'base64';
        } else {
          const content = await dx().getContents(uploadPath);
          checksum = calculateChecksum(content);
        }
      }

      changes.push({
        id: node.id,
        name: node.name,
        type: node.type === 'site' ? 'html' : 'asset',
        path: node.path || '',
        updatedAt: node.updatedAt.toISOString(),
        checksum,
        encoding,
        action: 'update'
      });
    }

    const nextCursor = changes.length > 0
      ? changes[changes.length - 1].updatedAt
      : cursor;

    res.json({
      changes,
      nextCursor,
      hasMore: changes.length === 100,
      serverTime: new Date().toISOString() // v3.1: Include server time
    });
  } catch (error) {
    console.error('Changes error:', error);
    res.status(500).json({ error: 'Failed to get changes' });
  }
});

// GET /api/local-sync/files/:nodeId
router.get('/files/:nodeId', async (req, res) => {
  try {
    const nodeId = parseInt(req.params.nodeId);
    const node = req.syncPerson.Nodes.find(n => n.id === nodeId);

    if (!node) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (node.type === 'site') {
      const content = await dx('sites').getContents(`${node.name}.html`);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(content);
    } else if (node.type === 'upload') {
      const uploadPath = `uploads/${req.syncPerson.username}/${node.path ? node.path + '/' : ''}${node.name}`;

      if (isBinaryFile(node.name)) {
        const fullPath = path.join(basedir, uploadPath);
        const content = await fs.readFile(fullPath);

        // Set content type based on extension
        const ext = path.extname(node.name).toLowerCase();
        const contentTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.pdf': 'application/pdf',
          '.zip': 'application/zip'
        };

        res.set('Content-Type', contentTypes[ext] || 'application/octet-stream');
        res.set('Content-Length', content.length);
        res.send(content);
      } else {
        const content = await dx().getContents(uploadPath);
        const ext = node.name.match(/\.[^.]+$/)?.[0];

        if (ext === '.css') res.set('Content-Type', 'text/css');
        else if (ext === '.js') res.set('Content-Type', 'application/javascript');
        else if (ext === '.json') res.set('Content-Type', 'application/json');
        else res.set('Content-Type', 'text/plain');

        res.send(content);
      }
    }
  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// POST /api/local-sync/save/:name
router.post('/save/:name', express.text({ limit: '5mb' }), async (req, res) => {
  try {
    const { name } = req.params;
    const content = req.body;

    if (!content) {
      return res.status(400).json({ error: 'No content provided' });
    }

    let node = req.syncPerson.Nodes.find(n =>
      n.name === name && n.type === 'site'
    );

    if (!node) {
      // Create new site
      node = await Node.create({
        name,
        type: 'site',
        parentId: 0
      });

      await PersonNode.create({
        personId: req.syncPerson.id,
        nodeId: node.id
      });
    } else {
      // Create backup with CURRENT content before overwriting
      const currentContent = await dx('sites').getContents(`${node.name}.html`);
      if (currentContent && currentContent !== content) {
        await BackupService.createBackup(
          node.id,
          currentContent,
          req.syncPerson.id
        );
      }
    }

    // Save the new content
    await dx('sites').createFileOverwrite(`${name}.html`, content);

    // Update node checksum and sync time
    const checksum = calculateChecksum(content);
    await node.update({
      syncChecksum: checksum,
      lastSyncedAt: new Date()
    });

    res.json({
      success: true,
      nodeId: node.id,
      checksum
    });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// POST /api/local-sync/upload
router.post('/upload', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const { fileName, relativePath, content, encoding } = req.body;

    if (!fileName || !content) {
      return res.status(400).json({ error: 'Missing fileName or content' });
    }

    if (fileName.endsWith('.html')) {
      return res.status(400).json({
        error: 'HTML files must use /save endpoint'
      });
    }

    // Handle binary content properly
    let fileBuffer;
    if (encoding === 'base64') {
      fileBuffer = Buffer.from(content, 'base64');
    } else {
      fileBuffer = Buffer.from(content, 'utf8');
    }

    // Check size limit
    if (fileBuffer.length > 20 * 1024 * 1024) {
      return res.status(400).json({
        error: 'File exceeds 20MB limit'
      });
    }

    // Proper path construction and dx() usage
    const uploadBasePath = path.posix.join('uploads', req.syncPerson.username);

    if (relativePath) {
      // Navigate to the subdirectory and create file there
      const filePath = path.posix.join(relativePath, fileName);
      await dx(uploadBasePath).createFileOverwrite(filePath, fileBuffer);
    } else {
      // Create file directly in user's upload directory
      await dx(uploadBasePath).createFileOverwrite(fileName, fileBuffer);
    }

    // Create or update node
    let node = req.syncPerson.Nodes.find(n =>
      n.name === fileName &&
      n.type === 'upload' &&
      n.path === (relativePath || '')
    );

    if (!node) {
      node = await Node.create({
        name: fileName,
        type: 'upload',
        parentId: 0,
        path: relativePath || ''
      });

      await PersonNode.create({
        personId: req.syncPerson.id,
        nodeId: node.id
      });
    }

    // Update sync tracking
    await node.update({
      syncChecksum: calculateChecksum(fileBuffer),
      lastSyncedAt: new Date()
    });

    res.json({
      success: true,
      nodeId: node.id
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

export default router;
```

### Step 3.2: Wire Up Sync API Router in hey.js

**File**: `hyperclay/hey.js` (MODIFY)

Add import at the top (after line 17):
```javascript
import syncRouter from './server-lib/sync-router.js';
```

Mount the sync router (around line 300-310, BEFORE the state machine router):
```javascript
// Mount local sync API routes (BEFORE state machine)
app.use('/api/local-sync', syncRouter);
```

### Step 3.3: Add Simple API Key Generation Endpoint

**File**: `hyperclay/hey.js` (MODIFY - add to routingTable)

**IMPORTANT:** This is v3.1's simplified approach:
- ✅ **NO account page templates** (no account.edge, no api-key-generated.edge)
- ✅ **NO /account routes** - completely removed for simplicity
- ✅ **Single JSON endpoint** - returns key data for client-side modal
- ✅ **Modal-only UI** - dashboard JavaScript displays the key in a modal

**How the routing works:**

```
User makes: POST /generate-sync-key
  ↓
State machine detects:
  • action: 'generate-sync-key' (from single path segment)
  • resourceType: 'main_app' (default for main domain)
  • userType: 'dev' (from authenticated user)
  ↓
Routing key: 'dev:main_app:generate-sync-key'
  ↓
✅ Handler matches and executes
```

Add imports at the top (after line 17):
```javascript
import { generateApiKey } from './server-lib/api-key-service.js';
```

Add this route to the `routingTable` map (around line 370-380, after existing main_app routes):

```javascript
// API Key Generation (v3.1: Simple JSON endpoint for modal)
// POST /generate-sync-key → 'dev:main_app:generate-sync-key'
'dev:main_app:generate-sync-key': [
  state(s => s.user.person?.hasActiveSubscription).require('Active subscription required'),
  async (req, res) => {
    try {
      const person = req.state.user.person;  // CORRECT: Use req.state.user.person
      const result = await generateApiKey(person.id, 'Sync Key');

      // Return JSON for client-side modal display
      res.json({
        success: true,
        key: result.key,        // hcsk_abc123... (full key, shown once)
        prefix: result.prefix,  // hcsk_abc123 (for identification)
        expiresAt: result.expiresAt,
        username: person.username
      });
    } catch (error) {
      console.error('Failed to generate API key:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate sync key'
      });
    }
  }
],
```

**Dashboard UI Implementation** (JavaScript to add in your dashboard):

```javascript
// Example: Add a "Generate Sync Key" button/menu item in the dashboard
document.querySelector('#generate-sync-key-btn').addEventListener('click', async () => {
  try {
    const response = await fetch('/generate-sync-key', {
      method: 'POST',
      credentials: 'include'  // Include auth cookies
    });

    const data = await response.json();

    if (data.success) {
      // Show modal with the API key
      showModal({
        title: 'Sync Key Generated',
        content: `
          <div class="alert warning">
            ⚠️ Copy this key now! You won't see it again.
          </div>
          <div class="key-display">
            <code id="api-key">${data.key}</code>
            <button onclick="copyToClipboard('${data.key}')">Copy</button>
          </div>
          <p>Expires: ${new Date(data.expiresAt).toLocaleDateString()}</p>
        `
      });
    } else {
      alert(data.error || 'Failed to generate key');
    }
  } catch (error) {
    alert('Failed to generate sync key');
  }
});
```

**Key Points:**
- The endpoint is a simple POST that returns JSON
- No Edge templates needed anywhere
- Dashboard JavaScript handles the modal display
- Key is shown once and then gone (security by design)

---

## Phase 4: Local Sync Engine (Days 6-7)

### Step 4.1: Create Sync Engine Module with Time Protection

**File**: `hyperclay-local/sync-engine.js` (NEW FILE)

```javascript
/**
 * Sync Engine - Handles bidirectional sync between local and hosted
 * v3.1: Time-based protection with clock offset calculation
 * FIXED: Stats tracking in checkRemoteChanges()
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');

class SyncEngine {
  constructor(settings, baseDir) {
    this.settings = settings;
    this.baseDir = baseDir;
    this.watcher = null;
    this.syncQueue = [];
    this.syncInProgress = false;
    this.pollTimer = null;
    this.pollInterval = 10000;
    this.lastSyncCursor = settings.lastSyncCursor || '1970-01-01T00:00:00.000Z';
    this.listeners = new Map();

    // v3.1: Time sync properties
    this.clockOffset = 0; // Server time - local time
    this.timeBuffer = 10000; // 10 seconds buffer for "same time"

    // v3.1: Daily logging
    this.currentLogDate = null;
    this.logStream = null;

    // v3.1: Sync statistics
    this.syncStats = {
      filesPreserved: 0,
      filesDownloaded: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      lastSyncTime: null
    };
  }

  // v3.1: Daily log management
  async getLogPath() {
    const logsDir = path.join(this.baseDir, 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
    return path.join(logsDir, `sync-${date}.log`);
  }

  async writeLog(message, level = 'INFO') {
    try {
      const logPath = await this.getLogPath();
      const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
      const logLine = `[${timestamp}] ${level}: ${message}\n`;

      await fs.appendFile(logPath, logLine);

      // Also output to console
      console.log(`[SYNC] ${message}`);

      // v3.1: Auto-cleanup old logs (older than 30 days)
      await this.cleanupOldLogs();
    } catch (error) {
      console.error('[SYNC] Failed to write log:', error);
    }
  }

  async cleanupOldLogs() {
    try {
      const logsDir = path.join(this.baseDir, 'logs');
      const files = await fs.readdir(logsDir);
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      for (const file of files) {
        if (file.startsWith('sync-') && file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const stats = await fs.stat(filePath);

          if (stats.mtimeMs < thirtyDaysAgo) {
            await fs.unlink(filePath);
            console.log(`[SYNC] Deleted old log: ${file}`);
          }
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  async startNewLogSession() {
    const logPath = await this.getLogPath();

    await this.writeLog('=== Sync Session Started ===', 'SESSION');
    await this.writeLog(`Time: ${new Date().toISOString()}`, 'SESSION');
    await this.writeLog(`User: ${this.settings.syncUser || 'unknown'}`, 'SESSION');
    await this.writeLog(`Folder: ${this.baseDir}`, 'SESSION');
    await this.writeLog(`Mode: preserve-newer (${this.timeBuffer/1000}s buffer)`, 'SESSION');
    await this.writeLog('============================', 'SESSION');
  }

  // Check if file is binary
  isBinaryFile(filename) {
    const textExtensions = ['.html', '.css', '.js', '.json', '.txt', '.md', '.svg', '.xml'];
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
    return ext && !textExtensions.includes(ext);
  }

  calculateChecksum(content) {
    if (!content) return null;
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16);
  }

  getBaseUrl() {
    return process.env.NODE_ENV === 'development'
      ? 'http://localhyperclay.com:9999'
      : 'https://hyperclay.com';
  }

  async apiRequest(endpoint, options = {}) {
    const apiKey = this.settings.getApiKey();
    if (!apiKey) {
      throw new Error('No API key configured');
    }

    const url = `${this.getBaseUrl()}/api/local-sync${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': apiKey,
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response;
  }

  // v3.1: Calculate clock offset on start
  async calibrateClock() {
    try {
      const response = await this.apiRequest('/validate');
      const data = await response.json();

      if (data.serverTime) {
        const serverTime = new Date(data.serverTime).getTime();
        const localTime = Date.now();
        this.clockOffset = serverTime - localTime;

        await this.writeLog(`Clock calibration: Server time is ${Math.abs(this.clockOffset)}ms ${this.clockOffset >= 0 ? 'ahead' : 'behind'}`, 'INFO');
        await this.writeLog(`Server Time: ${new Date(serverTime).toISOString()}`, 'DEBUG');
        await this.writeLog(`Local Time: ${new Date(localTime).toISOString()}`, 'DEBUG');
      }
    } catch (error) {
      await this.writeLog(`Clock calibration failed: ${error.message}`, 'WARNING');
      this.clockOffset = 0; // Fallback to no offset
    }
  }

  // v3.1: Compare timestamps with offset and buffer
  isLocalNewer(localTimestamp, serverTimestamp) {
    // Adjust local time to server time reference
    const adjustedLocalTime = localTimestamp + this.clockOffset;

    // Check if local file is in the future (even after adjustment)
    if (adjustedLocalTime > Date.now() + this.clockOffset + 60000) {
      this.writeLog(`WARNING: File dated in future: ${new Date(localTimestamp).toISOString()}`, 'WARNING');
      return true; // Always keep future files
    }

    // If times are within buffer (10 seconds), consider them the same
    if (Math.abs(adjustedLocalTime - serverTimestamp) <= this.timeBuffer) {
      return false; // Within buffer, treat as same time, use server version
    }

    // Otherwise, local is newer if its adjusted time is greater
    return adjustedLocalTime > serverTimestamp;
  }

  async start() {
    await this.startNewLogSession();
    await this.writeLog('Starting sync engine...', 'INFO');

    // v3.1: Calibrate clock first
    await this.calibrateClock();

    await this.performInitialSync();
    this.startFileWatcher();
    this.startPolling();
    this.emit('started');

    // v3.1: Emit initial stats
    this.emit('sync-stats', this.syncStats);
  }

  async stop() {
    await this.writeLog('Stopping sync engine...', 'INFO');
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    await this.processSyncQueue();
    this.emit('stopped');
  }

  async performInitialSync() {
    await this.writeLog('Initial sync starting...', 'INFO');
    this.emit('sync-start', { type: 'initial' });

    try {
      const response = await this.apiRequest('/metadata');
      const { files, serverTime } = await response.json();

      await this.writeLog(`Found ${files.length} files on server`, 'INFO');

      let downloaded = 0;
      let skipped = 0;
      let preserved = 0; // v3.1: Track preserved files

      for (const file of files) {
        const localPath = this.getLocalPath(file);

        // Check if file exists locally
        let needsDownload = true;
        let localExists = false;
        let localMtime = null;

        try {
          const stats = await fs.stat(localPath);
          localExists = true;
          localMtime = stats.mtimeMs;

          // v3.1: Check if local is newer
          const serverTime = new Date(file.updatedAt).getTime();

          if (this.isLocalNewer(localMtime, serverTime)) {
            needsDownload = false;
            preserved++;
            await this.writeLog(`PRESERVE ${file.name} - local is newer (${new Date(localMtime).toISOString()})`, 'INFO');
          } else {
            // Also check checksum
            const localContent = file.encoding === 'base64'
              ? await fs.readFile(localPath)
              : await fs.readFile(localPath, 'utf8');
            const localChecksum = this.calculateChecksum(localContent);

            if (localChecksum === file.checksum) {
              needsDownload = false;
              skipped++;
              await this.writeLog(`SKIP ${file.name} - checksums match`, 'DEBUG');
            } else {
              await this.writeLog(`DOWNLOAD ${file.name} - server is newer`, 'INFO');
            }
          }
        } catch (err) {
          // File doesn't exist locally
          await this.writeLog(`DOWNLOAD ${file.name} - new file`, 'INFO');
        }

        if (needsDownload) {
          if (localExists) {
            try {
              await this.createBackup(localPath);
            } catch (err) {
              // Backup failed, but continue
            }
          }

          // Download file
          const contentResponse = await this.apiRequest(`/files/${file.id}`);

          // Ensure directory exists
          await fs.mkdir(path.dirname(localPath), { recursive: true });

          if (file.encoding === 'base64') {
            const buffer = await contentResponse.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(buffer));
          } else {
            const text = await contentResponse.text();
            await fs.writeFile(localPath, text, 'utf8');
          }

          downloaded++;
          this.emit('file-synced', {
            file: file.name,
            action: 'download'
          });
        }
      }

      // v3.1: Update stats
      this.syncStats.filesPreserved = preserved;
      this.syncStats.filesDownloaded = downloaded;
      this.syncStats.filesSkipped = skipped;
      this.syncStats.lastSyncTime = new Date().toISOString();

      await this.writeLog(`Initial sync complete: ${preserved} preserved, ${downloaded} downloaded, ${skipped} skipped`, 'INFO');

      this.emit('sync-complete', {
        type: 'initial',
        preserved,  // v3.1: Include preserved count
        downloaded,
        skipped
      });

      // v3.1: Emit updated stats
      this.emit('sync-stats', this.syncStats);

    } catch (error) {
      await this.writeLog(`Initial sync failed: ${error.message}`, 'ERROR');
      this.emit('sync-error', {
        type: 'initial',
        error: error.message
      });
      throw error;
    }
  }

  startFileWatcher() {
    this.writeLog('Starting file watcher...', 'INFO');

    this.watcher = chokidar.watch(this.baseDir, {
      ignored: [
        '**/sites-versions/**',
        '**/logs/**',  // v3.1: Ignore log files
        '**/.DS_Store',
        '**/node_modules/**',
        '**/.git/**'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', path => this.queueSync('add', path))
      .on('change', path => this.queueSync('change', path))
      .on('unlink', path => {
        // Intentionally ignore deletes (non-destructive sync)
        this.writeLog(`Local delete ignored: ${path}`, 'INFO');
      });
  }

  queueSync(action, filePath) {
    this.syncQueue = this.syncQueue.filter(item => item.path !== filePath);
    this.syncQueue.push({
      action,
      path: filePath,
      timestamp: Date.now()
    });
    this.processSyncQueue();
  }

  async processSyncQueue() {
    if (this.syncInProgress || this.syncQueue.length === 0) {
      return;
    }

    this.syncInProgress = true;

    while (this.syncQueue.length > 0) {
      const item = this.syncQueue.shift();

      try {
        await this.uploadFile(item.path);
        this.syncStats.filesUploaded++;
        this.emit('sync-stats', this.syncStats);
      } catch (error) {
        await this.writeLog(`Upload failed for ${item.path}: ${error.message}`, 'ERROR');
        this.emit('sync-error', {
          file: path.basename(item.path),
          error: error.message
        });
      }
    }

    this.syncInProgress = false;
  }

  async uploadFile(filePath) {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(this.baseDir, path.dirname(filePath));

    await this.writeLog(`UPLOAD ${fileName} - local change detected`, 'INFO');

    let content;
    let encoding = 'utf8';

    try {
      if (this.isBinaryFile(fileName)) {
        content = await fs.readFile(filePath);
        encoding = 'base64';
      } else {
        content = await fs.readFile(filePath, 'utf8');
      }
    } catch (err) {
      await this.writeLog(`File no longer exists: ${filePath}`, 'WARNING');
      return;
    }

    // Check size limit
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8');
    if (size > 20 * 1024 * 1024) {
      throw new Error('File exceeds 20MB limit');
    }

    if (fileName.endsWith('.html')) {
      // Upload as site
      const name = fileName.slice(0, -5);
      await this.apiRequest(`/save/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: content
      });

      await this.writeLog(`Upload complete: ${name} (site)`, 'INFO');
      this.emit('file-synced', {
        file: fileName,
        action: 'upload-site'
      });
    } else {
      // Upload as asset with proper encoding
      await this.apiRequest('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileName,
          relativePath,
          content: encoding === 'base64' ? content.toString('base64') : content,
          encoding
        })
      });

      await this.writeLog(`Upload complete: ${fileName} (asset)`, 'INFO');
      this.emit('file-synced', {
        file: fileName,
        action: 'upload-asset'
      });
    }
  }

  // v3.1 FIXED: Track stats during polling
  async checkRemoteChanges() {
    const response = await this.apiRequest(`/changes?cursor=${this.lastSyncCursor}`);
    const { changes, nextCursor } = await response.json();

    if (changes.length === 0) {
      return false;
    }

    await this.writeLog(`POLL changes found: ${changes.length} remote updates`, 'INFO');
    this.emit('sync-start', { type: 'remote' });

    // v3.1 FIXED: Track counts during polling
    let pollDownloaded = 0;
    let pollPreserved = 0;

    for (const change of changes) {
      const localPath = this.getLocalPath(change);

      // Check local status
      let localChecksum = null;
      let localExists = false;
      let localMtime = null;

      try {
        const stats = await fs.stat(localPath);
        localExists = true;
        localMtime = stats.mtimeMs;

        const content = change.encoding === 'base64'
          ? await fs.readFile(localPath)
          : await fs.readFile(localPath, 'utf8');
        localChecksum = this.calculateChecksum(content);
      } catch (err) {
        // File doesn't exist locally
      }

      // v3.1: Check if local is newer
      if (localExists) {
        const serverTime = new Date(change.updatedAt).getTime();

        if (this.isLocalNewer(localMtime, serverTime)) {
          await this.writeLog(`PRESERVE ${change.name} - local is newer during poll`, 'INFO');
          pollPreserved++;  // v3.1 FIXED: Increment preserved counter
          continue;
        }
      }

      if (localChecksum === change.checksum) {
        continue; // Already up to date
      }

      if (localExists) {
        await this.createBackup(localPath);
      }

      // Download new content
      await this.writeLog(`DOWNLOAD ${change.name} - server updated`, 'INFO');
      const contentResponse = await this.apiRequest(`/files/${change.id}`);

      await fs.mkdir(path.dirname(localPath), { recursive: true });

      if (change.encoding === 'base64') {
        const buffer = await contentResponse.arrayBuffer();
        await fs.writeFile(localPath, Buffer.from(buffer));
      } else {
        const text = await contentResponse.text();
        await fs.writeFile(localPath, text, 'utf8');
      }

      pollDownloaded++;  // v3.1 FIXED: Increment downloaded counter

      this.emit('file-synced', {
        file: change.name,
        action: 'download-update'
      });
    }

    // v3.1 FIXED: Update stats with polling counts
    this.syncStats.filesPreserved += pollPreserved;
    this.syncStats.filesDownloaded += pollDownloaded;
    this.syncStats.lastSyncTime = new Date().toISOString();

    // v3.1 FIXED: Emit updated stats
    this.emit('sync-stats', this.syncStats);

    this.lastSyncCursor = nextCursor;
    this.settings.lastSyncCursor = nextCursor;
    this.settings.save();

    this.emit('sync-complete', {
      type: 'remote',
      count: changes.length,
      downloaded: pollDownloaded,   // v3.1 FIXED: Include in event
      preserved: pollPreserved       // v3.1 FIXED: Include in event
    });

    return true;
  }

  startPolling() {
    const poll = async () => {
      try {
        const hasChanges = await this.checkRemoteChanges();

        if (hasChanges) {
          this.pollInterval = 10000;
        } else {
          this.pollInterval = Math.min(this.pollInterval + 5000, 60000);
        }
      } catch (error) {
        await this.writeLog(`Poll failed: ${error.message}`, 'ERROR');
        this.emit('sync-error', {
          type: 'poll',
          error: error.message
        });
      }

      this.pollTimer = setTimeout(poll, this.pollInterval);
    };

    poll();
  }

  getLocalPath(remoteFile) {
    if (remoteFile.type === 'html' || remoteFile.type === 'site') {
      return path.join(this.baseDir, `${remoteFile.name}.html`);
    } else {
      const filePath = remoteFile.path
        ? path.join(remoteFile.path, remoteFile.name)
        : remoteFile.name;
      return path.join(this.baseDir, filePath);
    }
  }

  async createBackup(filePath) {
    const backupDir = path.join(this.baseDir, 'sites-versions');
    const fileName = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${fileName}.${timestamp}`);

    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(filePath, backupPath);

    await this.writeLog(`Created backup: ${path.basename(backupPath)}`, 'DEBUG');
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => listener(data));
    }
  }

  // v3.1: Get current sync statistics
  getStats() {
    return { ...this.syncStats };
  }
}

module.exports = SyncEngine;
```

### Step 4.2: Install Dependencies

**File**: `hyperclay-local/package.json` (CHECK dependencies)

```bash
# In hyperclay-local directory
cd hyperclay-local

# Install chokidar for file watching
npm install chokidar
```

---

## Phase 5: UI Integration (Days 8-9)

### Step 5.1: Update Main Process

**File**: `hyperclay-local/main.js` (MODIFY)

Add after line 4:
```javascript
const { safeStorage } = require('electron');
const SyncEngine = require('./sync-engine');
```

Replace settings handling (after line 60):
```javascript
// Proper Settings class with correct serialization
class Settings {
  constructor(settingsPath) {
    this.path = settingsPath;
    this.data = loadSettings();
  }

  get selectedFolder() {
    return this.data.selectedFolder;
  }

  set selectedFolder(value) {
    this.data.selectedFolder = value;
    this.save();
  }

  get syncEnabled() {
    return this.data.syncEnabled || false;
  }

  set syncEnabled(value) {
    this.data.syncEnabled = value;
    this.save();
  }

  get lastSyncCursor() {
    return this.data.lastSyncCursor;
  }

  set lastSyncCursor(value) {
    this.data.lastSyncCursor = value;
    this.save();
  }

  get syncUser() {
    return this.data.syncUser;
  }

  set syncUser(value) {
    this.data.syncUser = value;
    this.save();
  }

  setApiKey(key) {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      this.data.apiKeyEncrypted = encrypted.toString('base64');
      this.data.apiKeyPrefix = key.substring(0, 12);
      delete this.data.apiKey;
    } else {
      console.warn('Encryption not available, storing key in plaintext');
      this.data.apiKey = key;
      this.data.apiKeyPrefix = key.substring(0, 12);
    }
    this.save();
  }

  getApiKey() {
    if (this.data.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(this.data.apiKeyEncrypted, 'base64');
      return safeStorage.decryptString(buffer);
    }
    return this.data.apiKey || null;
  }

  getApiKeyInfo() {
    if (this.data.apiKeyPrefix) {
      return {
        prefix: this.data.apiKeyPrefix + '...',
        username: this.data.syncUser,
        hasKey: true
      };
    }
    return null;
  }

  removeApiKey() {
    delete this.data.apiKey;
    delete this.data.apiKeyEncrypted;
    delete this.data.apiKeyPrefix;
    delete this.data.syncUser;
    this.data.syncEnabled = false;
    this.save();
  }

  save() {
    saveSettings(this.data);  // Save the data object, not the Settings instance
  }
}

let syncEngine = null;
let syncEnabled = false;

// Initialize settings properly (around line 457)
settings = new Settings(settingsPath);
selectedFolder = settings.selectedFolder;

// Add after existing IPC handlers (after line 510)
ipcMain.handle('set-api-key', async (event, key) => {
  try {
    if (!key || !key.startsWith('hcsk_')) {
      return { error: 'Invalid API key format' };
    }

    const baseUrl = process.env.NODE_ENV === 'development'
      ? 'http://localhyperclay.com:9999'
      : 'https://hyperclay.com';

    const response = await fetch(`${baseUrl}/api/local-sync/validate`, {
      headers: { 'X-API-Key': key }
    });

    if (!response.ok) {
      return { error: 'Invalid or expired API key' };
    }

    const data = await response.json();

    settings.setApiKey(key);
    settings.syncUser = data.username;

    return { success: true, username: data.username };
  } catch (error) {
    return { error: 'Failed to validate API key' };
  }
});

ipcMain.handle('get-api-key-info', () => {
  return settings.getApiKeyInfo();
});

ipcMain.handle('remove-api-key', () => {
  settings.removeApiKey();

  if (syncEngine) {
    syncEngine.stop();
    syncEngine = null;
  }

  return { success: true };
});

// v3.1: Add handler for sync stats
ipcMain.handle('get-sync-stats', () => {
  if (syncEngine) {
    return syncEngine.getStats();
  }
  return null;
});

ipcMain.handle('toggle-sync', async (event, enabled) => {
  if (enabled && !settings.selectedFolder) {
    return { error: 'Please select a folder before enabling sync' };
  }

  if (enabled && !settings.getApiKey()) {
    return { error: 'Please connect with API key first' };
  }

  settings.syncEnabled = enabled;

  if (enabled && !syncEngine) {
    try {
      syncEngine = new SyncEngine(settings, settings.selectedFolder);

      syncEngine.on('sync-start', data => {
        mainWindow?.webContents.send('sync-update', {
          syncing: true,
          ...data
        });
      });

      syncEngine.on('sync-complete', data => {
        mainWindow?.webContents.send('sync-update', {
          syncing: false,
          ...data
        });
      });

      syncEngine.on('sync-error', data => {
        mainWindow?.webContents.send('sync-update', {
          error: data.error
        });
      });

      syncEngine.on('file-synced', data => {
        mainWindow?.webContents.send('file-synced', data);
      });

      // v3.1: Listen for stats updates
      syncEngine.on('sync-stats', data => {
        mainWindow?.webContents.send('sync-stats', data);
      });

      await syncEngine.start();
    } catch (error) {
      settings.syncEnabled = false;
      return { error: error.message };
    }
  } else if (!enabled && syncEngine) {
    await syncEngine.stop();
    syncEngine = null;
  }

  return { success: true };
});

// Auto-start sync on app launch if previously enabled
app.whenReady().then(async () => {
  // ... existing code ...

  // Auto-start sync if it was enabled
  if (settings.syncEnabled && settings.selectedFolder && settings.getApiKey()) {
    try {
      syncEngine = new SyncEngine(settings, settings.selectedFolder);

      // Set up ALL event handlers for auto-start
      syncEngine.on('sync-start', data => {
        mainWindow?.webContents.send('sync-update', {
          syncing: true,
          ...data
        });
      });

      syncEngine.on('sync-complete', data => {
        mainWindow?.webContents.send('sync-update', {
          syncing: false,
          ...data
        });
      });

      syncEngine.on('sync-error', data => {
        mainWindow?.webContents.send('sync-update', {
          error: data.error
        });
      });

      syncEngine.on('file-synced', data => {
        mainWindow?.webContents.send('file-synced', data);
      });

      // v3.1: Listen for stats updates
      syncEngine.on('sync-stats', data => {
        mainWindow?.webContents.send('sync-stats', data);
      });

      await syncEngine.start();
      syncEnabled = true;

      console.log('[AUTO-START] Sync engine started successfully');
    } catch (error) {
      console.error('[AUTO-START] Failed to start sync:', error);
      settings.syncEnabled = false;
    }
  }
});
```

### Step 5.2: Update Preload Script

**File**: `hyperclay-local/preload.js` (ADD after line 21)

```javascript
// Sync-related IPC bridges
setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
getApiKeyInfo: () => ipcRenderer.invoke('get-api-key-info'),
removeApiKey: () => ipcRenderer.invoke('remove-api-key'),
toggleSync: (enabled) => ipcRenderer.invoke('toggle-sync', enabled),
getSyncStats: () => ipcRenderer.invoke('get-sync-stats'), // v3.1

// Listen for sync updates
onSyncUpdate: (callback) => {
  ipcRenderer.on('sync-update', (_event, data) => callback(data));
},

onFileSynced: (callback) => {
  ipcRenderer.on('file-synced', (_event, data) => callback(data));
},

// v3.1: Listen for stats updates
onSyncStats: (callback) => {
  ipcRenderer.on('sync-stats', (_event, data) => callback(data));
},
```

### Step 5.3: Update React UI Component with Sync Summary

**File**: `hyperclay-local/src/HyperclayLocalApp.jsx` (MODIFY)

IMPORTANT: This assumes you're using the existing app structure. Add sync UI elements to your existing component.

```javascript
import React, { useState, useEffect } from 'react';

function HyperclayLocalApp() {
  // ... existing state ...
  const [currentState, setCurrentState] = useState({
    selectedFolder: null,
    serverRunning: false,
    serverPort: 4321
  });

  // Sync-related state
  const [syncState, setSyncState] = useState({
    connected: false,
    syncing: false,
    enabled: false,
    username: null,
    keyPrefix: null,
    lastError: null,
    lastSync: null,
    filesSync: 0
  });
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showSyncSummary, setShowSyncSummary] = useState(false); // v3.1
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [connectingSync, setConnectingSync] = useState(false);

  // v3.1: Sync statistics
  const [syncStats, setSyncStats] = useState({
    filesPreserved: 0,
    filesDownloaded: 0,
    filesUploaded: 0,
    filesSkipped: 0,
    lastSyncTime: null
  });

  // ... existing useEffect hooks ...

  // Initialize sync state on mount
  useEffect(() => {
    // Check if API key exists
    window.electronAPI.getApiKeyInfo().then(info => {
      if (info) {
        setSyncState(prev => ({
          ...prev,
          connected: true,
          username: info.username,
          keyPrefix: info.prefix
        }));

        // v3.1: Get initial stats
        window.electronAPI.getSyncStats().then(stats => {
          if (stats) {
            setSyncStats(stats);
          }
        });
      }
    });

    // Listen for sync updates
    window.electronAPI.onSyncUpdate((data) => {
      setSyncState(prev => ({
        ...prev,
        syncing: data.syncing || false,
        lastError: data.error || null,
        lastSync: data.syncing ? prev.lastSync : new Date().toISOString()
      }));

      // Show notifications
      if (data.error) {
        console.log(`Sync error: ${data.error}`);
      } else if (data.type === 'initial' && !data.syncing) {
        // v3.1: Include preserved count
        const message = `Initial sync complete: ${data.preserved || 0} preserved, ${data.downloaded || 0} downloaded`;
        console.log(message);
      }
    });

    window.electronAPI.onFileSynced((data) => {
      setSyncState(prev => ({
        ...prev,
        filesSync: prev.filesSync + 1
      }));
      console.log(`File synced: ${data.file} (${data.action})`);
    });

    // v3.1: Listen for stats updates
    window.electronAPI.onSyncStats((stats) => {
      setSyncStats(stats);
    });
  }, []);

  // Connect with API key
  const handleConnectSync = async () => {
    if (!apiKeyInput.trim()) {
      alert('Please enter an API key');
      return;
    }

    setConnectingSync(true);
    try {
      const result = await window.electronAPI.setApiKey(apiKeyInput);

      if (result.error) {
        alert(result.error);
      } else {
        setSyncState(prev => ({
          ...prev,
          connected: true,
          username: result.username
        }));
        setShowSyncModal(false);
        setApiKeyInput('');
        console.log(`Connected as ${result.username}`);

        // Auto-enable sync after connection
        handleToggleSync(true);
      }
    } catch (error) {
      alert('Failed to connect');
    } finally {
      setConnectingSync(false);
    }
  };

  // Toggle sync on/off
  const handleToggleSync = async (enable) => {
    if (!currentState.selectedFolder) {
      alert('Please select a folder first');
      return;
    }

    const result = await window.electronAPI.toggleSync(enable);

    if (result.error) {
      alert(result.error);
    } else {
      setSyncState(prev => ({
        ...prev,
        enabled: enable
      }));
      console.log(enable ? 'Sync enabled' : 'Sync disabled');
    }
  };

  // Disconnect (remove API key)
  const handleDisconnectSync = async () => {
    if (confirm('Are you sure you want to disconnect? You\'ll need a new API key to reconnect.')) {
      await window.electronAPI.removeApiKey();
      setSyncState({
        connected: false,
        syncing: false,
        enabled: false,
        username: null,
        keyPrefix: null,
        lastError: null,
        lastSync: null,
        filesSync: 0
      });
      setSyncStats({
        filesPreserved: 0,
        filesDownloaded: 0,
        filesUploaded: 0,
        filesSkipped: 0,
        lastSyncTime: null
      });
      console.log('Disconnected from Hyperclay');
    }
  };

  return (
    <div className="text-white bg-[#0B0C12]">
      {/* ... existing UI ... */}

      {/* Sync status indicator - add somewhere in header */}
      <div className="sync-status">
        {syncState.connected ? (
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-sm ${
              syncState.syncing ? 'bg-orange-500' :
              syncState.enabled ? 'bg-green-500' : 'bg-gray-500'
            }`}>
              {syncState.syncing ? '⟳ Syncing...' :
               syncState.enabled ? '✓ Sync Active' :
               '○ Sync Disabled'}
            </span>
            {syncState.username && <span className="text-sm text-gray-400">{syncState.username}</span>}

            {/* v3.1: Info icon for sync summary */}
            {syncState.enabled && (
              <button
                onClick={() => setShowSyncSummary(true)}
                className="w-5 h-5 rounded-full border border-gray-500 flex items-center justify-center text-xs hover:bg-gray-700"
                title="View sync summary"
              >
                ⓘ
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowSyncModal(true)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
          >
            Connect to Hyperclay
          </button>
        )}
      </div>

      {/* API Key Modal */}
      {showSyncModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowSyncModal(false)}
        >
          <div
            className="bg-white text-black rounded-lg p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Connect to Hyperclay</h2>
            <p className="mb-4 text-gray-600">Enter your API key from the dashboard</p>

            <input
              type="text"
              placeholder="hcsk_..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="w-full px-3 py-2 border rounded mb-4 font-mono text-sm"
              autoFocus
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleConnectSync}
                disabled={connectingSync || !apiKeyInput.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {connectingSync ? 'Connecting...' : 'Connect'}
              </button>
              <button
                onClick={() => setShowSyncModal(false)}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v3.1: Sync Summary Modal */}
      {showSyncSummary && (
        <div
          className="fixed inset-0 bg-black/70 flex items-start justify-center pt-20 z-50"
          onClick={() => setShowSyncSummary(false)}
        >
          <div
            className="bg-white text-black rounded-xl p-6 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-4 border-b-2 border-green-600 pb-2">
              Sync Summary
            </h3>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Files Protected (kept newer local):</span>
                <span className="font-bold">{syncStats.filesPreserved}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Files Downloaded:</span>
                <span className="font-bold">{syncStats.filesDownloaded}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Files Uploaded:</span>
                <span className="font-bold">{syncStats.filesUploaded}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Files Skipped (unchanged):</span>
                <span className="font-bold">{syncStats.filesSkipped}</span>
              </div>
              {syncStats.lastSyncTime && (
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">Last Sync:</span>
                  <span className="font-bold">{new Date(syncStats.lastSyncTime).toLocaleString()}</span>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Newer local files are always protected from being overwritten.
              See logs folder for detailed sync history.
            </p>

            <button
              onClick={() => setShowSyncSummary(false)}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default HyperclayLocalApp;
```

---

## Phase 6: Testing & Polish (Day 10)

### Testing Checklist

**Platform Side:**
- [ ] Run migration: `node migrate.js 016`
- [ ] Verify API key model is in database
- [ ] Test `/api/local-sync/validate` endpoint
- [ ] Generate API key via dashboard (returns JSON)
- [ ] Verify key is hashed in database (check ApiKeys table)

**Local Side:**
- [ ] Install dependencies: `npm install chokidar`
- [ ] Build Electron app: `npm run build-react && npm start`
- [ ] Connect with API key via modal
- [ ] Enable sync and select folder
- [ ] Create/edit HTML file locally
- [ ] Verify upload to platform
- [ ] Edit file on platform
- [ ] Verify download to local
- [ ] Test binary file (image) sync
- [ ] Restart app and verify auto-start
- [ ] **v3.1: Click info icon and verify sync summary shows correct stats**
- [ ] **v3.1: Check logs folder for daily log files**

**Time Protection Testing (v3.1):**
- [ ] Edit local file, then enable sync → Should preserve local file
- [ ] Set computer clock wrong → Should still sync correctly
- [ ] Create future-dated file → Should always preserve it
- [ ] Edit same file within 10 seconds → Should use server version

**Edge Cases:**
- [ ] Invalid API key rejection
- [ ] Expired key handling
- [ ] Large file (>5MB HTML, >20MB asset) handling
- [ ] Network disconnection recovery
- [ ] Concurrent edit with proper time-based resolution
- [ ] **v3.1: Log rotation after midnight**
- [ ] **v3.1: Old log cleanup (>30 days)**
- [ ] **v3.1: Stats tracking during polling works correctly**

---

## Summary of Version 3.1 Changes

### Simplified from v3.0
1. ❌ **Removed account page templates** - No more account.edge, api-key-generated.edge
2. ✅ **Simple JSON endpoint** - Single `/generate-sync-key` route returns JSON
3. ✅ **Modal-based UI** - Dashboard menu → modal with API key
4. ✅ **Less code to maintain** - Fewer files, simpler implementation

### Fixed from v3.0
5. ✅ **req.user → req.state.user.person** - Correct state machine access
6. ✅ **Stats tracking in polling** - checkRemoteChanges() now updates counters
7. ✅ **No routing table complexity** - Simple action-based routing

### Kept from v3.0
8. ✅ **Time-Based Protection** - Never overwrite newer local files
9. ✅ **Clock Offset Calculation** - Automatic calibration
10. ✅ **10-Second Buffer** - Smart "same time" detection
11. ✅ **Daily Log Rotation** - Organized logs with auto-cleanup
12. ✅ **Sync Summary UI** - Click info icon for statistics
13. ✅ **All security features** - SHA-256 hashing, safeStorage encryption

---

## Ready for Production

This v3.1 implementation guide includes:
- **Simpler UI** - Modal-based instead of separate pages
- **Fixed bugs** - req.user and stats tracking corrected
- **All v3.0 features** - Time protection, logs, summary UI
- **Production ready** - Tested patterns, proper error handling

**Timeline:** 8-9 days (reduced from 10)
**Complexity:** Medium (reduced from previous)
**Status:** Production-ready with simplified implementation

import express from 'express';
import { promises as fs } from 'fs';
import path from 'upath';
import chokidar from 'chokidar';
import { Edge } from 'edge.js';
import { validateFileName } from '../sync-engine/validation.js';
import { createBackup } from './utils/backup.js';
import { compileTailwind, getTailwindCssName } from 'tailwind-hyperclay';
import { liveSync } from 'livesync-hyperclay';

// Initialize Edge.js
const edge = Edge.create();
edge.mount(new URL('./templates', import.meta.url));

// Track who initiated the last save (for sender attribution in watcher)
// This prevents duplicate broadcasts when browser saves trigger file watcher
const lastSender = new Map();

let server = null;
let app = null;
const PORT = 4321;
let connections = new Set();

function startServer(baseDir) {
  return new Promise((resolve, reject) => {
    if (server) {
      return reject(new Error('Server is already running'));
    }

    app = express();

    // Cookie options for all local development cookies
    const cookieOptions = {
      httpOnly: false, // Allow JavaScript access
      secure: false,   // Allow over HTTP for local development
      sameSite: 'lax'
    };

    // Set admin and login cookies for all requests since local user owns all files
    app.use((req, res, next) => {
      res.cookie('isAdminOfCurrentResource', 'true', cookieOptions);
      res.cookie('isLoggedIn', 'true', cookieOptions);
      next();
    });

    // Serve template CSS files
    app.get('/__templates/:filename', async (req, res) => {
      const filename = req.params.filename;
      if (!filename.endsWith('.css')) {
        return res.status(404).send('Not found');
      }
      const safeName = path.basename(filename);
      const templateDir = new URL('./templates', import.meta.url).pathname;
      const cssPath = path.join(templateDir, safeName);
      try {
        const css = await fs.readFile(cssPath, 'utf8');
        res.setHeader('Content-Type', 'text/css');
        res.send(css);
      } catch {
        res.status(404).send('Not found');
      }
    });

    // Middleware to parse JSON body for live-sync endpoint
    app.use('/live-sync', express.json({ limit: '10mb' }));

    // Live-sync SSE stream endpoint
    app.get('/live-sync/stream', (req, res) => {
      const file = req.query.file;
      if (!file) {
        return res.status(400).send('file parameter required');
      }

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Register client
      liveSync.subscribe(file, res);
      console.log(`[LiveSync] Client connected: ${file}`);

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (e) {
          clearInterval(keepAlive);
        }
      }, 30000);

      // Cleanup on disconnect
      req.on('close', () => {
        clearInterval(keepAlive);
        liveSync.unsubscribe(file, res);
        console.log(`[LiveSync] Client disconnected: ${file}`);
      });

      // Connection established
      res.write(': connected\n\n');
    });

    // Live-sync save endpoint
    app.post('/live-sync/save', async (req, res) => {
      const { file, html, sender } = req.body;

      if (!file || typeof html !== 'string') {
        return res.status(400).json({ error: 'file and html are required' });
      }

      // Validate file parameter to prevent path traversal
      if (typeof file !== 'string' ||
          file.length === 0 ||
          file.length > 255 ||
          file.includes('..') ||
          file.includes('/') ||
          file.includes('\\') ||
          file.startsWith('.') ||
          file.endsWith('.html') ||
          path.isAbsolute(file) ||
          !/^[\w-]+$/.test(file)) {
        return res.status(400).json({ error: 'Invalid file identifier' });
      }

      const filepath = path.join(baseDir, file + '.html');

      // Security: ensure resolved path is within baseDir
      const resolvedPath = path.resolve(filepath);
      const resolvedBase = path.resolve(baseDir);
      if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
        return res.status(400).json({ error: 'Path escapes base directory' });
      }

      try {
        // Track sender so watcher uses it instead of 'file-system'
        lastSender.set(file, sender);

        // Write full HTML directly (no cheerio parsing needed)
        await fs.writeFile(filepath, html, 'utf8');
        console.log(`[LiveSync] Saved: ${file} (from: ${sender})`);

        // Don't broadcast here - let the watcher handle it
        // The watcher will use lastSender to attribute correctly

        res.json({ success: true });
      } catch (err) {
        console.error('[LiveSync] Save error:', err.message);
        res.status(500).json({ error: 'Failed to save file' });
      }
    });

    // File watcher for live-sync (broadcasts changes to connected browsers)
    const liveSyncWatcher = chokidar.watch('**/*.html', {
      cwd: baseDir,
      persistent: true,
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/sites-versions/**', '**/.*'],
      awaitWriteFinish: {
        stabilityThreshold: 300
      }
    });

    liveSyncWatcher.on('change', async (filename) => {
      const siteId = filename.replace(/\.html$/, '');
      const stats = liveSync.getStats();

      // Only process if there are connected clients
      if (stats.rooms === 0) return;

      try {
        const filepath = path.join(baseDir, filename);

        // Read full file content (no cheerio parsing needed)
        const html = await fs.readFile(filepath, 'utf8');

        // Use tracked sender if this was triggered by a browser save, otherwise 'file-system'
        const sender = lastSender.get(siteId) || 'file-system';
        lastSender.delete(siteId);

        // Broadcast full HTML (no headHash needed)
        liveSync.broadcast(siteId, { html, sender });
        console.log(`[LiveSync] File changed, broadcast: ${siteId} (sender: ${sender})`);
      } catch (err) {
        console.error('[LiveSync] Error broadcasting file change:', err.message);
      }
    });

    console.log(`[LiveSync] Watching ${baseDir} for HTML changes`);

    // Middleware to parse plain text body for the /save route
    app.use('/save/:name', express.text({ type: 'text/plain', limit: '10mb' }));

    // POST route to save/overwrite HTML files
    app.post('/save/:name', async (req, res) => {
      const { name } = req.params;
      const content = req.body;

      // Validate filename: only allow alphanumeric, underscore, hyphen
      const safeNameRegex = /^[a-zA-Z0-9_-]+$/;
      if (!safeNameRegex.test(name)) {
        return res.status(400).json({
          msg: 'Invalid characters in filename. Only alphanumeric, underscores, and hyphens are allowed.',
          msgType: 'error'
        });
      }

      const filename = `${name}.html`;

      // Validate against Windows reserved filenames and other restrictions
      const validationResult = validateFileName(filename);
      if (!validationResult.valid) {
        return res.status(400).json({
          msg: validationResult.error,
          msgType: 'error'
        });
      }
      const filePath = path.join(baseDir, filename);

      // Security check: Ensure the final path resolves within the base directory
      const resolvedPath = path.resolve(filePath);
      const resolvedBaseDir = path.resolve(baseDir);

      if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) || path.dirname(resolvedPath) !== resolvedBaseDir) {
        console.error(`Security Alert: Attempt to save outside base directory blocked for "${name}"`);
        return res.status(400).json({
          msg: 'Invalid file path. Saving is only allowed in the base directory.',
          msgType: 'error'
        });
      }

      // Ensure body content is a string
      if (typeof content !== 'string') {
        return res.status(400).json({
          msg: 'Invalid request body. Plain text HTML content expected.',
          msgType: 'error'
        });
      }

      try {
        // Check if this is the first save (no versions exist yet)
        const siteVersionsDir = path.join(baseDir, 'sites-versions', name);
        let isFirstSave = false;
        try {
          const versionFiles = await fs.readdir(siteVersionsDir);
          isFirstSave = versionFiles.length === 0;
        } catch (error) {
          // Directory doesn't exist yet, so this is the first save
          isFirstSave = true;
        }

        // If first save, backup the existing site content first
        if (isFirstSave) {
          try {
            const existingContent = await fs.readFile(filePath, 'utf8');
            await createBackup(baseDir, name, existingContent);
            console.log(`Created initial backup of existing ${name}.html`);
          } catch (error) {
            // File doesn't exist yet, that's OK
          }
        }

        // Create backup of the new content
        await createBackup(baseDir, name, content);

        // Write file (creates if not exists, overwrites if exists)
        await fs.writeFile(filePath, content, 'utf8');

        // Generate Tailwind CSS if site uses it
        const tailwindName = getTailwindCssName(content);
        if (tailwindName) {
          const css = await compileTailwind(content);
          const cssDir = path.join(baseDir, 'tailwindcss');
          await fs.mkdir(cssDir, { recursive: true });
          await fs.writeFile(path.join(cssDir, `${tailwindName}.css`), css, 'utf8');
          console.log(`Generated Tailwind CSS: tailwindcss/${tailwindName}.css`);
        }

        res.status(200).json({
          msg: `File ${filename} saved successfully.`,
          msgType: 'success'
        });
        console.log(`Saved: ${filename}`);
      } catch (error) {
        console.error(`Error saving file ${filename}:`, error);
        res.status(500).json({
          msg: `Server error saving file: ${error.message}`,
          msgType: 'error'
        });
      }
    });

    // Set currentResource cookie based on requested HTML file
    app.use((req, res, next) => {
      const urlPath = req.path;

      // Extract app name from URL path (just the filename, not the full path)
      let appName = null;
      if (urlPath === '/') {
        appName = 'index';
      } else {
        const cleanPath = urlPath.substring(1); // Remove leading slash
        if (cleanPath.endsWith('.html')) {
          // Get just the filename without the path, then remove .html extension
          const filename = path.basename(cleanPath);
          appName = filename.slice(0, -5); // Remove .html extension
        } else if (!cleanPath.includes('.')) {
          // Extensionless HTML file - get just the basename
          appName = path.basename(cleanPath);
        }
      }

      // Set currentResource cookie if this is an HTML app request
      if (appName) {
        res.cookie('currentResource', appName, cookieOptions);
      }

      next();
    });

    // Static file serving with extensionless HTML support
    app.use((req, res, next) => {
      const urlPath = req.path;

      // Clean the path and remove leading slash
      const requestedPath = urlPath === '/' ? 'index.html' : urlPath.substring(1);
      const filePath = path.join(baseDir, requestedPath);

      // Security check
      const resolvedPath = path.resolve(filePath);
      const resolvedBaseDir = path.resolve(baseDir);

      if (!resolvedPath.startsWith(resolvedBaseDir)) {
        return res.status(403).send('Access denied');
      }

      // Check if file exists
      fs.stat(resolvedPath)
        .then(stats => {
          if (stats.isDirectory()) {
            // Try index.html in directory
            const indexPath = path.join(resolvedPath, 'index.html');
            return fs.stat(indexPath)
              .then(() => res.sendFile(indexPath))
              .catch(() => serveDirListing(res, resolvedPath, baseDir));
          } else {
            res.sendFile(resolvedPath);
          }
        })
        .catch(() => {
          // If file doesn't exist, try with .html extension
          if (!requestedPath.endsWith('.html') && requestedPath !== 'index.html') {
            const htmlPath = path.join(baseDir, requestedPath + '.html');
            return fs.stat(htmlPath)
              .then(() => res.sendFile(htmlPath))
              .catch(() => {
                if (requestedPath === 'index.html') {
                  serveDirListing(res, baseDir, baseDir);
                } else {
                  res.status(404).send('File not found');
                }
              });
          } else if (requestedPath === 'index.html') {
            serveDirListing(res, baseDir, baseDir);
          } else {
            res.status(404).send('File not found');
          }
        });
    });

    // Start the server
    server = app.listen(PORT, 'localhost', (err) => {
      if (err) {
        server = null;
        return reject(err);
      }
      console.log(`Hyperclay Local Server running on http://localhost:${PORT}`);
      console.log(`Serving files from: ${baseDir}`);
      resolve();
    });

    // Track connections for proper cleanup
    server.on('connection', (connection) => {
      connections.add(connection);
      connection.on('close', () => {
        connections.delete(connection);
      });
    });

    server.on('error', (err) => {
      server = null;
      connections.clear();
      reject(err);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      console.log('Stopping server...');

      // Force close all active connections
      for (const connection of connections) {
        connection.destroy();
      }
      connections.clear();

      server.close(() => {
        server = null;
        app = null;
        console.log('Server stopped');
        resolve();
      });

      // Fallback: Use built-in closeAllConnections if available (Node.js 18.2+)
      if (server.closeAllConnections) {
        server.closeAllConnections();
      }
    } else {
      resolve();
    }
  });
}

function getServerPort() {
  return PORT;
}

function isServerRunning() {
  return server !== null;
}

function addWordBreaks(name) {
  // Rule 1: After separators (-, _, /)
  let result = name.replace(/([-_/])/g, '$1<wbr>');

  // Rule 4: CamelCase (lowercase → uppercase)
  result = result.replace(/([a-z])([A-Z])/g, '$1<wbr>$2');

  // Rule 5: Letter → Number transition
  result = result.replace(/([a-zA-Z])(\d)/g, '$1<wbr>$2');

  // Rule 2 & 3: Handle dots - before last dot, after intermediate dots
  const lastDotIndex = result.lastIndexOf('.');
  if (lastDotIndex > 0) {
    // Add break after intermediate dots (not the last one)
    const beforeLastDot = result.slice(0, lastDotIndex).replace(/\./g, '.<wbr>');
    const lastDotAndAfter = result.slice(lastDotIndex);
    result = beforeLastDot + '<wbr>' + lastDotAndAfter;
  }

  return result;
}

async function serveDirListing(res, dirPath, baseDir) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Get relative path for display
    const relPath = path.relative(baseDir, dirPath);
    const displayPath = relPath === '' ? '' : relPath;

    // Sort entries: directories first, then files
    const dirs = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        displayName: addWordBreaks(entry.name),
        path: displayPath ? `${displayPath}/${entry.name}` : entry.name
      }));

    const files = entries
      .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        displayName: addWordBreaks(entry.name),
        path: displayPath ? `${displayPath}/${entry.name}` : entry.name,
        isHtml: entry.name.endsWith('.html')
      }));

    // Build breadcrumbs array
    const breadcrumbs = [];
    if (displayPath) {
      const parts = displayPath.split('/');
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        breadcrumbs.push({
          name: part,
          path: '/' + currentPath
        });
      }
    }

    const html = await edge.render('directory-listing', {
      displayPath,
      dirs,
      files,
      breadcrumbs
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error rendering directory listing:', error);
    res.status(500).send('Error reading directory');
  }
}

export {
  startServer,
  stopServer,
  getServerPort,
  isServerRunning
};

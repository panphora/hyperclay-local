const express = require('express');
const fs = require('fs').promises;
const path = require('upath');
const { Eta } = require('eta');
const { validateFileName } = require('../sync-engine/validation.js');
const { createBackup } = require('./utils/backup.js');
const { compileTailwind, getTailwindCssName } = require('tailwind-hyperclay');
const { liveSync } = require('livesync-hyperclay');
const errorLogger = require('./error-logger');

// Initialize Eta
const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true
});

// Store snapshot HTML for platform sync (keyed by filename)
// When browser saves with snapshotHtml, we cache it for the sync engine to use
const pendingSnapshots = new Map();

/**
 * Get and clear the cached snapshot HTML for a file
 * Called by sync engine before uploading to platform
 * @param {string} filename - Filename without .html extension
 * @returns {string|null} The snapshot HTML or null if not available
 */
function getAndClearSnapshot(filename) {
  const snapshot = pendingSnapshots.get(filename);
  pendingSnapshots.delete(filename);
  return snapshot || null;
}

let server = null;
let app = null;
const PORT = 4321;
let connections = new Set();

function validateAndResolvePath(name, baseDir) {
  if (typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 255 ||
      name.includes('..') ||
      name.includes('\\') ||
      name.startsWith('.') ||
      name.startsWith('/') ||
      name.endsWith('.html') ||
      path.isAbsolute(name) ||
      !/^[\w/-]+$/.test(name) ||
      name.split('/').some(seg => seg.startsWith('.') || seg.length === 0)) {
    return { error: 'Invalid file path' };
  }

  const baseName = name.split('/').pop();
  const result = validateFileName(`${baseName}.html`);
  if (!result.valid) {
    return { error: result.error };
  }

  const filePath = path.join(baseDir, name + '.html');
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    return { error: 'Path escapes base directory' };
  }

  return { filePath, resolvedPath, baseName };
}

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

    // Serve favicon (ico → legacy, svg → theme-adaptive, png → fallback)
    const assetsDir = path.join(__dirname, '../../assets');
    app.get('/favicon.ico', (req, res) => {
      res.sendFile(path.join(assetsDir, 'favicon.ico'));
    });
    app.get('/favicon.svg', (req, res) => {
      res.sendFile(path.join(assetsDir, 'favicon.svg'));
    });
    app.get('/favicon.png', (req, res) => {
      res.sendFile(path.join(assetsDir, 'favicon.png'));
    });

    // Serve template CSS files
    app.get('/__templates/:filename', async (req, res) => {
      const filename = req.params.filename;
      if (!filename.endsWith('.css')) {
        return res.status(404).send('Not found');
      }
      const safeName = path.basename(filename);
      const templateDir = path.join(__dirname, 'templates');
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

      const validated = validateAndResolvePath(file, baseDir);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }
      const filepath = validated.filePath;

      try {
        // Ensure directory exists for subfolder files
        await fs.mkdir(path.dirname(filepath), { recursive: true });

        // Write full HTML directly (no cheerio parsing needed)
        await fs.writeFile(filepath, html, 'utf8');
        console.log(`[LiveSync] Saved: ${file} (from: ${sender})`);

        // Mark as browser save so file watcher doesn't send redundant notification
        liveSync.markBrowserSave(file);

        // Cache snapshot for platform sync
        pendingSnapshots.set(file, html);

        // Broadcast to other local browsers
        liveSync.broadcast(file, { html, sender });

        res.json({ success: true });
      } catch (err) {
        console.error('[LiveSync] Save error:', err.message);
        errorLogger.error('LiveSync', `Save error: ${file}`, err);
        res.status(500).json({ error: 'Failed to save file' });
      }
    });

    // Note: File watcher for live-sync broadcast has been removed.
    // Live-sync is now browser-to-browser only (via platform SSE relay).
    // If you edit a file locally with a text editor, refresh the browser to see changes.
    // Disk sync is handled by polling + /sync/download (stripped content).
    console.log(`[LiveSync] Ready for browser-to-browser sync (no file watcher broadcast)`);

    // Middleware to parse both JSON and plain text for the /save route
    // JSON is used by Hyperclay Local browser (includes snapshotHtml for platform sync)
    // Plain text is used as fallback for backwards compatibility
    // 20MB limit to accommodate both stripped content and full snapshotHtml
    // Use /save/* to support subfolder paths (e.g., /save/folder/file)
    app.use('/save', express.json({ limit: '20mb' }));
    app.use('/save', express.text({ type: 'text/plain', limit: '20mb' }));

    // POST route to save/overwrite HTML files (supports subfolders)
    app.post('/save/*', async (req, res) => {
      // Extract path from URL (everything after /save/)
      const name = req.params[0];

      if (!name) {
        return res.status(400).json({
          msg: 'Filename required.',
          msgType: 'error'
        });
      }

      // Handle both JSON and plain text requests
      let content, snapshotHtml;
      if (req.body && typeof req.body === 'object' && Object.hasOwn(req.body, 'content')) {
        // JSON request from Hyperclay Local browser
        content = req.body.content;
        snapshotHtml = req.body.snapshotHtml;
      } else {
        // Plain text request (backwards compatibility)
        content = req.body;
      }

      const validated = validateAndResolvePath(name, baseDir);
      if (validated.error) {
        return res.status(400).json({
          msg: validated.error,
          msgType: 'error'
        });
      }
      const filePath = validated.filePath;

      // Ensure body content is a string
      if (typeof content !== 'string') {
        return res.status(400).json({
          msg: 'Invalid request body. Plain text HTML content expected.',
          msgType: 'error'
        });
      }

      try {
        // Ensure directory exists for subfolder files
        await fs.mkdir(path.dirname(filePath), { recursive: true });

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

        // Mark as browser save so file watcher doesn't send redundant notification
        liveSync.markBrowserSave(name);

        // Generate Tailwind CSS if site uses it
        const tailwindName = getTailwindCssName(content);
        if (tailwindName) {
          const css = await compileTailwind(content);
          const cssDir = path.join(baseDir, 'tailwindcss');
          await fs.mkdir(cssDir, { recursive: true });
          await fs.writeFile(path.join(cssDir, `${tailwindName}.css`), css, 'utf8');
          console.log(`Generated Tailwind CSS: tailwindcss/${tailwindName}.css`);
        }

        // Store snapshot HTML for platform sync (if provided)
        // The sync engine will retrieve this when uploading to platform
        if (snapshotHtml) {
          pendingSnapshots.set(name, snapshotHtml);
          console.log(`[Platform Sync] Cached snapshot for ${name}`);
        }

        res.status(200).json({
          msg: 'Saved',
          msgType: 'success'
        });
        console.log(`Saved: ${filename}`);
      } catch (error) {
        console.error(`Error saving file ${name}:`, error);
        errorLogger.error('Server', `Save error: ${name}`, error);
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

    // Tailwind CSS files - return empty CSS if not yet generated (avoids 404 on first load)
    app.get('/tailwindcss/:name.css', async (req, res) => {
      const cssPath = path.join(baseDir, 'tailwindcss', `${req.params.name}.css`);
      try {
        const css = await fs.readFile(cssPath, 'utf8');
        res.setHeader('Content-Type', 'text/css');
        res.send(css);
      } catch {
        // File doesn't exist yet, return empty CSS
        res.setHeader('Content-Type', 'text/css');
        res.send('');
      }
    });

    // Known server routes that should NOT be treated as client-side routes
    const knownServerRoutes = [
      'save', 'live-sync', 'tailwindcss', 'sites-versions', '__templates'
    ];

    // Static file serving with extensionless HTML support and client-side routing fallback
    app.use(async (req, res, next) => {
      const urlPath = req.path;

      // Clean the path and remove leading slash
      const requestedPath = urlPath === '/' ? 'index.html' : urlPath.substring(1);
      const filePath = path.join(baseDir, requestedPath);

      // Security check
      const resolvedPath = path.resolve(filePath);
      const resolvedBaseDir = path.resolve(baseDir);

      if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) && resolvedPath !== resolvedBaseDir) {
        return res.status(403).send('Access denied');
      }

      // Helper to serve a file with client-side routing fallback
      const serveWithFallback = async () => {
        try {
          const stats = await fs.stat(resolvedPath);
          if (stats.isDirectory()) {
            // Try index.html in directory
            const indexPath = path.join(resolvedPath, 'index.html');
            try {
              await fs.stat(indexPath);
              return res.sendFile(indexPath);
            } catch {
              return serveDirListing(res, resolvedPath, baseDir);
            }
          } else {
            return res.sendFile(resolvedPath);
          }
        } catch {
          // File doesn't exist - try alternatives
        }

        // Try with .html extension
        if (!requestedPath.endsWith('.html') && requestedPath !== 'index.html') {
          const htmlPath = path.join(baseDir, requestedPath + '.html');
          try {
            await fs.stat(htmlPath);
            return res.sendFile(htmlPath);
          } catch {
            // Continue to client-side routing fallback
          }
        }

        // Client-side routing fallback: /appname/any/path → serve appname.html
        // This enables single-page apps with client-side routing
        const segments = requestedPath.split('/').filter(Boolean);
        if (segments.length > 1) {
          const firstSegment = segments[0];

          // Skip if this looks like a known server route
          if (!knownServerRoutes.includes(firstSegment)) {
            const appHtmlPath = path.join(baseDir, firstSegment + '.html');
            try {
              await fs.stat(appHtmlPath);
              // Update currentResource cookie to match the app being served
              res.cookie('currentResource', firstSegment, {
                httpOnly: false,
                secure: false,
                sameSite: 'lax'
              });
              return res.sendFile(appHtmlPath);
            } catch {
              // App file doesn't exist either
            }
          }
        }

        // Final fallback
        if (requestedPath === 'index.html') {
          return serveDirListing(res, baseDir, baseDir);
        } else {
          return res.status(404).send('File not found');
        }
      };

      await serveWithFallback();
    });

    // Catch-all error handler for unhandled Express errors
    app.use((err, req, res, next) => {
      console.error('[Server] Unhandled error:', err);
      errorLogger.error('Server', `Unhandled error: ${req.method} ${req.path}`, err);
      res.status(500).send('Internal server error');
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
      errorLogger.error('Server', 'Server error', err);
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

    const html = eta.render('directory-listing', {
      displayPath,
      dirs,
      files,
      breadcrumbs
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error rendering directory listing:', error);
    errorLogger.error('Server', 'Directory listing error', error);
    res.status(500).send('Error reading directory');
  }
}

module.exports = {
  startServer,
  stopServer,
  getServerPort,
  isServerRunning,
  getAndClearSnapshot  // For sync engine to get cached snapshot HTML for platform sync
};

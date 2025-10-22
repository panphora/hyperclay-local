const express = require('express');
const fs = require('fs').promises;
const path = require('upath');
const { validateFileName } = require('../sync-engine/validation');
const { createBackup } = require('./utils/backup');

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

async function serveDirListing(res, dirPath, baseDir) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    // Get relative path for display
    const relPath = path.relative(baseDir, dirPath);
    const displayPath = relPath === '' ? '' : relPath;

    res.setHeader('Content-Type', 'text/html');
    
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>📁 Directory: /${displayPath}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            margin: 40px; 
            background: #f5f5f5; 
        }
        .container { 
            background: white; 
            padding: 30px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
        }
        h1 { 
            color: #333; 
            border-bottom: 2px solid #eee; 
            padding-bottom: 10px; 
        }
        .file-list { 
            list-style: none; 
            padding: 0; 
        }
        .file-item { 
            padding: 8px 0; 
            border-bottom: 1px solid #eee; 
        }
        .file-item:hover { 
            background: #f9f9f9; 
            margin: 0 -10px; 
            padding-left: 10px; 
            padding-right: 10px; 
        }
        .file-link { 
            text-decoration: none; 
            color: #0066cc; 
            display: flex; 
            align-items: center; 
        }
        .file-link:hover { 
            text-decoration: underline; 
        }
        .icon { 
            margin-right: 10px; 
            font-size: 16px; 
        }
        .html-file { 
            color: #ff6b35; 
        }
        .directory { 
            color: #4a90e2; 
            font-weight: 500; 
        }
        .back-link { 
            color: #666; 
            margin-bottom: 20px; 
            display: inline-block; 
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📁 Directory: /${displayPath}</h1>`;

    // Add back link if not in root
    if (displayPath !== '') {
      const parentPath = path.dirname('/' + displayPath);
      const backPath = parentPath === '/.' ? '/' : parentPath;
      html += `<a href="${backPath}" class="back-link">⬆️ Back to parent directory</a>`;
    }

    html += '<ul class="file-list">';

    // Sort entries: directories first, then files
    const dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
    const files = entries.filter(entry => entry.isFile() && !entry.name.startsWith('.'));

    // List directories
    for (const entry of dirs) {
      const entryPath = displayPath ? `${displayPath}/${entry.name}` : entry.name;
      html += `<li class="file-item">
        <a href="/${entryPath}" class="file-link directory">
          <span class="icon">📁</span>${entry.name}/
        </a>
      </li>`;
    }

    // List files
    for (const entry of files) {
      const entryPath = displayPath ? `${displayPath}/${entry.name}` : entry.name;
      const icon = entry.name.endsWith('.html') ? '🌐' : '📄';
      const className = entry.name.endsWith('.html') ? 'html-file' : '';
      
      html += `<li class="file-item">
        <a href="/${entryPath}" class="file-link ${className}">
          <span class="icon">${icon}</span>${entry.name}
        </a>
      </li>`;
    }

    html += `</ul>
    </div>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    res.status(500).send('Error reading directory');
  }
}

module.exports = {
  startServer,
  stopServer,
  getServerPort,
  isServerRunning
};
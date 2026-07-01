const express = require('express');
const fs = require('fs').promises;
const path = require('upath');
const { Eta } = require('eta');
const { validateFileName } = require('../sync-engine/validation.js');
const { createBackup } = require('./utils/backup.js');
const { scopeTailwindLink } = require('./utils/tailwind-scoping.js');
const {
  compileTailwind,
  getTailwindCssName
} = require('tailwind-hyperclay');
const { liveSync } = require('livesync-hyperclay');
const errorLogger = require('./error-logger');
const formatHtml = require('./format-html');
const { serveSiteApiLocal, extractSiteDataLocal } = require('./utils/data-api');
const { writeApiSidecar } = require('./utils/api-sidecar');
const dataGuard = require('./data-loss-guard');

// Initialize Eta
const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true
});

// Store snapshot HTML for platform sync (keyed by filename)
// When browser saves with snapshotHtml, we cache it for the sync engine to use
const pendingSnapshots = new Map();
let snapshotCleanupTimer = null;

/**
 * Get and clear the cached snapshot for a file.
 * Called by the sync engine before uploading to the platform.
 * @param {string} filename - Filename including extension
 * @returns {{html: string, userDriven: (boolean|undefined)}|null}
 */
function getAndClearSnapshot(filename) {
  const entry = pendingSnapshots.get(filename);
  pendingSnapshots.delete(filename);
  if (!entry?.html) return null;
  return { html: entry.html, userDriven: entry.userDriven };
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
      (!name.endsWith('.html') && !name.endsWith('.htmlclay')) ||
      path.isAbsolute(name) ||
      !/^[\w/.-]+$/.test(name) ||
      name.split('/').some(seg => seg.startsWith('.') || seg.length === 0)) {
    return { error: 'Invalid file path' };
  }

  const baseName = name.split('/').pop();
  const result = validateFileName(baseName);
  if (!result.valid) {
    return { error: result.error };
  }

  const filePath = path.join(baseDir, name);
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    return { error: 'Path escapes base directory' };
  }

  return { filePath, resolvedPath, baseName };
}

async function serveHtml(res, filePath) {
  const html = await fs.readFile(filePath, 'utf8');
  res.set('Content-Type', 'text/html');
  return res.send(html);
}

// Translate a data-api result object ({ status, headers?, json?, raw? }) into a
// response. `raw` is a JSON string sent verbatim (res.json would double-encode it);
// `json` is an object sent via res.json.
function sendApiResult(res, result) {
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  }
  if (result.raw !== undefined) {
    return res.status(result.status).type('application/json').send(result.raw);
  }
  return res.status(result.status).json(result.json);
}

function resolveResourceFromHref(href) {
  let pathname;
  try {
    pathname = new URL(href).pathname;
  } catch {
    pathname = href;
  }

  if (pathname === '/') return 'index.html';

  pathname = pathname.replace(/^\//, '');

  // Normalize so downstream liveSync keys (marks, broadcasts, subscriptions)
  // match the watcher's path.normalize(filename) output. Collapses `//`, `./`
  // and folds backslashes via upath.
  const htmlMatch = pathname.match(/^(.*?\.html(?:clay)?)/);
  if (htmlMatch) return path.normalize(htmlMatch[1]);

  return path.normalize(pathname);
}

// `/_/<action>` system-route marker (mirrors hyperclay's SYSTEM_ROUTE_MARKER = '_').
// Strips a leading `/_/` so `/_/save` → `/save`, `/_/live-sync/stream?x` →
// `/live-sync/stream?x`. Non-marker URLs pass through unchanged. Pure + exported
// for testing (the server binds a hardcoded port, so we don't boot it in unit tests).
function stripSystemRouteMarker(url) {
  if (typeof url === 'string' && url.startsWith('/_/')) {
    return url.slice(2); // drop leading "/_", keep the rest starting at "/"
  }
  return url;
}

// Build and return the configured Express app without listening. Split out of
// startServer so tests can drive the real route wiring (ordering + the marker gate)
// via supertest against an ephemeral port instead of the hardcoded 4321.
function createApp(baseDir, devHooks = null, isKnownPath = null) {
    const app = express();

    // `/_/<action>` system-route marker: forward `/_/`-prefixed requests to the
    // bare route so URLs emitted by newer hyperclayjs (e.g. `/_/save`,
    // `/_/live-sync/stream`) resolve to the same handlers. Mirrors the hyperclay
    // platform server (SYSTEM_ROUTE_MARKER = '_'). Bare routes stay working, so
    // apps embedding older hyperclayjs are unaffected. Runs before the
    // path-scoped body parsers and routes below.
    app.use((req, res, next) => {
      req.url = stripSystemRouteMarker(req.url);
      next();
    });

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
      const pageUrl = req.query['page-url'];
      if (!pageUrl) {
        return res.status(400).send('page-url parameter required');
      }
      const file = resolveResourceFromHref(pageUrl);
      if (!file) {
        return res.status(400).send('could not resolve file from page-url');
      }

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Register client (channel key = full path with extension, e.g. "blog/post.html")
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
      const { html, sender } = req.body;
      const pageUrl = req.headers['page-url'];
      if (!pageUrl) {
        return res.status(400).json({ error: 'Page-URL header is required' });
      }
      const file = resolveResourceFromHref(pageUrl);

      if (!file || typeof html !== 'string') {
        return res.status(400).json({ error: 'file and html are required' });
      }

      const validated = validateAndResolvePath(file, baseDir);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }

      try {
        // Cache snapshot for platform sync (consumed by uploadFile via getAndClearSnapshot).
        // Preserve any userDriven bit a prior /save cached for this file: the peer
        // live-sync body doesn't carry it, so overwriting blindly would drop the
        // human-gesture provenance and make a clean save read as ui-unknown.
        const prevSnap = pendingSnapshots.get(file);
        pendingSnapshots.set(file, { html, userDriven: prevSnap ? prevSnap.userDriven : undefined, timestamp: Date.now() });

        // Broadcast to other local browsers on the same channel as /live-sync/stream
        liveSync.broadcast(file, { html, sender });

        console.log(`[LiveSync] Broadcast: ${file} (from: ${sender})`);

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
    app.use('/save', express.json({ limit: '20mb' }));
    app.use('/save', express.text({ type: 'text/plain', limit: '20mb' }));

    // POST route to save/overwrite HTML files (supports subfolders)
    app.post('/save', async (req, res) => {
      const pageUrl = req.headers['page-url'];
      if (!pageUrl) {
        return res.status(400).json({
          msg: 'Page-URL header required.',
          msgType: 'error'
        });
      }
      const name = resolveResourceFromHref(pageUrl);

      // Handle both JSON and plain text requests
      let content, snapshotHtml, userDriven;
      if (req.body && typeof req.body === 'object' && Object.hasOwn(req.body, 'content')) {
        // JSON request from Hyperclay Local browser
        content = req.body.content;
        snapshotHtml = req.body.snapshotHtml;
        userDriven = req.body.userDriven;
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

      if (isKnownPath && !isKnownPath(name, filePath)) {
        return res.status(409).json({
          msg: 'This file has been moved or deleted. Please refresh the page.',
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
        // Ensure directory exists for subfolder files
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        // ANCILLARY DISK CONVENTION: versions dir and backups use baseName without
        // extension (matches platform's sites-versions/{baseName}/ layout).
        // Do NOT reuse `backupName` as a liveSync channel key — liveSync keys must
        // carry the extension (Rule 1).
        const backupName = name.replace(/\.(html|htmlclay)$/, '');

        // Capture the pre-write body for the data-clobber guard (cold-start seed
        // + whole-file Revert). Read once, before the overwrite below.
        let dataLossPrev = null;
        try { dataLossPrev = await fs.readFile(filePath, 'utf8'); } catch {}

        // Check if this is the first save (no versions exist yet)
        const siteVersionsDir = path.join(baseDir, 'sites-versions', backupName);
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
            await createBackup(baseDir, backupName, existingContent);
            console.log(`Created initial backup of existing ${name}`);
          } catch (error) {
            // File doesn't exist yet, that's OK
          }
        }

        content = scopeTailwindLink(name, content);

        // Format HTML to match platform output (consistent checksums)
        content = formatHtml(content);

        // Create backup of the new content
        await createBackup(baseDir, backupName, content);

        // Write file (creates if not exists, overwrites if exists)
        await fs.writeFile(filePath, content, 'utf8');

        // Mark as browser save so file watcher doesn't send redundant notification.
        // Key is full path with extension so it matches engine-watcher's wasBrowserSave check.
        liveSync.markBrowserSave(name);

        // Refresh the per-site API data sidecar BEFORE the fallible Tailwind compile,
        // so a Tailwind failure can't skip it and leave stale API data on disk
        // (mirrors the platform ordering in node-content.js). Non-fatal: a sidecar
        // error must never fail the save.
        try {
          await writeApiSidecar(baseDir, name, content);
        } catch (e) {
          console.error('writeApiSidecar failed (non-fatal):', e && e.message ? e.message : e);
        }

        // Data-clobber guard (non-blocking, non-fatal). A browser /save is always
        // a UI save, split by the userDriven bit into ui-gestured / ui-background.
        {
          const dataLossProv = dataGuard.provenanceForLocalSave(userDriven);
          dataGuard.runDataLossGuard({
            baseDir, name, newHtml: content, prevContent: dataLossPrev, prov: dataLossProv,
          }).catch(err => console.error('[data-guard] /save guard error:', err && err.message ? err.message : err));
        }

        // Generate Tailwind CSS if site uses it. `tailwindName` from
        // getTailwindCssName includes any path prefix present in the URL
        // (e.g. "blog/post"), so path.join naturally nests the CSS file. After
        // the replaceTailwindLink above, the URL is always scoped to the site's
        // folder, which mirrors the platform's
        // public-assets/tailwindcss/{username}/{path}/{baseName}.css layout.
        const tailwindName = getTailwindCssName(content);
        if (tailwindName) {
          const css = await compileTailwind(content);
          const cssPath = path.join(baseDir, 'tailwindcss', `${tailwindName}.css`);
          await fs.mkdir(path.dirname(cssPath), { recursive: true });
          await fs.writeFile(cssPath, css, 'utf8');
          console.log(`Generated Tailwind CSS: tailwindcss/${tailwindName}.css`);
        }

        // Store snapshot HTML (+ the userDriven provenance bit) for platform
        // sync. The sync engine retrieves this when uploading to the platform so
        // the platform guard can split a UI save from a background-script save.
        if (snapshotHtml) {
          pendingSnapshots.set(name, { html: snapshotHtml, userDriven, timestamp: Date.now() });
          console.log(`[Platform Sync] Cached snapshot for ${name}`);
        }

        res.status(200).json({
          msg: 'Saved',
          msgType: 'success'
        });
        console.log(`Saved: ${name}`);
      } catch (error) {
        console.error(`Error saving file ${name}:`, error);
        errorLogger.error('Server', `Save error: ${name}`, error);
        res.status(500).json({
          msg: `Server error saving file: ${error.message}`,
          msgType: 'error'
        });
      }
    });

    // Data-clobber guard endpoint (parity with hyperclay.com's /_/dataloss).
    // The marker-strip middleware rewrites /_/data-loss -> /data-loss. The site
    // is identified by ?file= (GET) / body.file (POST), falling back to the
    // Page-URL header — the local server hosts many files by name.
    app.use('/data-loss', express.json({ limit: '1mb' }));

    const resolveGuardFile = (req) => {
      const raw = (req.query && req.query.file) ||
        (req.body && typeof req.body === 'object' && req.body.file) ||
        (req.headers && req.headers['page-url']) || '';
      if (!raw) return null;
      const name = resolveResourceFromHref(String(raw));
      const validated = validateAndResolvePath(name, baseDir);
      if (validated.error) return null;
      return { name, filePath: validated.filePath };
    };

    app.get('/data-loss', async (req, res) => {
      const resolved = resolveGuardFile(req);
      if (!resolved) return res.json({ event: null });
      let currentHtml = '';
      try { currentHtml = await fs.readFile(resolved.filePath, 'utf8'); } catch {}
      const event = await dataGuard.getGuardEvent(baseDir, resolved.name, currentHtml);
      return res.json({ event: event || null });
    });

    app.post(/^\/data-loss(?:\/(.+))?$/, async (req, res) => {
      const resolved = resolveGuardFile(req);
      if (!resolved) return res.status(400).json({ error: 'file required' });
      const id = req.params[0] || (req.body && req.body.id) || null;
      const choice = req.body && req.body.choice;
      if (!['dismiss', 'revert', 'restore'].includes(choice)) {
        return res.status(400).json({ error: 'choice must be dismiss | revert | restore' });
      }
      let currentHtml = '';
      try { currentHtml = await fs.readFile(resolved.filePath, 'utf8'); } catch {}

      const writeBack = async (html) => {
        const backupName = resolved.name.replace(/\.(html|htmlclay)$/, '');
        const formatted = formatHtml(scopeTailwindLink(resolved.name, html));
        await fs.mkdir(path.dirname(resolved.filePath), { recursive: true });
        await createBackup(baseDir, backupName, formatted);
        await fs.writeFile(resolved.filePath, formatted, 'utf8');
        // Resolving the guard writes through this app, not an external editor.
        // Mark it so the file watcher doesn't treat the revert/restore as a fresh
        // change and re-run the guard (which would raise a spurious new event).
        liveSync.markBrowserSave(resolved.name);
        try { await writeApiSidecar(baseDir, resolved.name, formatted); } catch {}
        const tailwindName = getTailwindCssName(formatted);
        if (tailwindName) {
          try {
            const css = await compileTailwind(formatted);
            const cssPath = path.join(baseDir, 'tailwindcss', `${tailwindName}.css`);
            await fs.mkdir(path.dirname(cssPath), { recursive: true });
            await fs.writeFile(cssPath, css, 'utf8');
          } catch {}
        }
      };

      const result = await dataGuard.resolveGuard({
        baseDir, name: resolved.name, id, choice, currentHtml, writeBack,
      });
      if (!result.ok) return res.status(result.statusCode || 400).json({ error: result.error });
      return res.json({ ok: true, choice: result.choice, status: result.status });
    });

    // Tailwind CSS — serve from disk or auto-generate on first request.
    // Regex route so the captured name can include slashes (nested paths like
    // "blog/post"). A traditional /tailwindcss/:name.css route only matches a
    // single path segment, which silently broke nested sites.
    app.get(/^\/tailwindcss\/(.+)\.css$/, async (req, res) => {
      res.setHeader('Content-Type', 'text/css');
      const name = req.params[0]; // may contain slashes, e.g. "blog/post"

      if (name.includes('..') || name.startsWith('/') || path.isAbsolute(name)) {
        return res.status(400).send('');
      }
      const cssPath = path.join(baseDir, 'tailwindcss', `${name}.css`);
      const htmlPath = path.join(baseDir, `${name}.html`);
      const resolvedBase = path.resolve(baseDir);
      const resolvedCss = path.resolve(cssPath);
      const resolvedHtml = path.resolve(htmlPath);
      if (!resolvedCss.startsWith(resolvedBase + path.sep) ||
          !resolvedHtml.startsWith(resolvedBase + path.sep)) {
        return res.status(403).send('');
      }

      try {
        const css = await fs.readFile(cssPath, 'utf8');
        return res.send(css);
      } catch {}

      try {
        const html = await fs.readFile(htmlPath, 'utf8');
        const css = await compileTailwind(html);
        await fs.mkdir(path.dirname(cssPath), { recursive: true });
        await fs.writeFile(cssPath, css, 'utf8');
        console.log(`Auto-generated Tailwind CSS: tailwindcss/${name}.css`);
        return res.send(css);
      } catch {
        return res.send('');
      }
    });

    // `/_/api/<name>.html` — per-site data API (parity with hyperclay.com's
    // serveSiteApi). Gated on req.originalUrl so a BARE `/api/...` request still
    // falls through to a user's real `api/` folder; only the `/_/` marker form is
    // treated as the data API. Must come before the static catch-all. Reads the
    // requested extension (unlike the Tailwind route, which hardcodes .html), since
    // .htmlclay sites exist locally too.
    app.get(/^\/api\/(.+)\.(html|htmlclay)$/, async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/api/')) return next();
      const name = `${req.params[0]}.${req.params[1]}`;
      const validated = validateAndResolvePath(name, baseDir);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }
      try {
        return sendApiResult(res, await serveSiteApiLocal(baseDir, name));
      } catch (error) {
        console.error('Site API endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // `/_/api` or `/_/api/` with no file → index.html's data (parity nicety).
    app.get(/^\/api\/?$/, async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/api')) return next();
      try {
        return sendApiResult(res, await serveSiteApiLocal(baseDir, 'index.html'));
      } catch (error) {
        console.error('Site API endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // `<name>.html?data={...}` — query-driven extraction (parity with
    // extractSiteData). Intercepts a GET that carries ?data= before the static
    // catch-all serves the raw HTML; a no-data GET passes straight through.
    app.get(/.*/, async (req, res, next) => {
      if (req.query.data === undefined) return next();
      const requestedPath = req.path.replace(/^\//, '');
      const htmlMatch = requestedPath.match(/^(.*?\.html(?:clay)?)(\/.*)?$/);
      const name = htmlMatch ? htmlMatch[1] : (req.path === '/' ? 'index.html' : null);
      if (!name) return next();
      const validated = validateAndResolvePath(name, baseDir);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }
      try {
        return sendApiResult(res, await extractSiteDataLocal(baseDir, name, req.query.data));
      } catch (error) {
        console.error('Data endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // Dev-only popover control endpoints (only registered when devHooks are passed in)
    // Must be registered BEFORE the catch-all static file middleware below, otherwise
    // the catch-all intercepts every request (including POSTs) and returns 404.
    if (devHooks) {
      app.post('/__dev/popover/show', (req, res) => {
        try {
          devHooks.showSticky();
          res.json({ ok: true, sticky: true });
        } catch (err) {
          res.status(500).json({ ok: false, error: err.message });
        }
      });

      app.post('/__dev/popover/hide', (req, res) => {
        try {
          devHooks.hideAndClear();
          res.json({ ok: true, sticky: false });
        } catch (err) {
          res.status(500).json({ ok: false, error: err.message });
        }
      });
    }

    // Static file serving with SPA routing support
    // URLs with .html/.htmlclay extension: everything after the extension is a SPA route
    // e.g. /blog/app.htmlclay/dashboard → serves blog/app.htmlclay, SPA route: /dashboard
    app.use(async (req, res, next) => {
      const urlPath = req.path;
      const resolvedBaseDir = path.resolve(baseDir);

      // Root always shows directory listing
      if (urlPath === '/') {
        return serveDirListing(res, baseDir, baseDir);
      }

      const requestedPath = urlPath.substring(1);

      // Check if URL contains an .html or .htmlclay segment (SPA-aware routing)
      const htmlMatch = requestedPath.match(/^(.*?\.html(?:clay)?)(\/.*)?$/);
      if (htmlMatch) {
        const filePath = path.join(baseDir, htmlMatch[1]);
        const resolvedPath = path.resolve(filePath);

        if (!resolvedPath.startsWith(resolvedBaseDir + path.sep)) {
          return res.status(403).send('Access denied');
        }

        try {
          await fs.stat(resolvedPath);
          return serveHtml(res, resolvedPath);
        } catch {
          return res.status(404).send('File not found');
        }
      }

      // No HTML extension in URL — serve static files or directory listings
      const filePath = path.join(baseDir, requestedPath);
      const resolvedPath = path.resolve(filePath);

      if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) && resolvedPath !== resolvedBaseDir) {
        return res.status(403).send('Access denied');
      }

      try {
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          return serveDirListing(res, resolvedPath, baseDir);
        }
        return res.sendFile(resolvedPath);
      } catch {
        return res.status(404).send('File not found');
      }
    });

    // Catch-all error handler for unhandled Express errors
    app.use((err, req, res, next) => {
      console.error('[Server] Unhandled error:', err);
      errorLogger.error('Server', `Unhandled error: ${req.method} ${req.path}`, err);
      res.status(500).send('Internal server error');
    });

  return app;
}

function startServer(baseDir, devHooks = null, isKnownPath = null) {
  return new Promise((resolve, reject) => {
    if (server) {
      return reject(new Error('Server is already running'));
    }

    if (!snapshotCleanupTimer) {
      snapshotCleanupTimer = setInterval(() => {
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        for (const [key, entry] of pendingSnapshots) {
          if (entry.timestamp < fiveMinutesAgo) pendingSnapshots.delete(key);
        }
      }, 60 * 1000);
    }

    app = createApp(baseDir, devHooks, isKnownPath);

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

      if (snapshotCleanupTimer) {
        clearInterval(snapshotCleanupTimer);
        snapshotCleanupTimer = null;
      }

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
        isHtml: entry.name.endsWith('.html') || entry.name.endsWith('.htmlclay')
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
  getAndClearSnapshot,  // For sync engine to get cached snapshot HTML for platform sync
  // Exported for testing
  createApp,
  resolveResourceFromHref,
  validateAndResolvePath,
  stripSystemRouteMarker
};

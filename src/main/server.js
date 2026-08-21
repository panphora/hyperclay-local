const express = require('express');
const fs = require('fs').promises;
const path = require('upath');
const { Eta } = require('eta');
const { createBackup } = require('./utils/backup.js');
const {
  PathError,
  RESERVED_ROOT_SEGMENTS,
  getConsentRegistry,
  decodeOnce,
  validateSegments,
  resolveReadPath,
  resolveWritePath
} = require('./utils/path-resolver.js');
const { withFileLock, atomicWriteFile } = require('./utils/write-queue.js');
const crypto = require('crypto');
const busboy = require('busboy');
const { pruneAllVersions } = require('./utils/prune-versions.js');
const { scopeTailwindLink } = require('./utils/tailwind-scoping.js');
const {
  compileTailwind,
  getTailwindCssName
} = require('tailwind-hyperclay');
const { liveSync } = require('livesync-hyperclay');
const { messageBus, isValidChannel } = require('@panphora/hyper-wire');
const errorLogger = require('./error-logger');
const formatHtml = require('./format-html');
const { hasHtmlRoot } = formatHtml;
const { serveSiteApiLocal, extractSiteDataLocal } = require('./utils/data-api');
const { writeApiSidecar } = require('./utils/api-sidecar');
const dataGuard = require('./data-loss-guard');
const syncEngine = require('../sync-engine');
const { buildEnvelope } = require('../sync-engine/control-lane-core.cjs');

// Initialize Eta
const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true
});

// Spec §3: `/_/save` takes the document as text, so a JSON body is refused
// rather than guessed at. Compares the media type only, ignoring parameters like
// `; charset=utf-8`, and covers the `+json` structured suffix.
function isJsonContentType(contentType) {
  const mediaType = String(contentType || '').split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

// What each open file owes the platform on its next sync upload, keyed by
// filename. Two lanes fill it: /live-sync/save contributes the unstripped
// snapshot, /save contributes the provenance bit. Either half can arrive without
// the other, so both are optional and neither lane clears the other's.
const pendingSnapshots = new Map();
let snapshotCleanupTimer = null;

/**
 * Get and clear what a file owes the platform: the live-sync snapshot, the save's
 * provenance bit, or either one alone. Called by the sync engine before uploading.
 *
 * Returning null when there is no snapshot used to throw the provenance bit away
 * with it, which mattered as soon as the snapshot stopped riding along on the save
 * lane: a document on a preset without live-sync produces no snapshot at all, and
 * its saves would have reached the platform guard as ui-unknown.
 *
 * @param {string} filename - Filename including extension
 * @returns {{html: (string|null), userDriven: (boolean|undefined)}|null}
 */
function getAndClearSnapshot(filename) {
  const entry = pendingSnapshots.get(filename);
  pendingSnapshots.delete(filename);
  if (!entry) return null;
  if (!entry.html && entry.userDriven === undefined) return null;
  return { html: entry.html || null, userDriven: entry.userDriven };
}

let server = null;
let app = null;
const PORT = 4321;
let connections = new Set();

// Local file-serving validation. Deliberately NOT the sync engine's
// validateFileName (sync-engine/validation.js), which enforces a lowercase-ASCII
// *site-name* policy for cloud sync. A file on your own disk may contain spaces,
// `%`, `#` and non-ASCII, and must stay reachable locally even when its name
// could never be a hosted site name.
function validateAndResolvePath(name, baseDir) {
  if (typeof name !== 'string' || !/\.(html|htmlclay)$/.test(name)) {
    return { error: 'Invalid file path' };
  }

  let segments;
  try {
    segments = validateSegments(name);
  } catch {
    return { error: 'Invalid file path' };
  }

  const filePath = path.join(baseDir, name);
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedPath.startsWith(resolvedBase + '/')) {
    return { error: 'Path escapes base directory' };
  }

  return { filePath, resolvedPath, baseName: segments[segments.length - 1] };
}

// Name check + phase-4 canonical write resolution. The returned path is both the
// file to write and the write-queue key; every writer must use exactly this.
async function resolveWriteTarget(paths, name) {
  await paths.ready();
  const validated = validateAndResolvePath(name, paths.baseReal);
  if (validated.error) throw new PathError(400, validated.error);
  return await resolveWritePath(paths, name);
}

// Serve the file's ORIGINAL BYTES. Reading as utf8 and re-encoding on the way
// out silently rewrites any file that is not valid UTF-8.
async function serveHtml(res, filePath) {
  const html = await fs.readFile(filePath);
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

  // Decode exactly once, for the same reason the static catch-all does: a
  // browser sends `Page-URL: .../50%25%20off.html`, and without this the save
  // would land in a NEW file literally named `50%25%20off.html` while the real
  // one sat untouched. A malformed `%` leaves the value as-is so the caller's
  // own validation rejects it.
  try {
    pathname = decodeURIComponent(pathname);
  } catch {}

  if (pathname === '/') return 'index.html';

  pathname = pathname.replace(/^\//, '');

  // Normalize so downstream liveSync keys (marks, broadcasts, subscriptions)
  // match the watcher's path.normalize(filename) output. Collapses `//`, `./`
  // and folds backslashes via upath.
  const htmlMatch = pathname.match(/^(.*?\.html(?:clay)?)/);
  if (htmlMatch) return path.normalize(htmlMatch[1]);

  return path.normalize(pathname);
}

// ---------------------------------------------------------------- uploads (spec §9)

const SAVE_MAX_BYTES = 20 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

// Refused by extension. A document or a script stored beside a document and
// served from the same origin is stored XSS: the file the person "just uploaded"
// executes with the document's own authority. SVG is deliberately NOT in this
// list — it is accepted and served inert instead, see the Content-Disposition on
// the static lane below, because refusing it would break a legitimate and common
// kind of image.
const UPLOAD_REFUSED = /\.(html?|xhtml|htmlclay|js|mjs|cjs|xml|xht|xsl|xslt)$/i;

// Split a client-supplied filename into the parts the stored name is built from.
// A leading dot is stripped rather than preserved: validateSegments 404s any
// dot-prefixed segment, so `.avatar.png` would otherwise be refused with a
// message about a missing file.
function splitUploadName(fileName) {
  const base = path.basename(String(fileName || 'file')).replace(/\0/g, '').replace(/^\.+/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return { stem: base || 'file', ext: '' };
  return { stem: base.slice(0, dot) || 'file', ext: base.slice(dot) };
}

// `blog/app.html` -> `blog/assets-app`. Beside the document, named after it, so a
// folder of documents does not turn into one shared pile of files, and so the URL
// the client writes into the page resolves relative to the document itself.
function assetsDirFor(docRelPath) {
  const dir = path.dirname(docRelPath);
  const stem = path.basename(docRelPath).replace(/\.(html?|htmlclay|xhtml)$/i, '');
  const folder = `assets-${stem}`;
  return dir === '.' || dir === '' ? folder : `${dir}/${folder}`;
}

// Content-hash naming, which is what removes the race rather than a lock. Two
// uploads of DIFFERENT bytes get different names and never contend; two uploads
// of the SAME bytes converge on one file, and whichever loses the exclusive
// create reads back what the winner wrote and agrees with it. The tail lengthens
// only on a genuine hash prefix collision between different content.
async function storeUpload(paths, dirRel, fileName, content) {
  const { stem, ext } = splitUploadName(fileName);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  for (let len = 6; len <= 32; len += 2) {
    const name = `${stem}-${digest.slice(0, len)}${ext}`;
    const rel = `${dirRel}/${name}`;
    validateSegments(rel);
    const abs = await resolveWritePath(paths, rel);
    let handle = null;
    try {
      // 'wx' is O_EXCL: it creates or it fails, it never truncates. A plain write
      // here would let a second upload silently overwrite the first.
      handle = await fs.open(abs, 'wx', 0o644);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(abs);
      if (existing.equals(content)) return { name, bytes: content.length };
      continue;
    }
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return { name, bytes: content.length };
  }
  throw new PathError(409, 'Could not find a free name for that file.');
}

// One file part named `file` (spec §9). Anything else in the body is drained and
// ignored rather than refused, so a client that also sends fields still works.
function readUploadPart(req, limit) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = busboy({ headers: req.headers, limits: { fileSize: limit, files: 1 } });
    } catch {
      return reject(new PathError(400, 'Expected a multipart form upload.'));
    }
    let part = null;
    let failed = null;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || part) { stream.resume(); return; }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      // busboy TRUNCATES at the limit rather than erroring, so without this a file
      // over the cap is stored silently short and reported as a success.
      stream.on('limit', () => {
        failed = new PathError(413, `Files are limited to ${limit} bytes.`);
        stream.resume();
      });
      stream.on('end', () => { if (!failed) part = { filename: info.filename, content: Buffer.concat(chunks) }; });
    });
    parser.on('error', () => reject(new PathError(400, 'Could not read the upload.')));
    parser.on('close', () => (failed ? reject(failed) : resolve(part)));
    req.pipe(parser);
  });
}

// The spec's §3 code for a status, so a client branches on the reason instead of
// pattern-matching the message.
const UPLOAD_CODES = { 400: 'bad-request', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 413: 'too-large', 415: 'unsupported-type' };

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

// Known `/_/` system routes on this host. Anything else under the marker is reserved
// and 404s, so `/_/foo.html` can never reach the static catch-all and serve a document.
const SYSTEM_ROUTES = new Set(['save', 'live-sync', 'bus', 'data-loss', 'api', 'meta', 'upload']);

// True when a hostname (already parsed out of a URL or a Host header) names this
// machine's loopback interface. The whole 127/8 block counts, as does every
// spelling of IPv6 loopback — `new URL` normalizes `[0:0:0:0:0:0:0:1]` to `[::1]`,
// and the brackets are stripped before comparison.
function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return bare === 'localhost' ||
         bare === '::1' ||
         bare === '0:0:0:0:0:0:0:1' ||
         /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

// True when an Origin header value points at this machine's loopback interface.
// Any port is accepted: the served port varies (tests bind ephemeral ports), and
// a page on another loopback port is code already running on the user's machine,
// which can reach the bus directly anyway. Remote origins are what this blocks.
function isLoopbackOrigin(origin) {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// True when a Host header addresses this server legitimately. Parsed through
// `new URL` rather than split on ':' — splitting mangles an IPv6 literal like
// `[::1]:4321` into `[` + `:1]:4321`. Userinfo and path tricks (`localhost@evil.com`,
// `localhost/../evil.com`) fall out correctly because URL parsing resolves them
// to the real hostname before the comparison.
function isLoopbackHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  try {
    return isLoopbackHostname(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

// Build and return the configured Express app without listening. Split out of
// startServer so tests can drive the real route wiring (ordering + the marker gate)
// via supertest against an ephemeral port instead of the hardcoded 4321.
function createApp(baseDir, devHooks = null, isKnownPath = null) {
  // The map describes what the CURRENTLY served folder owes the platform, but it is
  // module state keyed by a path relative to that folder's root, so it would
  // otherwise outlive a folder switch. Two folders each holding an index.html then
  // share one entry: folder A's snapshot gets uploaded as folder B's, and the
  // platform broadcasts it verbatim into B's edit-mode tabs, where hyper-morph
  // merges A's document into B's page. The five-minute sweep in startServer is not
  // a substitute, since it is not even running while the server is stopped.
  pendingSnapshots.clear();

    const app = express();

    // Canonical path resolution + symlink consent for every route below. The
    // open-time walk is kicked off here so a folder that legitimately links out
    // of tree keeps working; links created later are not registered and are
    // refused on both reads and writes.
    const paths = getConsentRegistry(baseDir);
    paths.rescan();

    // Derived artifacts (Tailwind CSS) go through the same phase-2 + phase-4
    // pass as user files, so a crafted site name can't steer a generated file
    // out of the served folder.
    const resolveDerivedWrite = async (relPath) => {
      validateSegments(relPath);
      return await resolveWritePath(paths, relPath);
    };

    // DNS-rebinding hardening for the WHOLE origin, not just /bus. Binding to
    // localhost does not help: a rebound hostname resolves to 127.0.0.1 and the
    // request arrives here carrying the attacker's Host header. A loopback Host
    // is the only legitimate way to address this server.
    app.use((req, res, next) => {
      if (!isLoopbackHostHeader(req.headers.host)) {
        return res.status(403).send('Invalid Host header');
      }
      next();
    });

    // Origin validation for the WHOLE mutating surface, not per route. A loopback
    // bind does not help and neither does the Host check above: a page on
    // evil.com can POST to http://localhost:4321, and the browser sends the real
    // Host, so only Origin distinguishes it from the user's own page.
    //
    // /save survives today by accident. It requires the Page-URL header, and a
    // custom header forces a CORS preflight that this server never answers. That
    // protection evaporates the moment a route accepts a request that needs no
    // custom header: a cross-origin multipart form POST is a CORS "simple
    // request" and goes straight through. An upload route is exactly that shape,
    // which is why this lands before one exists rather than beside it.
    //
    // The rules, in order:
    //
    //   - Safe methods pass untouched.
    //   - No Origin at all passes: curl, the sync engine and a shell script send
    //     none, and none of them carry ambient browser authority. Browsers always
    //     send Origin on POST, including form submissions.
    //   - `Origin: null` is refused. It means a sandboxed document, a data: URL
    //     or a redirect chain, it is forgeable, and this host mints no tokens, so
    //     nothing here can carry authority in place of an origin. Local serves no
    //     document sandboxed (it sets no CSP), so no legitimate save is null.
    //   - Any other Origin must be loopback. Any port: the served port varies,
    //     and code on another loopback port is already running on this machine.
    //   - Sec-Fetch-Site is checked when present, as a second signal that costs
    //     nothing and does not depend on Origin being sent.
    const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    app.use((req, res, next) => {
      if (!UNSAFE_METHODS.has(req.method)) return next();

      const site = req.headers['sec-fetch-site'];
      if (site === 'cross-site') {
        return res.status(403).json({ msg: 'Cross-origin requests are not allowed.', msgType: 'error' });
      }

      const origin = req.headers.origin;
      if (origin === undefined) return next();
      if (origin !== 'null' && isLoopbackOrigin(origin)) return next();
      return res.status(403).json({ msg: 'Cross-origin requests are not allowed.', msgType: 'error' });
    });

    // `/_/<action>` system-route marker: forward `/_/`-prefixed requests to the
    // bare route so URLs emitted by newer hyperclayjs (e.g. `/_/save`,
    // `/_/live-sync/stream`) resolve to the same handlers. Mirrors the hyperclay
    // platform server (SYSTEM_ROUTE_MARKER = '_'). Bare routes stay working, so
    // apps embedding older hyperclayjs are unaffected. Runs before the
    // path-scoped body parsers and routes below. The `/_/` prefix is reserved:
    // an unknown marker path (e.g. `/_/foo.html`) now 404s here rather than
    // falling through to the static catch-all and serving a document.
    app.use((req, res, next) => {
      if (typeof req.url !== 'string' || !req.url.startsWith('/_/')) return next();
      const stripped = stripSystemRouteMarker(req.url);
      const segment = stripped.split(/[/?#]/)[1] || '';
      if (!SYSTEM_ROUTES.has(segment)) {
        return res.status(404).send('File not found');
      }
      req.url = stripped;
      // A known lane still needs an exact route match. Mark the request so that if it falls
      // through every system route to the static catch-all (e.g. `/_/save/foo.html`, whose tail
      // no route handles), the catch-all 404s instead of serving `save/foo.html` as a document.
      req.fromSystemRoute = true;
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

      // Lane: edit-mode tabs ride 'live' (default) and get pre-strip peer
      // snapshots; view-mode tabs pass ?lane=saved and only ever receive
      // post-strip on-disk HTML broadcast from the save paths. No auth —
      // this server is single-user/localhost.
      const lane = req.query.lane === 'saved' ? 'saved' : 'live';

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Register client (channel key = full path with extension, e.g. "blog/post.html")
      liveSync.subscribe(file, res, { lane });
      console.log(`[LiveSync] Client connected: ${file} (lane=${lane})`);

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

    // `/_/bus` — local message bus (hyper-wire). Pages and user-run handler
    // scripts publish/subscribe opaque JSON envelopes on named channels. The
    // bus adds no capability: it executes nothing, stores nothing, and knows
    // nothing about payloads; anything sharp lives in handlers the user runs
    // in their own terminal. Gated on req.originalUrl like the data API so a
    // bare `/bus/...` URL still falls through to a user's real bus/ folder.

    // DNS-rebinding hardening for both lanes: a rebound hostname reaches this
    // localhost-bound server carrying the attacker's Host header, and a
    // same-origin EventSource sends no Origin, so the Origin check on send
    // can't protect subscribe. A loopback Host is the only legitimate way to
    // address this server.
    // (The global Host gate above already rejects a rebound hostname; this stays
    // as the bus's own explicit, JSON-shaped statement of the same rule.)
    app.use('/bus', (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/bus/')) return next();
      if (!isLoopbackHostHeader(req.headers.host)) {
        return res.status(403).json({ error: 'Bus is localhost-only' });
      }
      next();
    });

    // 10mb matches /live-sync: ai-edit/request can carry full page HTML (@page).
    app.use('/bus', express.json({ limit: '10mb' }));

    // Body-parser failures on the bus get their truthful status (413 too large,
    // 400 bad JSON) instead of falling into the generic 500 catch-all below.
    app.use('/bus', (err, req, res, next) => {
      if (!req.originalUrl.startsWith('/_/bus/')) return next(err);
      res.status(err.status || 400).json({
        error: err.type === 'entity.too.large' ? 'Payload too large (10mb limit)' : 'Invalid JSON body'
      });
    });

    app.get('/bus/subscribe', (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/bus/')) return next();
      const requested = [...new Set([].concat(req.query.channel || []))];
      if (!requested.length) {
        return res.status(400).json({ error: 'channel parameter required' });
      }
      for (const channel of requested) {
        if (!isValidChannel(channel)) {
          return res.status(400).json({ error: `Invalid channel name: ${channel}` });
        }
      }

      // SSE headers (same shape as /live-sync/stream)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      requested.forEach(channel => messageBus.subscribe(channel, res));

      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (e) {
          clearInterval(keepAlive);
        }
      }, 30000);

      req.on('close', () => {
        clearInterval(keepAlive);
        requested.forEach(channel => messageBus.unsubscribe(channel, res));
      });

      res.write(': connected\n\n');
    });

    app.post('/bus/send', (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/bus/')) return next();
      // Cross-origin hardening: a browser page always sends Origin on POST, so
      // reject anything non-loopback. Handlers (curl, node) send no Origin and
      // pass. The JSON body requirement above already forces a CORS preflight
      // (which we never approve) for cross-origin browser senders; this check
      // is defense in depth.
      const requestOrigin = req.headers.origin;
      if (requestOrigin && !isLoopbackOrigin(requestOrigin)) {
        return res.status(403).json({ error: 'Cross-origin senders are not allowed' });
      }
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'JSON body required (Content-Type: application/json)' });
      }
      const { channel, type, v, payload, sender } = body;
      if (!isValidChannel(channel)) {
        return res.status(400).json({ error: `Invalid channel name: ${channel}` });
      }
      if (typeof type !== 'string' || type.length === 0) {
        return res.status(400).json({ error: 'type must be a non-empty string' });
      }
      // `origin` is advisory transport metadata (a local page could forge the
      // header): handlers treat channel + type + payload shape as the contract.
      const pageUrl = req.headers['page-url'];
      const origin = pageUrl ? resolveResourceFromHref(String(pageUrl)) : 'process';
      const delivered = messageBus.send({ channel, type, v, payload, sender, origin });
      res.json({ delivered });
    });

    // Note: File watcher for live-sync broadcast has been removed.
    // Live-sync is now browser-to-browser only (via platform SSE relay).
    // If you edit a file locally with a text editor, refresh the browser to see changes.
    // Disk sync is handled by polling + /sync/download (stripped content).
    console.log(`[LiveSync] Ready for browser-to-browser sync (no file watcher broadcast)`);

    // Spec §3: /_/save takes the document as text, and this route has exactly one
    // body shape. Everything else about the save travels in a header: the
    // provenance bit is `Save-Trigger`, and an unstripped snapshot goes to
    // /live-sync/save, which is the only route allowed to carry one.
    //
    // Every content type is read as text so a JSON body arrives as a string and
    // can be refused with a real message, rather than reaching the handler as an
    // unparsed blank and reporting "invalid request body".
    app.use('/save', express.text({ type: () => true, limit: SAVE_MAX_BYTES }));

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

      if (isJsonContentType(req.headers['content-type'])) {
        return res.status(415).json({
          msg: '/_/save takes the document as text, not JSON.',
          msgType: 'error',
          code: 'unsupported-media-type'
        });
      }

      // Reassigned below by scopeTailwindLink and formatHtml.
      let content = req.body;

      // A save is always a whole document: the browser serializes
      // documentElement.outerHTML. Checking the shape is not belt-and-braces here,
      // it is the only check there is. The route reads EVERY content type as text
      // so a JSON body can be refused with a real message, which means the type
      // matcher no longer rejects anything on the way in, and without this a
      // form-encoded post answered 200 and left `a=%3Chtml%3E...` in the file.
      // hasHtmlRoot scans for a real top-level <html> element rather than the
      // substring '<html', so junk that merely mentions one does not pass.
      if (!hasHtmlRoot(content)) {
        return res.status(422).json({
          msg: 'Not a complete HTML document with a top-level <html> element.',
          msgType: 'error',
          code: 'invalid-document'
        });
      }

      const userDriven = dataGuard.userDrivenFromHeader(req);

      // Phase-4 canonical resolution. `filePath` is the real path on disk (an
      // in-tree symlink is followed only when it was consented at open time),
      // and it is also the write-queue key below.
      let filePath;
      try {
        filePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({
          msg: error.message,
          msgType: 'error'
        });
      }

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
        // A1: the queue wraps the ENTIRE read-modify-write region — the pre-write
        // read, the first-save check, the backup, the write, and the derived
        // sidecar/Tailwind work. Serializing only the write would still let two
        // concurrent saves read the same stale base and compute from it.
        await withFileLock(filePath, async () => {
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

        // Write via temp + rename: a crash or a full disk can never leave the
        // served file holding partial bytes.
        await atomicWriteFile(filePath, content);

        // Mark as browser save so file watcher doesn't send redundant notification.
        // Key is full path with extension so it matches engine-watcher's wasBrowserSave check.
        liveSync.markBrowserSave(name);

        // Morph view-mode tabs with the persisted on-disk HTML. Edit-mode tabs
        // are untouched — they sync via /live-sync/save on the live lane.
        liveSync.broadcast(name, { html: content, sender: 'server-save' }, { lane: 'saved' });

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
        // Non-fatal, for the same reason as the sidecar above and the two remote
        // writers: the file is already written, backed up and broadcast by this
        // point, so a compiler error must not report the save as failed, and must
        // not skip the snapshot cache below.
        const tailwindName = getTailwindCssName(content);
        if (tailwindName) {
          try {
            const css = await compileTailwind(content);
            const cssPath = await resolveDerivedWrite(`tailwindcss/${tailwindName}.css`);
            await atomicWriteFile(cssPath, css);
            console.log(`Generated Tailwind CSS: tailwindcss/${tailwindName}.css`);
          } catch (e) {
            console.error('compileTailwind failed (non-fatal):', e && e.message ? e.message : e);
          }
        }

        // Record the provenance bit for platform sync. The sync engine reads it
        // when uploading, so the platform guard can split a UI save from a
        // background-script save. The snapshot beside it comes from
        // /live-sync/save, which is why this merges rather than replaces: the two
        // lanes contribute different halves of the same entry.
        {
          const prev = pendingSnapshots.get(name);
          pendingSnapshots.set(name, {
            html: prev ? prev.html : null,
            userDriven,
            timestamp: Date.now()
          });
        }
        });

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

    const resolveGuardFile = async (req) => {
      const raw = (req.query && req.query.file) ||
        (req.body && typeof req.body === 'object' && req.body.file) ||
        (req.headers && req.headers['page-url']) || '';
      if (!raw) return null;
      const name = resolveResourceFromHref(String(raw));
      try {
        return { name, filePath: await resolveWriteTarget(paths, name) };
      } catch {
        return null;
      }
    };

    // GET /_/meta — discovery (spec §5). Both lanes require the `/_/` prefix, the
    // same way /bus/send does, so a user folder actually named `meta` or `upload`
    // keeps being served as a folder.
    app.get('/meta', async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/meta')) return next();
      // `spec` and `extensions` describe the HOST and are the same for every
      // document it serves. `document` describes the one named by Document-URL,
      // and is withheld by OMISSION, so the answer for a document that is not
      // there is byte-identical to the answer for one a caller may not see.
      const body = { spec: 1, extensions: ['upload'] };
      const href = req.headers['document-url'] || req.headers['page-url'];
      if (href) {
        try {
          const filePath = await resolveWriteTarget(paths, resolveResourceFromHref(href));
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            // Everything under the served folder belongs to the person running
            // this app, so there is no permission to consult: writable is what
            // this host IS.
            body.document = {
              writable: true,
              maxBytes: SAVE_MAX_BYTES,
              upload: { allowed: true, maxBytes: UPLOAD_MAX_BYTES }
            };
          }
        } catch { /* omission, never a different answer */ }
      }
      return res.json(body);
    });

    // POST /_/upload — store a file beside the document instead of embedding it
    // (spec §9). No body parser runs on this path: express.json/text are scoped
    // to '/save', so the multipart body arrives intact.
    app.post('/upload', async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/upload')) return next();
      const href = req.headers['document-url'] || req.headers['page-url'];
      if (!href) {
        return res.status(400).json({ msg: 'Document-URL header required.', msgType: 'error', code: 'bad-request' });
      }
      const docName = resolveResourceFromHref(href);
      try {
        // The upload is authorized by the document existing and being writable,
        // exactly as a save is. A file that is not there cannot be uploaded to.
        const docPath = await resolveWriteTarget(paths, docName);
        const docStats = await fs.stat(docPath).catch(() => null);
        if (!docStats || !docStats.isFile()) {
          return res.status(404).json({ msg: 'That document does not exist.', msgType: 'error', code: 'not-found' });
        }

        const part = await readUploadPart(req, UPLOAD_MAX_BYTES);
        if (!part) {
          return res.status(400).json({ msg: 'No file to upload.', msgType: 'error', code: 'bad-request' });
        }
        if (UPLOAD_REFUSED.test(part.filename || '')) {
          return res.status(415).json({ msg: 'That kind of file cannot be uploaded.', msgType: 'error', code: 'unsupported-type' });
        }

        const dirRel = assetsDirFor(docName);
        const dirAbs = await resolveWritePath(paths, dirRel);
        await fs.mkdir(dirAbs, { recursive: true });
        const stored = await storeUpload(paths, dirRel, part.filename, part.content);

        // Percent-encoded per segment, while the stored name keeps its own
        // characters. A raw space renders through img src, because the browser
        // repairs it, and breaks in srcset, where a space separates candidates.
        const url = `${encodeURIComponent(path.basename(dirRel))}/${encodeURIComponent(stored.name)}`;
        return res.json({
          msg: 'Uploaded',
          msgType: 'success',
          uploads: [{ name: stored.name, url, bytes: stored.bytes }]
        });
      } catch (error) {
        const status = error.status || error.statusCode;
        if (!status) return next(error);
        return res.status(status).json({
          msg: error.message,
          msgType: 'error',
          code: UPLOAD_CODES[status] || 'error'
        });
      }
    });

    app.get('/data-loss', async (req, res) => {
      const resolved = await resolveGuardFile(req);
      if (!resolved) return res.json({ event: null });
      let currentHtml = '';
      try { currentHtml = await fs.readFile(resolved.filePath, 'utf8'); } catch {}
      const event = await dataGuard.getGuardEvent(baseDir, resolved.name, currentHtml);
      return res.json({ event: event || null });
    });

    app.post(/^\/data-loss(?:\/(.+))?$/, async (req, res) => {
      const resolved = await resolveGuardFile(req);
      if (!resolved) return res.status(400).json({ error: 'file required' });
      const id = req.params[0] || (req.body && req.body.id) || null;
      const choice = req.body && req.body.choice;
      if (!['dismiss', 'revert', 'restore'].includes(choice)) {
        return res.status(400).json({ error: 'choice must be dismiss | revert | restore' });
      }

      const writeBack = async (html) => {
        const backupName = resolved.name.replace(/\.(html|htmlclay)$/, '');
        const formatted = formatHtml(scopeTailwindLink(resolved.name, html));
        await createBackup(baseDir, backupName, formatted);
        await atomicWriteFile(resolved.filePath, formatted);
        // Resolving the guard writes through this app, not an external editor.
        // Mark it so the file watcher doesn't treat the revert/restore as a fresh
        // change and re-run the guard (which would raise a spurious new event).
        liveSync.markBrowserSave(resolved.name);
        // Revert/restore changed the on-disk file — morph view-mode tabs.
        liveSync.broadcast(resolved.name, { html: formatted, sender: 'server-save' }, { lane: 'saved' });
        try { await writeApiSidecar(baseDir, resolved.name, formatted); } catch {}
        const tailwindName = getTailwindCssName(formatted);
        if (tailwindName) {
          try {
            const css = await compileTailwind(formatted);
            const cssPath = await resolveDerivedWrite(`tailwindcss/${tailwindName}.css`);
            await atomicWriteFile(cssPath, css);
          } catch {}
        }
      };

      // A1: the restore region is read-modify-write too — the current body is
      // read, the guard decides against it, and writeBack publishes. All of it
      // holds the same canonical-path queue slot a concurrent /save would need.
      const result = await withFileLock(resolved.filePath, async () => {
        let currentHtml = '';
        try { currentHtml = await fs.readFile(resolved.filePath, 'utf8'); } catch {}
        return await dataGuard.resolveGuard({
          baseDir, name: resolved.name, id, choice, currentHtml, writeBack,
        });
      });
      if (!result.ok) return res.status(result.statusCode || 400).json({ error: result.error });
      // rider 1: after a local Dismiss, nudge the platform (and thence the owner's
      // other devices) to clear the same incident. nodeId from the node map is an
      // optional rename-resilience accelerator. Fire-and-forget: the local UI has
      // already cleared, so the POST must not delay this response.
      if (result.control && syncEngine.serverUrl && syncEngine.apiKey) {
        const nodeId = syncEngine.repo?.getByPath?.(resolved.name)?.nodeId;
        syncEngine
          .sendControlMessage(buildEnvelope('data-loss/dismiss', 1, {
            ...result.control,
            ...(nodeId ? { nodeId } : {}),
          }))
          .catch(() => {});
      }
      return res.json({ ok: true, choice: result.choice, status: result.status });
    });

    // Tailwind CSS — serve from disk or auto-generate on first request.
    // Regex route so the captured name can include slashes (nested paths like
    // "blog/post"). A traditional /tailwindcss/:name.css route only matches a
    // single path segment, which silently broke nested sites.
    app.get(/^\/tailwindcss\/(.+)\.css$/, async (req, res) => {
      res.setHeader('Content-Type', 'text/css');
      // Same canonical pass as every other consumer: this route used to rebuild
      // raw paths and follow symlinks on its own.
      let cssPath;
      let htmlPath;
      let name;
      try {
        // Express already decodes regex-route captures (router/layer.js decode_param),
        // so decoding here again would 400 on "50% off" and mis-resolve "a%20b".
        name = req.params[0]; // may contain slashes, e.g. "blog/post"
        cssPath = await resolveDerivedWrite(`tailwindcss/${name}.css`);
        htmlPath = await resolveDerivedWrite(`${name}.html`);
      } catch (error) {
        return res.status(error.status === 400 ? 400 : 403).send('');
      }

      // Cache hit: a pure read, so it needs no queue slot.
      try {
        const css = await fs.readFile(cssPath, 'utf8');
        return res.send(css);
      } catch {}

      // Cache miss: this is a read-modify-write of a derived artifact, so it
      // belongs in the SOURCE file's critical section like every other derived
      // write. Unqueued, a compile of H0 that started before a concurrent /save
      // finishes after it and overwrites the H1 stylesheet the save published.
      try {
        const css = await withFileLock(htmlPath, async () => {
          // Re-check inside the lock: we may have queued behind exactly the save
          // that just published a fresher stylesheet, and recompiling from our
          // own stale read would throw it away.
          try {
            return await fs.readFile(cssPath, 'utf8');
          } catch {}
          const html = await fs.readFile(htmlPath, 'utf8');
          const compiled = await compileTailwind(html);
          await atomicWriteFile(cssPath, compiled);
          console.log(`Auto-generated Tailwind CSS: tailwindcss/${name}.css`);
          return compiled;
        });
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
      let name;
      let sourcePath;
      try {
        // Already decoded by Express; see the /tailwindcss route above.
        name = `${req.params[0]}.${req.params[1]}`;
        sourcePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      try {
        return sendApiResult(res, await serveSiteApiLocal(baseDir, name, { sourcePath }));
      } catch (error) {
        console.error('Site API endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // `/_/api` or `/_/api/` with no file → index.html's data (parity nicety).
    app.get(/^\/api\/?$/, async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/api')) return next();
      try {
        const sourcePath = await resolveWriteTarget(paths, 'index.html');
        return sendApiResult(res, await serveSiteApiLocal(baseDir, 'index.html', { sourcePath }));
      } catch (error) {
        console.error('Site API endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // `<name>.html?data={...}` — query-driven extraction (parity with
    // extractSiteData). Intercepts a GET that carries ?data= before the static
    // catch-all serves the raw HTML; a no-data GET passes straight through.
    app.get(/.*/, async (req, res, next) => {
      // A marker-origin request that reached here (e.g. `/_/save/foo.html?data=`) matched no system
      // route, so its stripped path is reserved: `?data=` must not extract the file, just as the
      // static catch-all must not serve it.
      if (req.fromSystemRoute) return res.status(404).send('File not found');
      if (req.query.data === undefined) return next();
      const requestedPath = req.path.replace(/^\//, '');
      const htmlMatch = requestedPath.match(/^(.*?\.html(?:clay)?)(\/.*)?$/);
      const rawName = htmlMatch ? htmlMatch[1] : (req.path === '/' ? 'index.html' : null);
      if (!rawName) return next();
      let name;
      let sourcePath;
      try {
        name = decodeOnce(rawName);
        sourcePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      try {
        return sendApiResult(res, await extractSiteDataLocal(baseDir, name, req.query.data, { sourcePath }));
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
      try {
        // A request that arrived under the reserved `/_/` marker and reached the static
        // catch-all was not consumed by any system route, so its stripped path (e.g.
        // `save/foo.html`) must not be served as a document. 404 it.
        if (req.fromSystemRoute) {
          return res.status(404).send('File not found');
        }

        await paths.ready();

        // Phase 1: decode exactly once. Express never decodes req.path, so
        // before this a file with a space or any non-ASCII name was unreachable.
        // A malformed `%` throws URIError, which decodeOnce turns into a 400.
        const urlPath = decodeOnce(req.path);

        // Root always shows directory listing
        if (urlPath === '/') {
          return await serveDirListing(res, paths.baseReal, paths.baseReal);
        }

        const requestedPath = urlPath.substring(1);

        // Check if URL contains an .html or .htmlclay segment (SPA-aware routing)
        const htmlMatch = requestedPath.match(/^(.*?\.html(?:clay)?)(\/.*)?$/);
        if (htmlMatch) {
          // Phases 2 + 3. A read error now reaches the error handler with its
          // real status instead of being flattened into a 404 — and `await`
          // matters: Express 4 does not consume a rejected async handler's
          // promise, so an unawaited serveHtml rejection hangs the request.
          validateSegments(htmlMatch[1]);
          const realPath = await resolveReadPath(paths, htmlMatch[1]);
          const stats = await fs.stat(realPath);
          if (stats.isDirectory()) throw new PathError(404, 'File not found');
          return await serveHtml(res, realPath);
        }

        // No HTML extension in URL — serve static files or directory listings.
        // A bare `/` was handled above, so every path here has segments.
        validateSegments(requestedPath);
        const realPath = await resolveReadPath(paths, requestedPath);
        const stats = await fs.stat(realPath);
        if (stats.isDirectory()) {
          return await serveDirListing(res, realPath, paths.baseReal);
        }
        // An SVG is a document: it can carry <script>, and served inline from
        // this origin it runs with the same authority as the page beside it.
        // Uploads accept SVG precisely BECAUSE serving it inert is possible, so
        // this header is what makes that decision safe. Unconditional, because a
        // file's provenance is not knowable at serve time — one uploaded through
        // /_/upload and one the person dropped in the folder look identical here.
        // `nosniff` stops a browser from second-guessing the type.
        if (/\.svgz?$/i.test(realPath)) {
          res.setHeader('Content-Disposition', 'attachment');
          res.setHeader('X-Content-Type-Options', 'nosniff');
        }
        return res.sendFile(realPath);
      } catch (error) {
        return next(error);
      }
    });

    // A4: honor err.status and res.headersSent. This used to force a 500 on
    // every failure, including a client-aborted sendFile, where it then threw
    // again setting headers on an already-sent response.
    app.use((err, req, res, next) => {
      const status = err.status || err.statusCode ||
        (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500);

      // Let Express's default handler destroy the socket; we cannot re-send.
      if (res.headersSent) return next(err);

      if (status >= 500) {
        console.error('[Server] Unhandled error:', err);
        errorLogger.error('Server', `Unhandled error: ${req.method} ${req.path}`, err);
      }

      const body = status === 404 ? 'File not found'
        : status === 403 ? 'Access denied'
        : status === 400 ? 'Bad request'
        : 'Internal server error';
      res.status(status).send(body);
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

      // A5: one retention sweep at startup, so a folder that has been accumulating
      // versions for months gets trimmed even if nothing is saved this session.
      pruneAllVersions(baseDir)
        .then(({ sites, deleted }) => {
          if (deleted) console.log(`[BACKUP] Startup prune: removed ${deleted} version(s) across ${sites} site(s)`);
        })
        .catch(err => console.error('[BACKUP] Startup prune failed (non-fatal):', err && err.message ? err.message : err));

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

// A0. The listing emits displayName through Eta's RAW tag (`<%~`) so the <wbr>
// markup below survives, which means the filename must be escaped BEFORE the
// breaks go in. Escaping first is safe for addWordBreaks: no entity produced
// here contains `-`, `_`, `/`, `.`, a lowercase→uppercase pair, or a
// letter-followed-by-digit pair, so no rule can ever split one apart.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Eta escapes an href for HTML but never percent-encodes it, so `#`, `?` and `%`
// in a name produced broken links — and once the catch-all decodes exactly once,
// `50% off.html` would throw URIError on the way back in. Encode per segment so
// the separating slashes survive.
function encodePathSegments(relPath) {
  return String(relPath).split('/').map(encodeURIComponent).join('/');
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

    // Sort entries: directories first, then files. `sites-versions` is an
    // internal backup store, not user content — the listing must not advertise
    // it any more than the catch-all will serve it.
    const isVisible = (entry) =>
      !entry.name.startsWith('.') &&
      !(displayPath === '' && RESERVED_ROOT_SEGMENTS.has(entry.name));

    const dirs = entries
      .filter(entry => entry.isDirectory() && isVisible(entry))
      .map(entry => ({
        name: entry.name,
        displayName: addWordBreaks(escapeHtml(entry.name)),
        path: displayPath ? `${displayPath}/${entry.name}` : entry.name,
        url: encodePathSegments(displayPath ? `${displayPath}/${entry.name}` : entry.name)
      }));

    const files = entries
      .filter(entry => entry.isFile() && isVisible(entry))
      .map(entry => ({
        name: entry.name,
        displayName: addWordBreaks(escapeHtml(entry.name)),
        path: displayPath ? `${displayPath}/${entry.name}` : entry.name,
        url: encodePathSegments(displayPath ? `${displayPath}/${entry.name}` : entry.name),
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
          path: '/' + currentPath,
          url: '/' + encodePathSegments(currentPath)
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
  stripSystemRouteMarker,
  SYSTEM_ROUTES,
  isLoopbackOrigin,
  isLoopbackHostHeader,
  isLoopbackHostname,
  escapeHtml,
  encodePathSegments,
  addWordBreaks
};

const crypto = require('crypto');
const fs = require('fs').promises;
const http = require('http');
const path = require('upath');
const { getConsentRegistry, resolveReadPath } = require('../utils/path-resolver');
const { RootTree, entryFor } = require('./tree');
const { executeCommand, safePath, refusal } = require('./commands');
const { createAutoNamer } = require('./auto-name');
const { SearchIndex } = require('./search-index');
const { handleWorkspaceRoute } = require('./routes');

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

const ENTRY_TTL_MS = 60_000;

function cookieOf(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1024 * 1024) throw refusal('forbidden', 'Request is too large', 413);
  }
  try { return JSON.parse(text); } catch { throw refusal('forbidden', 'Invalid JSON', 400); }
}

function createShellServer({ authority, rootPool, observerFor, settings, appVersion, connection = () => ({}),
  syncManager = () => null, rootTitleFor = root => path.basename(root.path), appDataPath = null, checkpoint = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const bootstrapSecret = crypto.randomBytes(32).toString('base64url');
  const sessionSecret = crypto.randomBytes(32).toString('base64url');
  const entries = new Map();
  const epoch = crypto.randomBytes(16).toString('base64url');
  const trees = new Map();
  const indexes = new Map();
  const wires = new Map();
  const subscribers = new Set();
  const changedPaths = new Map();
  const autoNamer = appDataPath ? createAutoNamer({
    appDataPath, authority, checkpoint,
    rootFor: id => (settings().roots || []).find(root => root.id === id && rootPool.get(id)?.state === 'running'),
    rename: async (root, from, name) => executeCommand({
      root, authority, engine: rootPool.get(root.id)?.deps?.syncEngineFor?.(),
      request: { command: 'rename', path: from, name }, tree: await treeFor(root), moved, changed,
    }),
  }) : null;
  checkpoint?.setAutoNamer(autoNamer);
  let nextWireId = 1;
  let seq = 0;
  let server = null;
  let origin = null;
  let manifest = null;
  let assetDir = null;
  let changedTimer = null;

  const roots = () => (settings().roots || []).map(root => {
    const session = (settings().syncSessions || []).find(item => item.rootId === root.id);
    const status = rootPool.get(root.id)?.state;
    const syncState = connection().syncStatuses?.find(item => item.rootId === root.id);
    const syncStatus = syncState?.status;
    return {
      id: root.id, name: rootTitleFor(root), kind: root.kind,
      origin: `http://localhost:${root.port}`,
      sync: status !== 'running' ? 'not-syncing' : !session ? 'off' :
        session.paused || syncStatus === 'paused' ? 'paused' :
          syncStatus === 'offline' || syncStatus === 'error' || connection().online === false ? 'offline' :
            !syncState?.running ? 'not-syncing' : 'synced',
      teamName: root.kind === 'team' ? (session?.cached?.username || rootTitleFor(root)) : null,
    };
  });

  function emit(event) {
    const line = `${JSON.stringify({ ...event, seq: ++seq, epoch })}\n`;
    for (const res of subscribers) res.write(line);
  }

  function changed(rootId, paths) {
    let held = changedPaths.get(rootId);
    if (!held) { held = new Set(); changedPaths.set(rootId, held); }
    for (const rel of Array.isArray(paths) ? paths : [paths]) {
      held.add(rel);
      indexes.get(rootId)?.update(rel);
    }
    if (changedTimer) return;
    changedTimer = setTimeout(() => {
      changedTimer = null;
      for (const [id, names] of changedPaths) if (names.size) emit({ type: 'changed', rootId: id, paths: [...names].sort() });
      changedPaths.clear();
    }, 35);
    changedTimer.unref?.();
  }

  function moved(rootId, from, to) {
    indexes.get(rootId)?.update(from);
    if (to) indexes.get(rootId)?.update(to);
    const held = changedPaths.get(rootId);
    held?.delete(from);
    held?.delete(to);
    for (const [key, id] of [...wires]) {
      if (key.startsWith(`${rootId}:`) && (key.slice(rootId.length + 1) === from || key.slice(rootId.length + 1).startsWith(`${from}/`))) {
        wires.delete(key);
        wires.set(`${rootId}:${to + key.slice(rootId.length + 1 + from.length)}`, id);
      }
    }
    emit({ type: 'moved', rootId, from, to });
  }

  async function treeFor(root) {
    let tree = trees.get(root.id);
    if (!tree) {
      const observer = observerFor(root.id);
      tree = new RootTree(root, observer, changed);
      if (autoNamer && observer) tree.unsubscribeAutoName = observer.subscribe(({ event, rel }) => {
        autoNamer.observe(root, event, rel).catch(error => console.error(`[auto-name] observer: ${error.message}`));
      });
      if (observer) tree.unsubscribeSearch = observer.subscribe(({ rel }) => indexes.get(root.id)?.update(rel));
      trees.set(root.id, tree);
    }
    await tree.start();
    return tree;
  }

  function admitted(req) {
    return req.headers['x-workspace-token'] === token &&
      req.headers.host === new URL(origin).host &&
      (!req.headers.origin || req.headers.origin === origin) &&
      (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  }

  // Cookies ignore the port, so two copies of the app on one machine each need their own name.
  const sessionCookie = () => `hyperclay-workspace-${new URL(origin).port}`;

  function browserAdmitted(req) {
    return req.headers['x-workspace-bootstrap'] === bootstrapSecret || cookieOf(req, sessionCookie()) === sessionSecret;
  }

  let starting = null;

  async function listen() {
    const manifestPath = require.resolve('@panphora/hyperclay-workspace/local-app/manifest.json');
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assetDir = path.dirname(manifestPath);
    server = http.createServer((req, res) => {
      handle(req, res).catch(error => {
        if (res.headersSent) { res.destroy(); return; }
        const reason = error.reason || (error.status === 403 ? 'forbidden' : error.status === 404 ? 'missing'
          : error.status === 409 ? 'conflict' : error.code === 'ENOENT' ? 'missing'
          : error.code === 'destination-exists' ? 'conflict'
            : error.code === 'peers-editing' ? 'conflict' : 'unknown');
        sendJson(res, error.status || (reason === 'missing' ? 404 : reason === 'conflict' ? 409 : 500),
          { error: error.message || 'Request failed', reason, ...(error.code ? { code: error.code } : {}) });
      });
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      origin = `http://127.0.0.1:${server.address().port}`;
      return { origin };
    } catch (error) { server = null; throw error; }
  }

  async function handle(req, res) {
    const url = new URL(req.url, origin);
    if (req.headers.host !== new URL(origin).host) return sendJson(res, 403, { error: 'Forbidden', reason: 'forbidden' });
    if (url.pathname.startsWith('/api/')) {
      if (!admitted(req)) return sendJson(res, 403, { error: 'Forbidden', reason: 'forbidden' });
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
        const state = connection();
        return sendJson(res, 200, {
          protocol: manifest.protocol, epoch, shellOrigin: origin, appVersion,
          online: state.online !== false,
          account: { signedIn: !!state.account?.signedIn, username: state.account?.username || null }, roots: roots(),
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/roots') return sendJson(res, 200, roots());
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.write(': connected\n');
        subscribers.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n'), 25_000);
        heartbeat.unref?.();
        req.on('close', () => { clearInterval(heartbeat); subscribers.delete(res); });
        return;
      }
      const match = /^\/api\/roots\/([^/]+)\/(tree|list|search|document|commands|source|versions|version|restore|upload|download|consents|conflicts\/resolve)$/.exec(url.pathname);
      if (!match) throw refusal('unsupported', 'Route is not available yet', 501);
      let id;
      try { id = decodeURIComponent(match[1]); } catch { throw refusal('forbidden', 'Invalid root', 403); }
      const root = (settings().roots || []).find(item => item.id === id);
      if (!root || rootPool.get(id)?.state !== 'running') throw refusal('missing', 'Root is not running', 404);
      const route = match[2];
      if (!['tree', 'list', 'search', 'document', 'commands'].includes(route)) {
        return handleWorkspaceRoute({ req, res, url, root, route, settings, syncManager });
      }
      if (route === 'commands' && req.method === 'POST') {
        const request = await readBody(req);
        const tree = await treeFor(root);
        const result = await executeCommand({ root, authority, engine: rootPool.get(id)?.deps?.syncEngineFor?.(),
          request, tree, moved, changed });
        if (request.command === 'create') await autoNamer?.record(root, result.path, request.template);
        else await autoNamer?.command(root, request, result.path);
        return sendJson(res, 200, result);
      }
      if (req.method !== 'GET') throw refusal('unsupported', 'Method is not available', 405);
      const tree = await treeFor(root);
      if (route === 'tree') return sendJson(res, 200, { entries: tree.all().sort((a, b) => collator.compare(a.path, b.path)) });
      if (route === 'list') {
        const parent = url.searchParams.get('parent') || '';
        if (parent) {
          safePath(parent);
          const parentPath = await resolveReadPath(getConsentRegistry(root.path), parent);
          if (!(await fs.stat(parentPath)).isDirectory()) throw refusal('missing', 'Folder is missing', 404);
        }
        const sort = url.searchParams.get('sort') || 'name';
        if (!['name', 'updated', 'size'].includes(sort)) throw refusal('forbidden', 'Invalid sort', 400);
        const items = tree.all().filter(item => path.dirname(item.path) === (parent || '.') && item.path !== parent);
        items.sort((a, b) => sort === 'name' ? collator.compare(a.name, b.name) || collator.compare(a.path, b.path)
          : sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) || collator.compare(a.path, b.path)
          : (b.size || 0) - (a.size || 0) || collator.compare(a.path, b.path));
        return sendJson(res, 200, tree.page(items, url.searchParams.get('cursor'), `list:${parent}:${sort}`));
      }
      if (route === 'search') {
        const q = fold((url.searchParams.get('q') || '').trim());
        const names = tree.all().filter(item => fold(item.name).includes(q))
          .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path));
        let items = names;
        if (q && appDataPath) {
          let index = indexes.get(id);
          if (!index) { index = new SearchIndex(root, appDataPath); indexes.set(id, index); }
          const found = await index.query(q);
          const byPath = new Map(tree.all().filter(item => item.kind === 'document').map(item => [item.path, item]));
          const named = new Set(names.map(item => item.path));
          const content = found.filter(hit => byPath.has(hit.path) && !named.has(hit.path))
            .map(hit => ({ ...byPath.get(hit.path), snippet: hit.snippet }))
            .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path));
          items = [...names, ...content];
        }
        return sendJson(res, 200, tree.page(items, url.searchParams.get('cursor'), `search:${q}`));
      }
      if (route === 'document') {
        const rel = safePath(url.searchParams.get('path'));
        const file = await resolveReadPath(getConsentRegistry(root.path), rel);
        const entry = await entryFor(root, rel);
        if (!entry || entry.kind !== 'document' || !(await fs.stat(file)).isFile()) throw refusal('missing', 'Document is missing', 404);
        const key = `${id}:${rel}`;
        let wireId = wires.get(key);
        if (!wireId) { wireId = nextWireId++; wires.set(key, wireId); }
        const frameUrl = `${roots().find(item => item.id === id).origin}/${rel.split('/').map(encodeURIComponent).join('/')}?workspace-frame=${wireId}`;
        return sendJson(res, 200, { entry, wireId, frameUrl, publicAddress: null,
          workspaceUrl: `${origin}/roots/${encodeURIComponent(id)}/document?path=${encodeURIComponent(rel)}` });
      }
    }

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', reason: 'unsupported' });
    if (url.pathname === '/enter') {
      const ticket = url.searchParams.get('ticket') || '';
      const entry = entries.get(ticket);
      entries.delete(ticket);
      if (!entry || entry.expires < Date.now()) return sendJson(res, 403, { error: 'Forbidden', reason: 'forbidden' });
      res.writeHead(302, {
        Location: `/roots/${encodeURIComponent(entry.rootId)}/files`,
        'Set-Cookie': `${sessionCookie()}=${sessionSecret}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    if (url.pathname === '/' || /^\/roots\/[^/]+\/(files|document)$/.test(url.pathname)) {
      if (!browserAdmitted(req)) return sendJson(res, 403, { error: 'Forbidden', reason: 'forbidden' });
      const css = manifest.entry.css.map(file => `<link rel="stylesheet" href="/${file}">`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="workspace-token" content="${token}">${css}</head><body><div id="workspace-root"></div><script type="module" src="/${manifest.entry.javascript}"></script></body></html>`;
      // The cookie is sent to every 127.0.0.1 port, so a page served from any of them could
      // otherwise frame the workspace and steer clicks into another root.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
      });
      return res.end(html);
    }
    const asset = manifest.assets.find(item => `/${item.path}` === url.pathname);
    if (!asset) return sendJson(res, 404, { error: 'Not found', reason: 'missing' });
    const bytes = await fs.readFile(path.join(assetDir, asset.path));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(asset.path)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  }

  return {
    token, bootstrapSecret,
    autoNamer,
    get origin() { return origin; },
    frame(rootId, rel, wireId) {
      return origin && wires.get(`${rootId}:${rel}`) === wireId ? { wireId, shellOrigin: origin } : null;
    },
    entryUrl(rootId) {
      if (!origin || !(settings().roots || []).some(root => root.id === rootId)) return null;
      const now = Date.now();
      for (const [ticket, entry] of entries) if (entry.expires < now) entries.delete(ticket);
      const ticket = crypto.randomBytes(32).toString('base64url');
      entries.set(ticket, { rootId, expires: now + ENTRY_TTL_MS });
      return `${origin}/enter?ticket=${ticket}`;
    },
    rootsChanged() {
      const current = new Map((settings().roots || []).map(root => [root.id, root.path]));
      for (const [id, tree] of trees) {
        if (current.get(id) !== tree.root.path) {
          tree.unsubscribeAutoName?.(); tree.unsubscribeSearch?.(); tree.close(); trees.delete(id);
          indexes.get(id)?.close().catch(() => {}); indexes.delete(id);
          if (!current.has(id)) autoNamer?.removeRoot(id).catch(error => console.error(`[auto-name] root: ${error.message}`));
        }
      }
      for (const key of wires.keys()) if (!current.has(key.split(':')[0])) wires.delete(key);
      emit({ type: 'roots' });
    },
    connectionChanged(online) { emit({ type: 'connection', online }); },
    syncChanged(rootId, state) { emit({ type: 'sync', rootId, state }); },
    // Browser visits to a root's `/` start the server too, so concurrent callers share one start.
    start() {
      if (origin) return Promise.resolve({ origin });
      starting ??= listen().finally(() => { starting = null; });
      return starting;
    },
    async stop() {
      if (starting) await starting.catch(() => {});
      if (changedTimer) clearTimeout(changedTimer);
      changedPaths.clear();
      for (const tree of trees.values()) { tree.unsubscribeAutoName?.(); tree.unsubscribeSearch?.(); tree.close(); }
      trees.clear();
      await Promise.all([...indexes.values()].map(index => index.close()));
      indexes.clear();
      autoNamer?.close();
      for (const res of subscribers) res.end();
      subscribers.clear();
      entries.clear();
      if (server) await new Promise(resolve => server.close(resolve));
      server = null;
      origin = null;
    },
  };
}

module.exports = { createShellServer };

const crypto = require('crypto');
const fs = require('fs').promises;
const http = require('http');
const path = require('upath');
const { getConsentRegistry, resolveReadPath } = require('../utils/path-resolver');
const { RootTree, entryFor } = require('./tree');
const { executeCommand, safePath, refusal } = require('./commands');
const { handleWorkspaceRoute } = require('./routes');

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

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
  syncManager = () => null, rootTitleFor = root => path.basename(root.path) }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const bootstrapSecret = crypto.randomBytes(32).toString('base64url');
  const epoch = crypto.randomBytes(16).toString('base64url');
  const trees = new Map();
  const wires = new Map();
  const subscribers = new Set();
  const changedPaths = new Map();
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
    for (const rel of paths) held.add(rel);
    if (changedTimer) return;
    changedTimer = setTimeout(() => {
      changedTimer = null;
      for (const [id, names] of changedPaths) if (names.size) emit({ type: 'changed', rootId: id, paths: [...names].sort() });
      changedPaths.clear();
    }, 35);
    changedTimer.unref?.();
  }

  function moved(rootId, from, to) {
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
        const items = tree.all().filter(item => fold(item.name).includes(q))
          .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path));
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
    if (url.pathname === '/' || /^\/roots\/[^/]+\/(files|document)$/.test(url.pathname)) {
      if (req.headers['x-workspace-bootstrap'] !== bootstrapSecret) return sendJson(res, 403, { error: 'Forbidden', reason: 'forbidden' });
      const css = manifest.entry.css.map(file => `<link rel="stylesheet" href="/${file}">`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="workspace-token" content="${token}">${css}</head><body><div id="workspace-root"></div><script type="module" src="/${manifest.entry.javascript}"></script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
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
    get origin() { return origin; },
    frame(rootId, rel, wireId) {
      return origin && wires.get(`${rootId}:${rel}`) === wireId ? { wireId, shellOrigin: origin } : null;
    },
    rootsChanged() {
      const current = new Map((settings().roots || []).map(root => [root.id, root.path]));
      for (const [id, tree] of trees) {
        if (current.get(id) !== tree.root.path) { tree.close(); trees.delete(id); }
      }
      for (const key of wires.keys()) if (!current.has(key.split(':')[0])) wires.delete(key);
      emit({ type: 'roots' });
    },
    connectionChanged(online) { emit({ type: 'connection', online }); },
    syncChanged(rootId, state) { emit({ type: 'sync', rootId, state }); },
    async start() {
      if (server) return { origin };
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
    },
    async stop() {
      if (changedTimer) clearTimeout(changedTimer);
      changedPaths.clear();
      for (const tree of trees.values()) tree.close();
      trees.clear();
      for (const res of subscribers) res.end();
      subscribers.clear();
      if (server) await new Promise(resolve => server.close(resolve));
      server = null;
      origin = null;
    },
  };
}

module.exports = { createShellServer };

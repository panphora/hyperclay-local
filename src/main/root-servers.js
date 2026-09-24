const fs = require('fs').promises;
const http = require('http');
const { createApp, sweepExpiredSnapshots } = require('./server');
const { createRootLive } = require('./utils/root-live');
const { pruneAllVersions } = require('./utils/prune-versions');

const SNAPSHOT_SWEEP_MS = 60 * 1000;

async function isDirectory(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

class RootServer {
  constructor(root, { devHooks, isKnownPath, observer = null, helpers = null, syncEngineFor = null }) {
    this.root = root;
    this.deps = { devHooks, isKnownPath, observer, helpers, syncEngineFor };
    this.app = null;
    this.server = null;
    this.sockets = new Set();
    this.state = 'stopped';
    this.error = null;
  }

  async start() {
    if (this.server) return { ok: true };
    if (!(await isDirectory(this.root.path))) {
      this.state = 'error';
      this.error = 'Folder not found';
      return { ok: false, code: 'error' };
    }
    const ctx = {
      root: this.root,
      live: createRootLive(this.root),
      devHooks: this.deps.devHooks,
      isKnownPath: this.deps.isKnownPath,
      observer: this.deps.observer,
      helpers: this.deps.helpers,
      syncEngineFor: this.deps.syncEngineFor,
    };
    const app = createApp(ctx);
    this.app = app;
    return new Promise((resolve) => {
      const server = http.createServer(app);
      server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
      server.once('error', (err) => {
        this.server = null;
        this.state = err.code === 'EADDRINUSE' ? 'port-taken' : 'error';
        this.error = err.code === 'ENOENT' ? 'Folder not found' : err.message;
        resolve({ ok: false, code: this.state });
      });
      server.listen(this.root.port, '127.0.0.1', () => {
        this.server = server;
        this.state = 'running';
        this.error = null;
        this.pruneVersions();
        resolve({ ok: true });
      });
    });
  }

  pruneVersions() {
    pruneAllVersions(this.root.path)
      .then(({ sites, deleted }) => {
        if (deleted) console.log(`[BACKUP] Startup prune: removed ${deleted} version(s) across ${sites} site(s)`);
      })
      .catch((err) => console.error('[BACKUP] Startup prune failed (non-fatal):', err && err.message ? err.message : err));
  }

  async stop() {
    const server = this.server;
    if (!server) { this.state = 'stopped'; return; }
    this.server = null;
    this.app?.locals?.wireHub?.shutdown();
    this.app?.locals?.helperDispatcher?.stopAll();
    this.app = null;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise((resolve) => server.close(() => resolve()));
    this.state = 'stopped';
  }
}

class RootServerPool {
  constructor(deps) { this.deps = deps; this.servers = new Map(); this.sweepTimer = null; }

  async sync(roots, { enabled }) {
    for (const [id, rs] of this.servers) {
      if (!enabled || !roots.some((r) => r.id === id && r.port === rs.root.port && r.path === rs.root.path)) {
        await rs.stop();
        this.servers.delete(id);
      }
    }
    if (!enabled) {
      this.stopSweep();
      return this.states();
    }
    for (const root of roots) {
      if (!this.servers.has(root.id)) {
        const rs = new RootServer(root, {
          ...this.deps,
          observer: this.deps.observerFor?.(root.id),
          helpers: this.deps.helpersFor?.(root) ?? null,
          syncEngineFor: this.deps.syncEngineForRoot ? () => this.deps.syncEngineForRoot(root.id) : null,
        });
        this.servers.set(root.id, rs);
        await rs.start();
      }
    }
    if (this.servers.size) this.startSweep();
    else this.stopSweep();
    return this.states();
  }

  startSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => sweepExpiredSnapshots(), SNAPSHOT_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  stopSweep() {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async retry(rootId) { const rs = this.servers.get(rootId); return rs ? rs.start() : { ok: false }; }
  get(rootId) { return this.servers.get(rootId) || null; }
  states() { return [...this.servers.values()].map((rs) => ({ rootId: rs.root.id, port: rs.root.port, state: rs.state, error: rs.error })); }
  async stopAll() { for (const rs of this.servers.values()) await rs.stop(); this.servers.clear(); this.stopSweep(); }
}

module.exports = { RootServer, RootServerPool };

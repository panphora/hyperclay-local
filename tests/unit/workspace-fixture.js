const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createShellServer } = require('../../src/main/workspace/shell-server');

async function fixture(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-shell-'));
  const appDataPath = options.appDataPath || await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-app-data-'));
  const root = { id: 'root-a', kind: options.kind || 'personal', path: dir, port: 4321 };
  const observer = new EventEmitter();
  observer.subscribe = listener => { observer.on('raw', listener); return () => observer.off('raw', listener); };
  observer.start = jest.fn();
  const rootServer = { state: 'running', deps: { syncEngineFor: () => options.engine || null } };
  const rootPool = { get: id => id === root.id ? rootServer : null };
  const settings = { roots: [root], syncSessions: options.syncSessions || [] };
  let servedRoot = null;
  const shell = createShellServer({
    authority: options.authority || null, rootPool, observerFor: () => observer,
    checkpoint: options.checkpoint || null, appDataPath,
    syncManager: () => options.syncManager || null,
    settings: () => settings, appVersion: '1.31.1',
    connection: () => ({ online: true, account: { signedIn: false, username: null } }),
    rootTitleFor: () => 'My files',
    onFlushResult: options.onFlushResult, onFlushClientGone: options.onFlushClientGone,
  });
  const close = async () => {
    await shell.stop();
    if (servedRoot) await servedRoot.stop();
    await fs.rm(dir, { recursive: true, force: true });
    if (!options.appDataPath) await fs.rm(appDataPath, { recursive: true, force: true });
  };
  const startRoot = async () => {
    root.port = 0;
    const { RootServer } = require('../../src/main/root-servers');
    servedRoot = new RootServer(root, { workspaceFrame: (...args) => shell.frame(...args) });
    if (!(await servedRoot.start()).ok) throw new Error('Root server did not start');
    root.port = servedRoot.server.address().port;
    return servedRoot;
  };
  const start = async () => {
    await shell.start();
    const request = async (route, options = {}) => {
      const headers = { 'X-Workspace-Token': shell.token, ...options.headers };
      return fetch(shell.origin + route, { ...options, headers });
    };
    return request;
  };
  return { dir, root, rootServer, rootPool, settings, observer, shell, start, startRoot, close };
}

module.exports = { fixture };

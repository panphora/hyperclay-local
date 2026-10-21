const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createShellServer } = require('../../src/main/workspace/shell-server');

async function fixture(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-shell-'));
  const root = { id: 'root-a', kind: 'personal', path: dir, port: 4321 };
  const observer = new EventEmitter();
  observer.subscribe = listener => { observer.on('raw', listener); return () => observer.off('raw', listener); };
  observer.start = jest.fn();
  const rootServer = { state: 'running', deps: { syncEngineFor: () => options.engine || null } };
  const rootPool = { get: id => id === root.id ? rootServer : null };
  const settings = { roots: [root], syncSessions: [] };
  const shell = createShellServer({
    authority: options.authority || null, rootPool, observerFor: () => observer,
    settings: () => settings, appVersion: '1.31.1',
    connection: () => ({ online: true, account: { signedIn: false, username: null } }),
    rootTitleFor: () => 'My files',
  });
  const close = async () => { await shell.stop(); await fs.rm(dir, { recursive: true, force: true }); };
  const start = async () => {
    await shell.start();
    const request = async (route, options = {}) => {
      const headers = { 'X-Workspace-Token': shell.token, ...options.headers };
      return fetch(shell.origin + route, { ...options, headers });
    };
    return request;
  };
  return { dir, root, rootServer, rootPool, settings, observer, shell, start, close };
}

module.exports = { fixture };

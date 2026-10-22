const path = require('upath');
const { offlineSession, protocolMismatch } = require('./offline-session');
const { isAllowedExternalUrl } = require('../ui/main-ipc');

const GRANTED = new Set(['clipboard-sanitized-write', 'fullscreen']);

function originOf(value) {
  try { return new URL(value).origin; } catch { return null; }
}

function createWorkspaceWindow({ electron = require('electron'), shellServer, roots, onFlushResult = () => false,
  onRendererGone = () => {},
  sessionForWindow = offlineSession, mismatch = protocolMismatch, platform = process.platform } = {}) {
  const { BrowserWindow, ipcMain, app, shell } = electron;
  let window = null;
  let starting = null;
  let permissionSession = null;
  let flushListeners = 0;
  const shellOrigin = () => shellServer.origin;
  const rootFor = origin => roots().find(root => origin === `http://localhost:${root.port}` && root.state === 'running');
  const isRoot = value => !!rootFor(originOf(value));
  const isShell = value => originOf(value) === shellOrigin();
  const allowedNavigation = (value, isMainFrame) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:') return false;
      return isMainFrame ? isShell(value) : isRoot(value) && !isShell(value);
    } catch { return false; }
  };
  const trusted = event => !!(window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && isShell(event.senderFrame.url));
  const outside = value => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { return false; }
  };
  const open = url => { shell.openExternal(url); return { ok: true }; };
  const external = url => outside(url) ? open(url) : { ok: false, error: 'blocked' };
  ipcMain.handle('workspace-open-external', (event, url) => {
    if (!trusted(event)) return { ok: false, error: 'forbidden' };
    return isAllowedExternalUrl(url) || isRoot(url) ? open(url) : external(url);
  });
  ipcMain.handle('workspace-flush-result', (event, result) => trusted(event) ? onFlushResult(result) : false);
  ipcMain.on('workspace-flush-listener', (event, added) => {
    if (!trusted(event) || (added !== true && added !== false)) return;
    flushListeners = added ? flushListeners + 1 : Math.max(0, flushListeners - 1);
  });

  function refusePermission(origin, permission) {
    if (window && !window.isDestroyed()) window.webContents.send('workspace-permission-refused', { origin, permission });
  }

  function installPermissions(session) {
    if (permissionSession === session) return;
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      const origin = originOf(details.requestingUrl);
      const grant = contents === window?.webContents && !details.isMainFrame && isRoot(details.requestingUrl) && GRANTED.has(permission);
      if (!grant) refusePermission(origin, permission);
      callback(grant);
    });
    session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      // Chromium runs checks on its own while a page loads, so only a refused request tells the window.
      return contents === window?.webContents && !details.isMainFrame && isRoot(requestingOrigin) && GRANTED.has(permission);
    });
    session.setDevicePermissionHandler(() => false);
    for (const permission of ['hid', 'serial', 'usb']) {
      session.on(`select-${permission === 'serial' ? 'serial-port' : `${permission}-device`}`, (event, _devices, ...rest) => {
        event.preventDefault();
        rest.at(-1)(permission === 'serial' ? '' : undefined);
        refusePermission(null, permission);
      });
    }
    session.on('will-download', (event, item, contents) => {
      if (contents !== window?.webContents) { event.preventDefault(); return; }
      const url = item.getURL();
      if (isShell(url) && /^\/api\/roots\/[^/]+\/download$/.test(new URL(url).pathname)) return;
      const root = rootFor(originOf(url));
      event.preventDefault();
      if (!root) return;
      const parsed = new URL(url);
      let rel;
      try { rel = parsed.pathname.slice(1).split('/').map(decodeURIComponent).join('/'); } catch { return; }
      if (!rel || rel.split('/').some(part => !part || part === '.' || part === '..')) return;
      const route = `${shellOrigin()}/api/roots/${encodeURIComponent(root.id)}/download?path=${encodeURIComponent(rel)}`;
      contents.downloadURL(route, { headers: { 'X-Workspace-Token': shellServer.token } });
    });
    permissionSession = session;
  }

  function show() {
    window.show();
    window.focus();
    if (platform === 'darwin') app.dock.show();
  }

  function destroy() {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
    flushListeners = 0;
    if (platform === 'darwin') app.dock.hide();
  }

  function resolvePath(value) {
    if (value == null) return shellOrigin();
    const url = new URL(value, shellOrigin());
    if (!allowedNavigation(url.href, true) || !/^\/roots\/[A-Za-z0-9_-]+\/(files|document)$/.test(url.pathname)) {
      throw new Error('Invalid workspace path');
    }
    return url.href;
  }

  async function openWorkspace({ path: requestedPath } = {}) {
    if (window && !window.isDestroyed()) {
      show();
      if (requestedPath != null) window.webContents.send('workspace-navigate', resolvePath(requestedPath));
      return window;
    }
    if (starting) return starting;
    starting = (async () => {
      await shellServer.start();
      const target = resolvePath(requestedPath);
      const dedicated = sessionForWindow();
      window = new BrowserWindow({ width: 1200, height: 800, show: false, title: 'Hyperclay Local',
        webPreferences: { session: dedicated, preload: path.join(__dirname, 'workspace-preload.js'),
          contextIsolation: true, sandbox: true, nodeIntegration: false } });
      const current = window;
      flushListeners = 0;
      installPermissions(dedicated);
      current.on('close', event => {
        event.preventDefault();
        current.hide();
        if (platform === 'darwin') app.dock.hide();
      });
      current.on('closed', () => { flushListeners = 0; if (window === current) window = null; });
      current.webContents.on('render-process-gone', () => { flushListeners = 0; onRendererGone(); });
      current.webContents.on('did-navigate', () => { flushListeners = 0; });
      current.webContents.on('select-bluetooth-device', (event, _devices, callback) => {
        event.preventDefault();
        callback('');
        refusePermission(null, 'bluetooth');
      });
      const guard = (event, url, isMainFrame, openLink = false) => {
        if (allowedNavigation(url, isMainFrame)) return;
        event.preventDefault();
        if (openLink) external(url);
      };
      current.webContents.on('will-navigate', event => guard(event, event.url, true));
      current.webContents.on('will-frame-navigate', event => guard(event, event.url, event.isMainFrame, true));
      current.webContents.on('will-redirect', event => guard(event, event.url, event.isMainFrame));
      current.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
      if (mismatch()) {
        await current.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
          '<!doctype html><meta charset="utf-8"><title>Hyperclay Local</title><p>Update Hyperclay Local to open this workspace.</p>'));
      } else {
        await current.loadURL(target, { extraHeaders: `X-Workspace-Bootstrap: ${shellServer.bootstrapSecret}` });
      }
      show();
      return current;
    })().finally(() => { starting = null; });
    return starting;
  }

  return {
    openWorkspace, destroy, show: () => { if (window && !window.isDestroyed()) show(); },
    hasWindow: () => !!(window && !window.isDestroyed()),
    hasFlushListener: () => flushListeners > 0,
    requestFlush: requestId => window?.webContents.send('workspace-flush-request', { requestId }),
    allowedNavigation,
  };
}

module.exports = { createWorkspaceWindow };

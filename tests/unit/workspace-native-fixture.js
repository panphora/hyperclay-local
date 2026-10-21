const { EventEmitter } = require('events');
const { createWorkspaceWindow } = require('../../src/main/workspace/window');

function nativeFixture(overrides = {}) {
  const handlers = new Map();
  const windows = [];
  const session = new EventEmitter();
  session.setPermissionRequestHandler = handler => { session.requestPermission = handler; };
  session.setPermissionCheckHandler = handler => { session.checkPermission = handler; };
  session.setDevicePermissionHandler = handler => { session.devicePermission = handler; };
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) };
  const dock = { show: jest.fn(), hide: jest.fn() };
  const external = jest.fn();
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: 'http://127.0.0.1:7000/' };
      this.webContents.send = jest.fn();
      this.webContents.downloadURL = jest.fn();
      this.webContents.setWindowOpenHandler = handler => { this.webContents.windowOpen = handler; };
      this.loadURL = jest.fn(async (url, options) => { this.loaded = { url, options }; });
      this.show = jest.fn();
      this.focus = jest.fn();
      this.hide = jest.fn();
      this.destroy = jest.fn(() => { this.destroyed = true; this.emit('closed'); });
      this.isDestroyed = () => !!this.destroyed;
      windows.push(this);
    }
  }
  const shellServer = { origin: null, token: 'token', bootstrapSecret: 'secret',
    start: jest.fn(async () => { shellServer.origin = 'http://127.0.0.1:7000'; }) };
  const roots = [{ id: 'root-a', port: 4321, state: 'running' }];
  const workspace = createWorkspaceWindow({
    electron: { BrowserWindow: FakeWindow, ipcMain, app: { dock }, shell: { openExternal: external } },
    shellServer, roots: () => roots, sessionForWindow: () => session, mismatch: () => false,
    platform: 'darwin', ...overrides,
  });
  return { workspace, windows, session, handlers, dock, external, shellServer, roots };
}

module.exports = { nativeFixture };

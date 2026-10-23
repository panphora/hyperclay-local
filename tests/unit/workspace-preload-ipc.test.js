const fs = require('fs');
const os = require('os');
const path = require('path');
const { nativeFixture } = require('./workspace-native-fixture');

test('only the owned shell main frame can answer a flush or open an external link', async () => {
  const accepted = jest.fn(() => true);
  const h = nativeFixture({ onFlushResult: accepted });
  const win = await h.workspace.openWorkspace();
  const result = { requestId: 1, participants: [] };
  const trusted = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  expect(h.handlers.get('workspace-flush-result')(trusted, result)).toBe(true);
  expect(accepted).toHaveBeenCalledWith(result);
  const child = { sender: win.webContents, senderFrame: { url: 'http://localhost:4321/A.html' } };
  expect(h.handlers.get('workspace-flush-result')(child, result)).toBe(false);
  expect(h.handlers.get('workspace-open-external')(child, 'https://hyperclay.com/docs')).toEqual({ ok: false, error: 'forbidden' });
  expect(h.handlers.get('workspace-open-external')({ sender: {}, senderFrame: win.webContents.mainFrame }, 'https://hyperclay.com/docs')).toEqual({ ok: false, error: 'forbidden' });
  expect(h.handlers.get('workspace-open-external')(trusted, 'javascript:alert(1)')).toEqual({ ok: false, error: 'blocked' });
  expect(h.handlers.get('workspace-open-external')(trusted, 'https://hyperclay.com/docs')).toEqual({ ok: true });
  expect(h.handlers.get('workspace-open-external')(trusted, 'http://localhost:4321/A.html')).toEqual({ ok: true });
  expect(h.handlers.get('workspace-open-external')(trusted, 'http://localhost:9999/A.html')).toEqual({ ok: false, error: 'blocked' });
});

test('show in folder reveals only a file inside a registered root, for the shell main frame', async () => {
  const h = nativeFixture();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reveal-')));
  fs.mkdirSync(path.join(dir, 'Notes'));
  fs.writeFileSync(path.join(dir, 'Notes', 'a.html'), '<p>a</p>');
  h.roots[0].path = dir;
  const win = await h.workspace.openWorkspace();
  const trusted = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const child = { sender: win.webContents, senderFrame: { url: 'http://localhost:4321/A.html' } };
  const show = (event, request) => h.handlers.get('workspace-show-in-folder')(event, request);
  await expect(show(child, { rootId: 'root-a', path: 'Notes/a.html' })).resolves.toEqual({ ok: false, error: 'forbidden' });
  await expect(show(trusted, { rootId: 'root-b', path: 'Notes/a.html' })).resolves.toEqual({ ok: false, error: 'unknown' });
  await expect(show(trusted, { rootId: 'root-a', path: '../outside.html' })).resolves.toEqual({ ok: false, error: 'missing' });
  await expect(show(trusted, { rootId: 'root-a', path: 'Notes/gone.html' })).resolves.toEqual({ ok: false, error: 'missing' });
  expect(h.reveal).not.toHaveBeenCalled();
  await expect(show(trusted, { rootId: 'root-a', path: 'Notes/a.html' })).resolves.toEqual({ ok: true });
  expect(h.reveal).toHaveBeenCalledWith(path.join(dir, 'Notes', 'a.html'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a flush listener tells the main process when it registers and when it unsubscribes', () => {
  const sent = [];
  const listeners = new Map();
  let exposed;
  jest.isolateModules(() => {
    jest.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
      ipcRenderer: {
        on: (channel, listener) => listeners.set(channel, listener),
        removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
        send: (channel, value) => sent.push([channel, value]),
        invoke: jest.fn(),
      },
    }));
    require('../../src/main/workspace/workspace-preload');
  });
  jest.dontMock('electron');
  expect(() => exposed.onFlushRequest(null)).toThrow(TypeError);
  expect(sent).toEqual([]);
  const stop = exposed.onFlushRequest(() => {});
  expect(listeners.has('workspace-flush-request')).toBe(true);
  expect(sent).toEqual([['workspace-flush-listener', true]]);
  stop();
  expect(listeners.has('workspace-flush-request')).toBe(false);
  expect(sent).toEqual([['workspace-flush-listener', true], ['workspace-flush-listener', false]]);
});

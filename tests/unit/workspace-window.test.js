const { nativeFixture } = require('./workspace-native-fixture');

test('starts the shell once, uses the dedicated session and preload, then focuses and navigates one window', async () => {
  const h = nativeFixture();
  const first = await h.workspace.openWorkspace({ path: '/roots/root-a/document?path=A.html' });
  expect(h.shellServer.start).toHaveBeenCalledTimes(1);
  expect(first.options.webPreferences).toMatchObject({ session: h.session, contextIsolation: true, sandbox: true, nodeIntegration: false });
  expect(first.options.webPreferences.preload).toMatch(/workspace-preload\.js$/);
  expect(first.loaded).toEqual({ url: 'http://127.0.0.1:7000/roots/root-a/document?path=A.html',
    options: { extraHeaders: 'X-Workspace-Bootstrap: secret' } });
  await h.workspace.openWorkspace({ path: '/roots/root-a/files' });
  expect(h.windows).toHaveLength(1);
  expect(first.webContents.send).toHaveBeenCalledWith('workspace-navigate', 'http://127.0.0.1:7000/roots/root-a/files');
  expect(first.focus).toHaveBeenCalledTimes(2);
  const close = { preventDefault: jest.fn() };
  first.emit('close', close);
  expect(close.preventDefault).toHaveBeenCalled();
  expect(first.hide).toHaveBeenCalled();
  expect(h.dock.hide).toHaveBeenCalled();
});

test('protocol mismatch loads only the update page', async () => {
  const h = nativeFixture({ mismatch: () => true });
  const win = await h.workspace.openWorkspace();
  expect(decodeURIComponent(win.loaded.url)).toContain('Update Hyperclay Local to open this workspace.');
  expect(win.loaded.options).toBeUndefined();
});

test('the flush listener count follows the trusted renderer and resets with its page', async () => {
  const h = nativeFixture();
  const win = await h.workspace.openWorkspace();
  const listener = h.handlers.get('workspace-flush-listener');
  const trusted = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const child = { sender: win.webContents, senderFrame: { url: 'http://localhost:4321/A.html' } };
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener(child, true);
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener(trusted, true);
  expect(h.workspace.hasFlushListener()).toBe(true);
  listener(child, false);
  expect(h.workspace.hasFlushListener()).toBe(true);
  listener(trusted, 'yes');
  expect(h.workspace.hasFlushListener()).toBe(true);
  listener(trusted, false);
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener(trusted, false);
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener(trusted, true);
  listener(trusted, true);
  expect(h.workspace.hasFlushListener()).toBe(true);
  listener(trusted, false);
  expect(h.workspace.hasFlushListener()).toBe(true);
  win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: 'http://127.0.0.1:7000/roots/root-a/files' });
  win.webContents.emit('did-navigate-in-page', {}, 'http://127.0.0.1:7000/roots/root-a/files', true);
  expect(h.workspace.hasFlushListener()).toBe(true);
  win.webContents.emit('did-navigate', {}, 'http://127.0.0.1:7000/roots/root-a/files');
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener(trusted, true);
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener(trusted, true);
  expect(h.workspace.hasFlushListener()).toBe(true);
  h.workspace.destroy();
  expect(h.workspace.hasFlushListener()).toBe(false);
  const recreated = await h.workspace.openWorkspace();
  expect(recreated).not.toBe(win);
  expect(h.workspace.hasFlushListener()).toBe(false);
  listener({ sender: recreated.webContents, senderFrame: recreated.webContents.mainFrame }, true);
  expect(h.workspace.hasFlushListener()).toBe(true);
});

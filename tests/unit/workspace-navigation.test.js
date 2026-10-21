const { nativeFixture } = require('./workspace-native-fixture');

test('main and frame navigation and redirects accept only their registered origins', async () => {
  const h = nativeFixture();
  const win = await h.workspace.openWorkspace();
  const visit = (channel, url, isMainFrame) => {
    const event = { url, isMainFrame, preventDefault: jest.fn() };
    win.webContents.emit(channel, event);
    return event.preventDefault.mock.calls.length;
  };
  expect(visit('will-navigate', `${h.shellServer.origin}/roots/root-a/files`, true)).toBe(0);
  expect(visit('will-frame-navigate', 'http://localhost:4321/A.html', false)).toBe(0);
  expect(visit('will-frame-navigate', `${h.shellServer.origin}/`, false)).toBe(1);
  expect(visit('will-frame-navigate', 'http://localhost:9999/A.html', false)).toBe(1);
  expect(visit('will-redirect', 'file:///tmp/a.html', false)).toBe(1);
  expect(visit('will-redirect', 'javascript:alert(1)', true)).toBe(1);
  expect(visit('will-redirect', 'http://localhost:4321/A.html', true)).toBe(1);
  expect(visit('will-frame-navigate', 'https://hyperclay.com/docs', true)).toBe(1);
  expect(h.external).toHaveBeenCalledTimes(1);
  expect(visit('will-redirect', 'https://hyperclay.com/docs', true)).toBe(1);
  expect(h.external).toHaveBeenCalledTimes(1);
  expect(win.webContents.windowOpen({ url: 'https://hyperclay.com/docs' })).toEqual({ action: 'deny' });
  expect(h.external).toHaveBeenCalledWith('https://hyperclay.com/docs');
  win.webContents.windowOpen({ url: 'file:///tmp/a.html' });
  expect(h.external).toHaveBeenCalledTimes(2);
  win.webContents.windowOpen({ url: 'https://example.com/article' });
  expect(h.external).toHaveBeenLastCalledWith('https://example.com/article');
  expect(visit('will-frame-navigate', 'https://example.com/next', false)).toBe(1);
  expect(h.external).toHaveBeenLastCalledWith('https://example.com/next');
  expect(h.external).toHaveBeenCalledTimes(4);
  win.webContents.windowOpen({ url: 'http://localhost:9999/A.html' });
  expect(visit('will-frame-navigate', 'http://127.0.0.1:9999/A.html', false)).toBe(1);
  expect(h.external).toHaveBeenCalledTimes(4);
});

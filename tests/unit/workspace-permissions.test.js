const { nativeFixture } = require('./workspace-native-fixture');

test('handlers are installed before load and only grant two root frame permissions', async () => {
  const h = nativeFixture();
  const win = await h.workspace.openWorkspace();
  expect(h.session.requestPermission).toBeDefined();
  expect(h.session.checkPermission).toBeDefined();
  expect(h.session.devicePermission({ deviceType: 'hid' })).toBe(false);
  const ask = (permission, requestingUrl, isMainFrame = false) => {
    const callback = jest.fn();
    h.session.requestPermission(win.webContents, permission, callback, { requestingUrl, isMainFrame });
    return callback.mock.calls[0][0];
  };
  expect(ask('clipboard-sanitized-write', 'http://localhost:4321/A.html')).toBe(true);
  expect(ask('fullscreen', 'http://localhost:4321/A.html')).toBe(true);
  for (const permission of ['media', 'display-capture', 'geolocation', 'notifications', 'midi', 'hid', 'serial', 'usb', 'bluetooth', 'idle-detection', 'pointerLock']) {
    expect(ask(permission, 'http://localhost:4321/A.html')).toBe(false);
  }
  expect(ask('fullscreen', 'http://localhost:9999/A.html')).toBe(false);
  expect(ask('fullscreen', h.shellServer.origin, true)).toBe(false);
  expect(h.session.checkPermission(win.webContents, 'media', 'http://localhost:4321', { isMainFrame: false })).toBe(false);
  expect(win.webContents.send).toHaveBeenCalledWith('workspace-permission-refused', { origin: 'http://localhost:4321', permission: 'media' });
  const event = { preventDefault: jest.fn() };
  const cancel = jest.fn();
  win.webContents.emit('select-bluetooth-device', event, [], cancel);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledWith('');
  expect(win.webContents.send).toHaveBeenCalledWith('workspace-permission-refused', { origin: null, permission: 'bluetooth' });
  for (const [name, permission] of [['select-hid-device', 'hid'], ['select-serial-port', 'serial'], ['select-usb-device', 'usb']]) {
    const choice = jest.fn();
    const selection = { preventDefault: jest.fn() };
    h.session.emit(name, selection, [], win.webContents, choice);
    expect(selection.preventDefault).toHaveBeenCalled();
    expect(choice).toHaveBeenCalledWith(permission === 'serial' ? '' : undefined);
  }
});

test('root downloads use the token protected shell route', async () => {
  const h = nativeFixture();
  const win = await h.workspace.openWorkspace();
  const cancel = jest.fn();
  h.session.emit('will-download', { preventDefault: cancel }, { getURL: () => 'http://localhost:4321/A%20B.html' }, win.webContents);
  expect(cancel).toHaveBeenCalled();
  expect(win.webContents.downloadURL).toHaveBeenCalledWith(
    'http://127.0.0.1:7000/api/roots/root-a/download?path=A%20B.html',
    { headers: { 'X-Workspace-Token': 'token' } });
});

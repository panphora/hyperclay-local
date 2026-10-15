const { EventEmitter } = require('events');
const { createUpdater, canInstallInPlace } = require('../../src/main/updater');

function fakeAutoUpdater() {
  const updater = new EventEmitter();
  updater.setFeedURL = jest.fn();
  updater.checkForUpdates = jest.fn().mockResolvedValue(null);
  updater.quitAndInstall = jest.fn();
  return updater;
}

const noTimers = { setTimeout: () => {}, setInterval: () => {} };
const silent = { log: () => {} };

describe('canInstallInPlace', () => {
  const base = { platform: 'darwin', isPackaged: true, canWrite: () => true };

  test('a writable bundle in Applications can install in place', () => {
    expect(canInstallInPlace({ ...base, exePath: '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal' })).toBe(true);
  });

  test('translocated, disk-image and unwritable copies cannot', () => {
    expect(canInstallInPlace({ ...base, exePath: '/private/var/folders/x/AppTranslocation/ABC/d/HyperclayLocal.app/Contents/MacOS/HyperclayLocal' })).toBe(false);
    expect(canInstallInPlace({ ...base, exePath: '/Volumes/HyperclayLocal/HyperclayLocal.app/Contents/MacOS/HyperclayLocal' })).toBe(false);
    expect(canInstallInPlace({ ...base, canWrite: () => false, exePath: '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal' })).toBe(false);
  });

  test('other platforms and dev runs never install in place', () => {
    expect(canInstallInPlace({ ...base, platform: 'win32', exePath: 'C:\\x\\HyperclayLocal.exe' })).toBe(false);
    expect(canInstallInPlace({ ...base, isPackaged: false, exePath: '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal' })).toBe(false);
  });
});

describe('install mode', () => {
  function setup(prepareForInstall = jest.fn().mockResolvedValue()) {
    const autoUpdater = fakeAutoUpdater();
    const nativeUpdater = new EventEmitter();
    const changes = [];
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace: true,
      autoUpdater,
      nativeUpdater,
      fetchJson: jest.fn(),
      prepareForInstall,
      onChange: (info) => changes.push(info),
      logger: silent,
      timers: noTimers
    });
    updater.start();
    return { updater, autoUpdater, nativeUpdater, changes, prepareForInstall };
  }

  test('points electron-updater at the stable feed and downloads in the background', () => {
    const { autoUpdater } = setup();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://local.hyperclay.com/updates/stable' });
    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  test('is ready only once Squirrel has staged the update', () => {
    const { updater, autoUpdater, nativeUpdater } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    expect(updater.get()).toMatchObject({ state: 'downloading', latestVersion: '1.31.0' });
    autoUpdater.emit('update-downloaded', { version: '1.31.0' });
    expect(updater.get().state).toBe('downloading');
    nativeUpdater.emit('update-downloaded');
    expect(updater.get()).toMatchObject({ mode: 'install', state: 'ready', latestVersion: '1.31.0' });
  });

  test('install drains and shuts down before handing over', async () => {
    const { updater, autoUpdater, nativeUpdater, prepareForInstall } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await expect(updater.install()).resolves.toEqual({ ok: true });
    expect(prepareForInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('a busy sync cancels the install and keeps the update ready', async () => {
    const { updater, autoUpdater, nativeUpdater } = setup(jest.fn().mockRejectedValue(new Error('Sync is still running. Try again in a moment.')));
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await expect(updater.install()).resolves.toMatchObject({ ok: false });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.get()).toMatchObject({ state: 'ready', error: 'Sync is still running. Try again in a moment.' });
  });

  test('install before the update is staged does nothing', async () => {
    const { updater, autoUpdater, prepareForInstall } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    await expect(updater.install()).resolves.toEqual({ ok: false });
    expect(prepareForInstall).not.toHaveBeenCalled();
  });

  test('a download error hides the update until the next check', () => {
    const { updater, autoUpdater } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('error', new Error('network'));
    expect(updater.get()).toBeNull();
  });
});

describe('link mode', () => {
  function setup(receipt) {
    const changes = [];
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace: false,
      autoUpdater: null,
      nativeUpdater: null,
      fetchJson: jest.fn().mockResolvedValue(receipt),
      prepareForInstall: jest.fn(),
      onChange: (info) => changes.push(info),
      logger: silent,
      timers: noTimers
    });
    return { updater, changes };
  }

  test('a newer published receipt offers the download link', async () => {
    const { updater } = setup({ version: '1.31.0' });
    await updater.check();
    expect(updater.get()).toMatchObject({ mode: 'link', state: 'available', latestVersion: '1.31.0' });
  });

  test('the same or an older receipt offers nothing', async () => {
    const { updater } = setup({ version: '1.30.3' });
    await updater.check();
    expect(updater.get()).toBeNull();
  });

  test('install is refused in link mode', async () => {
    const { updater } = setup({ version: '1.31.0' });
    await updater.check();
    await expect(updater.install()).resolves.toEqual({ ok: false });
  });
});

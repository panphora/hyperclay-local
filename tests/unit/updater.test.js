const { EventEmitter } = require('events');
const { UUID } = require('builder-util-runtime');
const { createUpdater, canInstallInPlace, parseInstallLocation, readWindowsInstallLocation, WINDOWS_INSTALL_KEY } = require('../../src/main/updater');

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
    expect(canInstallInPlace({ ...base, platform: 'linux', exePath: '/tmp/.mount_x/hyperclay-local-electron' })).toBe(false);
    expect(canInstallInPlace({ ...base, isPackaged: false, exePath: '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal' })).toBe(false);
  });
});

describe('canInstallInPlace on Windows', () => {
  const exePath = 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal\\HyperclayLocal.exe';
  const base = { platform: 'win32', isPackaged: true, exePath, canWrite: () => true };

  test('a per-user NSIS install running from its recorded folder can install in place', () => {
    expect(canInstallInPlace({ ...base, installLocation: 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal' })).toBe(true);
    expect(canInstallInPlace({ ...base, installLocation: 'c:\\users\\ana\\appdata\\local\\programs\\hyperclaylocal\\' })).toBe(true);
  });

  test('per-machine, portable, moved and unwritable copies keep the download link', () => {
    expect(canInstallInPlace({ ...base, installLocation: null })).toBe(false);
    expect(canInstallInPlace({ ...base, installLocation: 'D:\\Apps\\HyperclayLocal' })).toBe(false);
    expect(canInstallInPlace({ ...base, installLocation: 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal', canWrite: () => false })).toBe(false);
    expect(canInstallInPlace({ ...base, isPackaged: false, installLocation: 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal' })).toBe(false);
  });

  test('the registry key is the one electron-builder derives from the appId', () => {
    const appId = require('../../package.json').build.appId;
    const guid = UUID.v5(appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
    expect(WINDOWS_INSTALL_KEY).toBe(`HKCU\\Software\\${guid}`);
  });

  test('reads InstallLocation out of reg query output', () => {
    const output = '\r\nHKEY_CURRENT_USER\\Software\\56279e69-a1ca-58cc-a483-19be13420d85\r\n    InstallLocation    REG_SZ    C:\\Users\\ana\\AppData\\Local\\Programs\\Hyperclay Local\r\n\r\n';
    expect(parseInstallLocation(output)).toBe('C:\\Users\\ana\\AppData\\Local\\Programs\\Hyperclay Local');
    expect(parseInstallLocation('')).toBeNull();
    const exec = jest.fn(() => output);
    expect(readWindowsInstallLocation(exec)).toBe('C:\\Users\\ana\\AppData\\Local\\Programs\\Hyperclay Local');
    expect(exec.mock.calls[0][1]).toEqual(['query', WINDOWS_INSTALL_KEY, '/v', 'InstallLocation']);
    expect(readWindowsInstallLocation(() => { throw new Error('ERROR: The system was unable to find the specified registry key or value.'); })).toBeNull();
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
      installOnQuit: true,
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
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
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

describe('install mode on Windows (NSIS)', () => {
  function setup(prepareForInstall = jest.fn().mockResolvedValue()) {
    const autoUpdater = fakeAutoUpdater();
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace: true,
      autoUpdater,
      nativeUpdater: null,
      fetchJson: jest.fn(),
      prepareForInstall,
      onChange: () => {},
      logger: silent,
      timers: noTimers
    });
    updater.start();
    return { updater, autoUpdater, prepareForInstall };
  }

  test('downloads full signed installers and never installs on a plain quit', () => {
    const { autoUpdater } = setup();
    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(autoUpdater.disableWebInstaller).toBe(true);
    expect(autoUpdater.disableDifferentialDownload).toBe(true);
  });

  test("is ready on electron-updater's own downloaded event", () => {
    const { updater, autoUpdater } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    expect(updater.get().state).toBe('downloading');
    autoUpdater.emit('update-downloaded', { version: '1.31.0' });
    expect(updater.get()).toMatchObject({ mode: 'install', state: 'ready', latestVersion: '1.31.0' });
  });

  test('a click drains, then runs the installer silently and relaunches', async () => {
    const { updater, autoUpdater, prepareForInstall } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('update-downloaded', { version: '1.31.0' });
    await expect(updater.install()).resolves.toEqual({ ok: true });
    expect(prepareForInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(prepareForInstall.mock.invocationCallOrder[0]).toBeLessThan(autoUpdater.quitAndInstall.mock.invocationCallOrder[0]);
  });

  test('a rejected signature leaves nothing to install', () => {
    const { updater, autoUpdater } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('error', new Error('New version 1.31.0 is not signed by the application owner'));
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

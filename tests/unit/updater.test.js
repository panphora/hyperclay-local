const { EventEmitter } = require('events');
const { UUID } = require('builder-util-runtime');
const { createUpdater, canInstallInPlace, parseUpdateNowArg, parseInstallLocation, readWindowsInstallLocation, WINDOWS_INSTALL_KEY, WINDOWS_MACHINE_INSTALL_KEY, REQUEST_TTL_MS } = require('../../src/main/updater');

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

  test('a per-user install beside a per-machine one keeps the download link', () => {
    expect(canInstallInPlace({ ...base, installLocation: 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal', machineInstallLocation: 'C:\\Program Files\\HyperclayLocal' })).toBe(false);
    expect(canInstallInPlace({ ...base, installLocation: 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal', machineInstallLocation: 'C:\\Program Files\\HyperclayLocal', exists: () => true })).toBe(false);
  });

  test('a per-machine entry whose folder no longer exists is ignored, as the installer ignores it', () => {
    const exists = jest.fn(() => false);
    expect(canInstallInPlace({ ...base, installLocation: 'C:\\Users\\ana\\AppData\\Local\\Programs\\HyperclayLocal', machineInstallLocation: 'C:\\Program Files\\HyperclayLocal', exists })).toBe(true);
    expect(exists).toHaveBeenCalledWith('C:\\Program Files\\HyperclayLocal');
  });

  test('a per-user install in a folder the user chose can install in place', () => {
    const chosen = 'D:\\Apps\\Hyperclay Local';
    expect(canInstallInPlace({ ...base, exePath: `${chosen}\\HyperclayLocal.exe`, installLocation: chosen })).toBe(true);
  });

  test('the per-machine key is read from HKLM under the same guid', () => {
    expect(WINDOWS_MACHINE_INSTALL_KEY).toBe(WINDOWS_INSTALL_KEY.replace(/^HKCU/, 'HKLM'));
    const exec = jest.fn(() => '    InstallLocation    REG_SZ    C:\\Program Files\\HyperclayLocal\r\n');
    expect(readWindowsInstallLocation(exec, WINDOWS_MACHINE_INSTALL_KEY)).toBe('C:\\Program Files\\HyperclayLocal');
    expect(exec.mock.calls[0][1]).toEqual(['query', WINDOWS_MACHINE_INSTALL_KEY, '/v', 'InstallLocation']);
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

describe('canInstallInPlace for an AppImage', () => {
  const base = { platform: 'linux', isPackaged: true, exePath: '/tmp/.mount_x/hyperclay-local-electron', canWrite: () => true, hasUpdateKeys: true };

  test('a writable AppImage with a release key compiled in can swap itself', () => {
    expect(canInstallInPlace({ ...base, appImage: '/home/ana/Apps/HyperclayLocal.AppImage' })).toBe(true);
  });

  test('no APPIMAGE, no key, or an unwritable folder keeps the download link', () => {
    expect(canInstallInPlace({ ...base, appImage: null })).toBe(false);
    expect(canInstallInPlace({ ...base, appImage: 'relative.AppImage' })).toBe(false);
    expect(canInstallInPlace({ ...base, appImage: '/home/ana/Apps/HyperclayLocal.AppImage', hasUpdateKeys: false })).toBe(false);
    expect(canInstallInPlace({ ...base, appImage: '/opt/HyperclayLocal.AppImage', canWrite: (target) => target !== '/opt' })).toBe(false);
  });
});

describe('install mode for an AppImage', () => {
  function setup({ verifyDownload = jest.fn().mockResolvedValue(), prepareForInstall = jest.fn().mockResolvedValue() } = {}) {
    const autoUpdater = fakeAutoUpdater();
    const commitInstall = jest.fn();
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace: true,
      autoUpdater,
      nativeUpdater: null,
      fetchJson: jest.fn(),
      prepareForInstall,
      verifyDownload,
      commitInstall,
      onChange: () => {},
      logger: silent,
      timers: noTimers
    });
    updater.start();
    return { updater, autoUpdater, commitInstall, verifyDownload, prepareForInstall };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  test('is ready only after our own checks pass, and never installs on quit', async () => {
    const { updater, autoUpdater, verifyDownload } = setup();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    autoUpdater.emit('update-available', { version: '1.31.0' });
    const info = { version: '1.31.0', downloadedFile: '/cache/HyperclayLocal-1.31.0.AppImage' };
    autoUpdater.emit('update-downloaded', info);
    expect(updater.get().state).toBe('downloading');
    await flush();
    expect(verifyDownload).toHaveBeenCalledWith(info);
    expect(updater.get()).toMatchObject({ state: 'ready', latestVersion: '1.31.0' });
    autoUpdater.emit('update-downloaded', info);
    await flush();
    expect(verifyDownload).toHaveBeenCalledTimes(1);
  });

  test('a download that fails our checks is never offered', async () => {
    const { updater, autoUpdater } = setup({ verifyDownload: jest.fn().mockRejectedValue(new Error('bad signature')) });
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('update-downloaded', { version: '1.31.0', downloadedFile: '/cache/x' });
    await flush();
    expect(updater.get()).toBeNull();
  });

  test('a version that was rolled back is never offered again', async () => {
    const autoUpdater = fakeAutoUpdater();
    const verifyDownload = jest.fn().mockResolvedValue();
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace: true,
      autoUpdater,
      nativeUpdater: null,
      fetchJson: jest.fn(),
      prepareForInstall: jest.fn(),
      verifyDownload,
      commitInstall: jest.fn(),
      skipVersion: '1.31.0',
      onChange: () => {},
      logger: silent,
      timers: noTimers
    });
    updater.start();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('update-downloaded', { version: '1.31.0', downloadedFile: '/cache/x' });
    await flush();
    expect(updater.get()).toBeNull();
    expect(verifyDownload).not.toHaveBeenCalled();
    autoUpdater.emit('update-available', { version: '1.31.1' });
    autoUpdater.emit('update-downloaded', { version: '1.31.1', downloadedFile: '/cache/y' });
    await flush();
    expect(updater.get()).toMatchObject({ state: 'ready', latestVersion: '1.31.1' });
  });

  test('a click drains first, then swaps with our code instead of the stock installer', async () => {
    const { updater, autoUpdater, commitInstall, prepareForInstall } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('update-downloaded', { version: '1.31.0', downloadedFile: '/cache/x' });
    await flush();
    await expect(updater.install()).resolves.toEqual({ ok: true });
    expect(prepareForInstall.mock.invocationCallOrder[0]).toBeLessThan(commitInstall.mock.invocationCallOrder[0]);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
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

describe('a failed install after teardown', () => {
  function setup({ teardownForInstall = jest.fn().mockResolvedValue(), commitInstall = null, nativeUpdater = new EventEmitter() } = {}) {
    const autoUpdater = fakeAutoUpdater();
    const relaunch = jest.fn();
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace: true,
      autoUpdater,
      nativeUpdater,
      fetchJson: jest.fn(),
      prepareForInstall: jest.fn().mockResolvedValue(),
      teardownForInstall,
      relaunch,
      commitInstall,
      onChange: () => {},
      logger: silent,
      timers: noTimers
    });
    updater.start();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    if (nativeUpdater) nativeUpdater.emit('update-downloaded');
    else autoUpdater.emit('update-downloaded', { version: '1.31.0' });
    return { updater, autoUpdater, relaunch, teardownForInstall };
  }

  test('an installer error after teardown relaunches the current version', async () => {
    const { updater, autoUpdater, relaunch, teardownForInstall } = setup();
    autoUpdater.quitAndInstall.mockImplementation(() => {
      autoUpdater.emit('error', new Error('Squirrel could not install the staged bundle'));
    });
    await updater.install();
    expect(teardownForInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(updater.get().error).toBe('Squirrel could not install the staged bundle');
  });

  test('an installer error arriving later still relaunches, once', async () => {
    const { updater, autoUpdater, relaunch } = setup();
    await expect(updater.install()).resolves.toEqual({ ok: true });
    expect(relaunch).not.toHaveBeenCalled();
    autoUpdater.emit('error', new Error('installer exited'));
    autoUpdater.emit('error', new Error('installer exited again'));
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  test('quitAndInstall throwing relaunches', async () => {
    const { updater, autoUpdater, relaunch } = setup();
    autoUpdater.quitAndInstall.mockImplementation(() => { throw new Error('spawn failed'); });
    await expect(updater.install()).resolves.toMatchObject({ ok: false, error: 'spawn failed' });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  test('commitInstall throwing relaunches', async () => {
    const commitInstall = jest.fn(() => { throw new Error('swap failed'); });
    const { updater, relaunch } = setup({ commitInstall, nativeUpdater: null });
    await expect(updater.install()).resolves.toMatchObject({ ok: false, error: 'swap failed' });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  test('teardown rejecting relaunches and never installs', async () => {
    const { updater, autoUpdater, relaunch } = setup({ teardownForInstall: jest.fn().mockRejectedValue(new Error('servers would not stop')) });
    await expect(updater.install()).resolves.toMatchObject({ ok: false });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  test('a refused drain stops nothing and relaunches nothing', async () => {
    const autoUpdater = fakeAutoUpdater();
    const nativeUpdater = new EventEmitter();
    const teardownForInstall = jest.fn();
    const relaunch = jest.fn();
    const updater = createUpdater({
      currentVersion: '1.30.3', installInPlace: true, autoUpdater, nativeUpdater, fetchJson: jest.fn(),
      prepareForInstall: jest.fn().mockRejectedValue(new Error('Sync has unsent changes. Update after it finishes.')),
      teardownForInstall, relaunch, onChange: () => {}, logger: silent, timers: noTimers
    });
    updater.start();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await expect(updater.install()).resolves.toMatchObject({ ok: false });
    autoUpdater.emit('error', new Error('unrelated'));
    expect(teardownForInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(updater.get()).toMatchObject({ state: 'ready', error: 'Sync has unsent changes. Update after it finishes.' });
  });

  test('the real MacUpdater reporting a Squirrel failure relaunches', async () => {
    const { MacUpdater } = require('electron-updater/out/MacUpdater');
    const autoUpdater = fakeAutoUpdater();
    const noLog = { info() {}, warn() {}, error() {}, log() {} };
    const core = {
      _logger: noLog,
      squirrelDownloadedUpdate: true,
      autoRunAppAfterInstall: true,
      nativeUpdater: { quitAndInstall() { autoUpdater.emit('error', new Error('Squirrel could not install the staged bundle')); } },
      closeServerIfExists() {},
      handleUpdateDownloaded: MacUpdater.prototype.handleUpdateDownloaded
    };
    autoUpdater.quitAndInstall = (...args) => MacUpdater.prototype.quitAndInstall.apply(core, args);
    const relaunch = jest.fn();
    const nativeUpdater = new EventEmitter();
    const updater = createUpdater({
      currentVersion: '1.30.3', installInPlace: true, autoUpdater, nativeUpdater, fetchJson: jest.fn(),
      prepareForInstall: jest.fn().mockResolvedValue(), teardownForInstall: jest.fn().mockResolvedValue(),
      relaunch, onChange: () => {}, logger: silent, timers: noTimers
    });
    updater.start();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await updater.install();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe('parseUpdateNowArg', () => {
  const exe = '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal';

  test('reads the one exact flag wherever Chromium put it', () => {
    expect(parseUpdateNowArg([exe, '--hyperclay-update-now=1.31.0', '--allow-file-access-from-files'])).toBe('1.31.0');
    expect(parseUpdateNowArg([exe, '--enable-avfoundation', '--hyperclay-update-now=10.0.12'])).toBe('10.0.12');
  });

  test('ignores anything that is not exactly the flag and a plain version', () => {
    for (const arg of [
      '--hyperclay-update-now', '--hyperclay-update-now=', '--hyperclay-update-now=1.31', '--hyperclay-update-now=1.31.0.1',
      '--hyperclay-update-now=01.31.0', '--hyperclay-update-now=1.31.0-beta', '--hyperclay-update-now= 1.31.0',
      '--hyperclay-update-now=1.31.0 ', '-hyperclay-update-now=1.31.0', '--HYPERCLAY-UPDATE-NOW=1.31.0',
      '/Users/ana/--hyperclay-update-now=1.31.0', '--hyperclay-update-now=1.31.0.html', 'hyperclay://update-now/1.31.0'
    ]) {
      expect(parseUpdateNowArg([exe, arg])).toBeNull();
    }
    expect(parseUpdateNowArg([exe])).toBeNull();
    expect(parseUpdateNowArg(undefined)).toBeNull();
  });

  test('two flags are refused rather than guessed between', () => {
    expect(parseUpdateNowArg([exe, '--hyperclay-update-now=1.31.0', '--hyperclay-update-now=1.32.0'])).toBeNull();
  });
});

describe('update now', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function setup({ installInPlace = true, nativeUpdater = new EventEmitter(), prepareForInstall = jest.fn().mockResolvedValue(), teardownForInstall = jest.fn().mockResolvedValue() } = {}) {
    const clock = { now: 1_800_000_000_000 };
    const autoUpdater = fakeAutoUpdater();
    const relaunch = jest.fn();
    const requests = [];
    const fetchJson = jest.fn().mockResolvedValue({ version: '1.31.0' });
    const updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace,
      installOnQuit: true,
      autoUpdater: installInPlace ? autoUpdater : null,
      nativeUpdater: installInPlace ? nativeUpdater : null,
      fetchJson,
      prepareForInstall,
      teardownForInstall,
      relaunch,
      onChange: () => {},
      onRequest: (record) => requests.push(record),
      logger: silent,
      timers: noTimers,
      now: () => clock.now
    });
    updater.start();
    const states = () => requests.map((record) => record.state);
    return { updater, autoUpdater, nativeUpdater, relaunch, requests, states, fetchJson, prepareForInstall, clock };
  }

  test('checks the feed, then installs the requested version through the normal install once Squirrel staged it', async () => {
    const { updater, autoUpdater, nativeUpdater, states, prepareForInstall } = setup();
    expect(updater.updateNow('1.31.0')).toMatchObject({ state: 'checking' });
    await flush();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    autoUpdater.emit('update-available', { version: '1.31.0' });
    expect(states()).toEqual(['checking', 'accepted']);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(states()).toEqual(['checking', 'accepted', 'draining', 'installing']);
    expect(prepareForInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test('an update that is already staged for that version installs at once', async () => {
    const { updater, autoUpdater, nativeUpdater, states } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    updater.updateNow('1.31.0');
    await flush();
    expect(states()).toEqual(['draining', 'installing']);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('a download already running for that version is accepted without a second check', () => {
    const { updater, autoUpdater, states } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    expect(updater.updateNow('1.31.0')).toMatchObject({ state: 'accepted' });
    expect(states()).toEqual(['accepted']);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('a feed that does not offer the version yet leaves the request checking, and the next request checks again', async () => {
    const { updater, autoUpdater, states } = setup();
    updater.updateNow('1.31.0');
    await flush();
    updater.updateNow('1.31.0');
    await flush();
    expect(states()).toEqual(['checking', 'checking']);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('a busy sync answers busy, keeps the update ready and running, and a later request installs it', async () => {
    const prepareForInstall = jest.fn()
      .mockRejectedValueOnce(new Error('Sync has unsent changes. Update after it finishes.'))
      .mockResolvedValue();
    const { updater, autoUpdater, nativeUpdater, requests, relaunch } = setup({ prepareForInstall });
    updater.updateNow('1.31.0');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(requests[requests.length - 1]).toEqual({ version: '1.31.0', state: 'busy', reason: 'Sync has unsent changes. Update after it finishes.', retry: true });
    expect(updater.get()).toMatchObject({ state: 'ready', latestVersion: '1.31.0' });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    updater.updateNow('1.31.0');
    await flush();
    expect(requests[requests.length - 1].state).toBe('installing');
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('an install that fails after teardown reports failed before relaunching the current version', async () => {
    const { updater, autoUpdater, nativeUpdater, requests, relaunch } = setup();
    autoUpdater.quitAndInstall.mockImplementation(() => { throw new Error('spawn failed'); });
    relaunch.mockImplementation(() => requests.push({ state: 'relaunched' }));
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    updater.updateNow('1.31.0');
    await flush();
    expect(requests.map((record) => record.state)).toEqual(['draining', 'installing', 'failed', 'relaunched']);
    expect(requests[2]).toEqual({ version: '1.31.0', state: 'failed', reason: 'spawn failed', retry: false });
  });

  test('a second Squirrel event during the drain neither restarts the install nor answers busy', async () => {
    let finishDrain;
    const prepareForInstall = jest.fn(() => new Promise((resolve) => { finishDrain = resolve; }));
    const { updater, autoUpdater, nativeUpdater, states } = setup({ prepareForInstall });
    updater.updateNow('1.31.0');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await flush();
    nativeUpdater.emit('update-downloaded');
    await flush();
    finishDrain();
    await flush();
    expect(states()).toEqual(['checking', 'accepted', 'draining', 'installing']);
    expect(prepareForInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('a failed download after acceptance reports failed and leaves the app running', () => {
    const { updater, autoUpdater, requests, relaunch } = setup();
    updater.updateNow('1.31.0');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('error', new Error('net::ERR_CONNECTION_RESET'));
    expect(requests[requests.length - 1]).toEqual({ version: '1.31.0', state: 'failed', reason: 'The download failed: net::ERR_CONNECTION_RESET', retry: true });
    expect(relaunch).not.toHaveBeenCalled();
  });

  test('a different version staged first is reported, never installed in its place', async () => {
    const { updater, autoUpdater, nativeUpdater, states } = setup();
    updater.updateNow('1.31.1');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(states()).toEqual(['checking', 'failed']);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    updater.updateNow('1.31.1');
    expect(states()).toEqual(['checking', 'failed', 'failed']);
  });

  test('link mode and versions that are not newer are refused without checking', async () => {
    const link = setup({ installInPlace: false });
    expect(link.updater.updateNow('1.31.0')).toMatchObject({ state: 'refused' });
    await flush();
    expect(link.fetchJson).not.toHaveBeenCalled();
    const install = setup();
    expect(install.updater.updateNow('1.30.3')).toMatchObject({ state: 'refused', reason: 'Already running 1.30.3.' });
    expect(install.updater.updateNow('1.29.9')).toMatchObject({ state: 'refused' });
    expect(install.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('without a request, a staged update still waits for a click', async () => {
    const { autoUpdater, nativeUpdater, requests } = setup();
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  test('on Windows the request installs on electron-updater\'s own downloaded event', async () => {
    const { updater, autoUpdater, states } = setup({ nativeUpdater: null });
    updater.updateNow('1.31.0');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    autoUpdater.emit('update-downloaded', { version: '1.31.0' });
    await flush();
    expect(states()).toEqual(['checking', 'accepted', 'draining', 'installing']);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('a request expires 60 s after its last resend: the update is then staged for a click, never installed on its own', async () => {
    const { updater, autoUpdater, nativeUpdater, states, clock } = setup();
    updater.updateNow('1.31.0');
    clock.now += REQUEST_TTL_MS;
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(states()).toEqual(['checking']);
    expect(updater.get()).toMatchObject({ state: 'ready', latestVersion: '1.31.0' });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    clock.now += 6 * 60 * 60 * 1000;
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    updater.updateNow('1.31.0');
    await flush();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('each resend renews the request, so a download slower than 60 s still installs while the canary keeps asking', async () => {
    const { updater, autoUpdater, nativeUpdater, states, clock } = setup();
    updater.updateNow('1.31.0');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    for (let i = 0; i < 6; i += 1) {
      clock.now += 30_000;
      updater.updateNow('1.31.0');
    }
    clock.now += 30_000;
    nativeUpdater.emit('update-downloaded');
    await flush();
    expect(states().slice(-2)).toEqual(['draining', 'installing']);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('an expired request is forgotten by a failed download too', () => {
    const { updater, autoUpdater, states, clock } = setup();
    updater.updateNow('1.31.0');
    autoUpdater.emit('update-available', { version: '1.31.0' });
    clock.now += REQUEST_TTL_MS;
    autoUpdater.emit('error', new Error('net::ERR_CONNECTION_RESET'));
    expect(states()).toEqual(['checking', 'accepted']);
  });

  test('while sync drains a resend answers draining, and installing only once teardown has begun', async () => {
    let finishDrain;
    const prepareForInstall = jest.fn(() => new Promise((resolve) => { finishDrain = resolve; }));
    let finishTeardown;
    const teardownForInstall = jest.fn(() => new Promise((resolve) => { finishTeardown = resolve; }));
    const { updater, autoUpdater, nativeUpdater, states } = setup({ prepareForInstall, teardownForInstall });
    autoUpdater.emit('update-available', { version: '1.31.0' });
    nativeUpdater.emit('update-downloaded');
    expect(updater.updateNow('1.31.0')).toMatchObject({ state: 'draining' });
    expect(updater.updateNow('1.31.0')).toMatchObject({ state: 'draining' });
    expect(teardownForInstall).not.toHaveBeenCalled();
    finishDrain();
    await flush();
    expect(teardownForInstall).toHaveBeenCalledTimes(1);
    expect(updater.updateNow('1.31.0')).toMatchObject({ state: 'installing' });
    finishTeardown();
    await flush();
    expect(states()).toEqual(['draining', 'draining', 'installing', 'installing']);
  });
});

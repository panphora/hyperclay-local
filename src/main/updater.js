const path = require('path');

const FEED_URL = 'https://local.hyperclay.com/updates/stable';
const RECEIPT_URL = 'https://local.hyperclay.com/release-info.json';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
// NSIS keys a per-user install under HKCU\Software\<guid>, the guid being a UUIDv5 of
// the appId. A per-machine install keeps it under HKLM and needs elevation to update.
const WINDOWS_INSTALL_KEY = 'HKCU\\Software\\56279e69-a1ca-58cc-a483-19be13420d85';

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// Squirrel replaces the bundle where it sits, so it needs one it can write, and never a
// translocated or disk-image copy. The NSIS installer reinstalls into the per-user
// location it recorded, which must be the folder this exe runs from. An AppImage is
// swapped by our own code, which needs its folder writable and a key to check updates.
function canInstallInPlace({ platform, isPackaged, exePath, canWrite, installLocation = null, appImage = null, hasUpdateKeys = false }) {
  if (!isPackaged) return false;
  if (platform === 'linux') {
    if (!appImage || !hasUpdateKeys || !path.posix.isAbsolute(appImage)) return false;
    return canWrite(appImage) && canWrite(path.posix.dirname(appImage));
  }
  if (platform === 'win32') {
    if (!installLocation) return false;
    const dir = path.win32.dirname(exePath);
    return path.win32.resolve(installLocation).toLowerCase() === dir.toLowerCase() && canWrite(dir);
  }
  if (platform !== 'darwin') return false;
  const bundle = path.posix.resolve(exePath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return false;
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return false;
  return canWrite(bundle) && canWrite(path.posix.dirname(bundle));
}

function parseInstallLocation(regOutput) {
  const match = /^\s*InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(regOutput || '');
  return match ? match[1] : null;
}

function readWindowsInstallLocation(execFileSync) {
  try {
    return parseInstallLocation(execFileSync('reg', ['query', WINDOWS_INSTALL_KEY, '/v', 'InstallLocation'], { encoding: 'utf8', windowsHide: true }));
  } catch {
    return null;
  }
}

function createUpdater({
  currentVersion,
  installInPlace,
  installOnQuit = false,
  autoUpdater,
  nativeUpdater,
  fetchJson,
  prepareForInstall,
  verifyDownload = null,
  commitInstall = null,
  onChange,
  logger = console,
  timers = { setTimeout, setInterval }
}) {
  let state = { mode: installInPlace ? 'install' : 'link', state: 'idle', latestVersion: null, error: null };

  const get = () => (state.latestVersion ? { ...state } : null);
  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(get());
  };

  async function checkReceipt() {
    try {
      const info = await fetchJson(RECEIPT_URL);
      if (info && typeof info.version === 'string' && compareVersions(info.version, currentVersion) > 0) {
        set({ state: 'available', latestVersion: info.version });
      }
    } catch (error) {
      logger.log('[UPDATE] Update check failed:', error.message);
    }
  }

  function wireInstaller() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = installOnQuit;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = logger;
    autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL });
    autoUpdater.on('update-available', (info) => {
      if (state.state === 'ready' || state.state === 'restarting') return;
      set({ state: 'downloading', latestVersion: info.version, error: null });
    });
    autoUpdater.on('error', (error) => {
      logger.log('[UPDATE] Updater error:', error && error.message);
      if (state.state === 'downloading') set({ state: 'idle', latestVersion: null });
    });
    // electron-updater reports its own download before Squirrel has staged the bundle;
    // only Squirrel's event means a click can install at once. Without Squirrel (NSIS),
    // electron-updater's event comes after the sha512 and Authenticode checks.
    if (nativeUpdater) {
      nativeUpdater.on('update-downloaded', () => {
        if (state.latestVersion) set({ state: 'ready', error: null });
      });
    } else {
      autoUpdater.on('update-downloaded', async (info) => {
        if (state.state === 'restarting') return;
        if (state.state === 'ready' && state.latestVersion === info.version) return;
        try {
          if (verifyDownload) await verifyDownload(info);
        } catch (error) {
          logger.log('[UPDATE] Downloaded update rejected:', error.message);
          set({ state: 'idle', latestVersion: null });
          return;
        }
        set({ state: 'ready', latestVersion: info.version, error: null });
      });
    }
  }

  function check() {
    if (state.mode === 'link') return checkReceipt();
    if (state.state === 'ready' || state.state === 'restarting') return Promise.resolve();
    return Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((error) => logger.log('[UPDATE] Update check failed:', error.message));
  }

  function start() {
    if (state.mode === 'install') wireInstaller();
    timers.setTimeout(check, FIRST_CHECK_MS);
    timers.setInterval(check, CHECK_EVERY_MS);
  }

  async function install() {
    if (state.mode !== 'install' || state.state !== 'ready') return { ok: false };
    set({ state: 'restarting', error: null });
    try {
      await prepareForInstall();
    } catch (error) {
      set({ state: 'ready', error: error.message });
      return { ok: false, error: error.message };
    }
    if (commitInstall) commitInstall();
    else autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  }

  return { start, check, install, get };
}

module.exports = { createUpdater, canInstallInPlace, compareVersions, parseInstallLocation, readWindowsInstallLocation, WINDOWS_INSTALL_KEY, FEED_URL };

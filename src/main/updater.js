const path = require('path');

const FEED_URL = 'https://local.hyperclay.com/updates/stable';
const RECEIPT_URL = 'https://local.hyperclay.com/release-info.json';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

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
// translocated or disk-image copy.
function canInstallInPlace({ platform, isPackaged, exePath, canWrite }) {
  if (platform !== 'darwin' || !isPackaged) return false;
  const bundle = path.resolve(exePath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return false;
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return false;
  return canWrite(bundle) && canWrite(path.dirname(bundle));
}

function createUpdater({
  currentVersion,
  installInPlace,
  autoUpdater,
  nativeUpdater,
  fetchJson,
  prepareForInstall,
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
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableDifferentialDownload = true;
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
    // only Squirrel's event means a click can install at once.
    nativeUpdater.on('update-downloaded', () => {
      if (state.latestVersion) set({ state: 'ready', error: null });
    });
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
    autoUpdater.quitAndInstall();
    return { ok: true };
  }

  return { start, check, install, get };
}

module.exports = { createUpdater, canInstallInPlace, compareVersions };

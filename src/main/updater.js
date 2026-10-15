const path = require('path');

const FEED_URL = 'https://local.hyperclay.com/updates/stable';
const RECEIPT_URL = 'https://local.hyperclay.com/release-info.json';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
// NSIS keys a per-user install under HKCU\Software\<guid>, the guid being a UUIDv5 of
// the appId. A per-machine install keeps it under HKLM and needs elevation to update.
const WINDOWS_INSTALL_KEY = 'HKCU\\Software\\56279e69-a1ca-58cc-a483-19be13420d85';
const WINDOWS_MACHINE_INSTALL_KEY = 'HKLM\\Software\\56279e69-a1ca-58cc-a483-19be13420d85';
// An update-now request authorizes an automatic restart only this long after its last
// resend. scripts/update-canary.js resends every 30 s, so a canary that stopped can never
// lead to a restart later; the staged update then waits for a click like any other.
const REQUEST_TTL_MS = 60_000;
const UPDATE_NOW_ARG = /^--hyperclay-update-now=((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;

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
// location it recorded, which must be the folder this exe runs from. When a per-machine
// install exists too, the installer refuses a silent run (build/installer.nsh exits 3)
// and only an interactive one can remove it, so that case keeps the download link. An
// AppImage is swapped by our own code, which needs its folder writable and a key to
// check updates.
function canInstallInPlace({ platform, isPackaged, exePath, canWrite, exists = () => true, installLocation = null, machineInstallLocation = null, appImage = null, hasUpdateKeys = false }) {
  if (!isPackaged) return false;
  if (platform === 'linux') {
    if (!appImage || !hasUpdateKeys || !path.posix.isAbsolute(appImage)) return false;
    return canWrite(appImage) && canWrite(path.posix.dirname(appImage));
  }
  if (platform === 'win32') {
    // An HKLM entry whose folder is gone is no install: build/installer.nsh ignores it too.
    if (!installLocation || (machineInstallLocation && exists(machineInstallLocation))) return false;
    const dir = path.win32.dirname(exePath);
    return path.win32.resolve(installLocation).toLowerCase() === dir.toLowerCase() && canWrite(dir);
  }
  if (platform !== 'darwin') return false;
  const bundle = path.posix.resolve(exePath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return false;
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return false;
  return canWrite(bundle) && canWrite(path.posix.dirname(bundle));
}

function parseUpdateNowArg(argv) {
  const found = (Array.isArray(argv) ? argv : []).map((arg) => UPDATE_NOW_ARG.exec(String(arg))).filter(Boolean);
  return found.length === 1 ? found[0][1] : null;
}

function parseInstallLocation(regOutput) {
  const match = /^\s*InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(regOutput || '');
  return match ? match[1] : null;
}

function readWindowsInstallLocation(execFileSync, key = WINDOWS_INSTALL_KEY) {
  try {
    return parseInstallLocation(execFileSync('reg', ['query', key, '/v', 'InstallLocation'], { encoding: 'utf8', windowsHide: true }));
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
  teardownForInstall = async () => {},
  relaunch = () => {},
  verifyDownload = null,
  commitInstall = null,
  skipVersion = null,
  onChange,
  onRequest = () => {},
  logger = console,
  timers = { setTimeout, setInterval },
  now = () => Date.now()
}) {
  let state = { mode: installInPlace ? 'install' : 'link', state: 'idle', latestVersion: null, error: null };
  let tornDown = false;
  let relaunching = false;
  let target = null;
  let targetUntil = 0;

  const get = () => (state.latestVersion ? { ...state } : null);
  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(get());
  };

  const report = (version, requestState, reason = null, retry = false) => {
    onRequest({ version, state: requestState, reason, retry });
    return { state: requestState, reason };
  };

  // The request that may still restart the app on its own, or null once it has expired.
  function liveTarget() {
    if (target && now() >= targetUntil) {
      logger.log(`[UPDATE] The update-now request for ${target} expired; it now waits for a click.`);
      target = null;
    }
    return target;
  }

  // Once teardown has begun, sync, servers and observers are stopped and the popover is
  // gone, so a failed install can only start this version again, never carry on running.
  function recover(error) {
    logger.log('[UPDATE] Install failed after shutdown began, relaunching the current version:', error && error.message);
    if (relaunching) return;
    relaunching = true;
    const message = (error && error.message) || 'The update could not be installed.';
    set({ error: message });
    if (target) report(target, 'failed', message);
    relaunch();
  }

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
      if (info.version === skipVersion) return;
      if (state.state === 'ready' || state.state === 'restarting') return;
      set({ state: 'downloading', latestVersion: info.version, error: null });
      if (liveTarget() === info.version) report(target, 'accepted');
    });
    autoUpdater.on('error', (error) => {
      logger.log('[UPDATE] Updater error:', error && error.message);
      if (state.state === 'downloading') {
        set({ state: 'idle', latestVersion: null });
        if (liveTarget()) {
          report(target, 'failed', `The download failed: ${(error && error.message) || 'unknown error'}`, true);
          target = null;
        }
      } else if (tornDown) recover(error);
    });
    // electron-updater reports its own download before Squirrel has staged the bundle;
    // only Squirrel's event means a click can install at once. Without Squirrel (NSIS),
    // electron-updater's event comes after the sha512 and Authenticode checks.
    if (nativeUpdater) {
      nativeUpdater.on('update-downloaded', () => {
        if (state.latestVersion) staged({});
      });
    } else {
      autoUpdater.on('update-downloaded', async (info) => {
        if (state.state === 'restarting' || info.version === skipVersion) return;
        if (state.state === 'ready' && state.latestVersion === info.version) return;
        try {
          if (verifyDownload) await verifyDownload(info);
        } catch (error) {
          logger.log('[UPDATE] Downloaded update rejected:', error.message);
          set({ state: 'idle', latestVersion: null });
          return;
        }
        staged({ latestVersion: info.version });
      });
    }
  }

  function staged(patch) {
    if (state.state === 'restarting') return;
    set({ ...patch, state: 'ready', error: null });
    if (!liveTarget()) return;
    if (state.latestVersion === target) {
      installTarget();
      return;
    }
    report(target, 'failed', `${state.latestVersion} was downloaded instead of ${target}, so ${target} cannot install until it does.`);
    target = null;
  }

  // 'draining' while sync may still refuse; 'installing' only once teardown is committed,
  // so the canary knows whether a retry can still find the app untouched.
  async function installTarget() {
    const version = target;
    report(version, 'draining');
    const result = await install(() => report(version, 'installing'));
    if (result.ok || tornDown) return;
    target = null;
    report(version, 'busy', result.error || 'The update could not start.', true);
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

  async function install(onCommit = () => {}) {
    if (state.mode !== 'install' || state.state !== 'ready') return { ok: false };
    set({ state: 'restarting', error: null });
    try {
      await prepareForInstall();
    } catch (error) {
      set({ state: 'ready', error: error.message });
      return { ok: false, error: error.message };
    }
    tornDown = true;
    onCommit();
    try {
      await teardownForInstall();
      if (commitInstall) commitInstall();
      else autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      recover(error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  function updateNow(version) {
    if (state.mode !== 'install') return report(version, 'refused', 'This copy cannot replace itself, so it only offers the download link.');
    if (compareVersions(version, currentVersion) <= 0) return report(version, 'refused', `Already running ${currentVersion}.`);
    if (state.state === 'restarting') {
      return state.latestVersion === version
        ? report(version, tornDown ? 'installing' : 'draining')
        : report(version, 'failed', `${state.latestVersion} is already installing.`);
    }
    if (state.state === 'ready' && state.latestVersion !== version) {
      return report(version, 'failed', `${state.latestVersion} is already downloaded, so ${version} cannot install until it does.`);
    }
    target = version;
    targetUntil = now() + REQUEST_TTL_MS;
    if (state.state === 'ready') {
      installTarget();
      return { state: 'draining', reason: null };
    }
    if (state.state === 'downloading') {
      return state.latestVersion === version ? report(version, 'accepted') : report(version, 'checking');
    }
    const answer = report(version, 'checking');
    check();
    return answer;
  }

  return { start, check, install, get, updateNow };
}

module.exports = { createUpdater, canInstallInPlace, compareVersions, parseUpdateNowArg, parseInstallLocation, readWindowsInstallLocation, WINDOWS_INSTALL_KEY, WINDOWS_MACHINE_INSTALL_KEY, FEED_URL, REQUEST_TTL_MS };

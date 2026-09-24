const { app, BrowserWindow, dialog, shell, Menu, Tray, nativeImage, ipcMain, safeStorage, clipboard } = require('electron');
const path = require('upath');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const syncLogger = require('../sync-engine/logger');
const errorLogger = require('./error-logger');
const { getServerBaseUrl } = require('./utils/utils');
const { makeIsKnownPath } = require('./utils/known-path');
const popover = require('./popover');
const { PERSONAL_PORT, personalRoot, validateRootPath, allocateTeamPort } = require('./roots');
const { migrateSettings, legacyMetaDirName } = require('./settings-v2');
const { RootServerPool } = require('./root-servers');
const { SyncManager } = require('./sync-manager');
const { RootObserver } = require('./root-observer');
const { createRootLive } = require('./utils/root-live');
const { getAndClearSnapshot } = require('./server');
const { realpathNearestParent } = require('./utils/path-resolver');
const { VERSIONS_DIR } = require('./utils/artifact-paths');
const { servedRootsPath, writeServedRoots, removeServedRoots } = require('./served-roots-file');
const { extractOpenPaths, handleOpenPath, htmlClayLauncher } = require('./open-path');
const { removeProgram, forgetDecisions } = require('./helpers/store');
const { runAiEdit } = require('./helpers/ai-edit');

let manager = null;
let lastPersonalStatus = null;
const observers = new Map();

const engineRegistry = { forRoot: (rootId) => (manager ? manager.forRoot(rootId) : null) };
const isKnownPath = makeIsKnownPath(engineRegistry, fs);

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  errorLogger.fatal('Process', 'Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[FATAL] Unhandled rejection:', error);
  errorLogger.fatal('Process', 'Unhandled rejection', error);
});

// =============================================================================
// APP CONFIGURATION
// =============================================================================

app.setName('Hyperclay Local');
app.name = 'Hyperclay Local';

const isDev = !app.isPackaged;
if (isDev) {
  app.setPath('userData', app.getPath('userData') + '-dev');
  app.commandLine.appendSwitch('remote-debugging-port', '9229');
}

if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, '../../assets/icons/icon.png');
  const aboutOptions = {
    applicationName: 'Hyperclay Local',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Made with ❤️ for Hyperclay'
  };

  if (fs.existsSync(iconPath)) {
    aboutOptions.iconPath = iconPath;
  }

  app.setAboutPanelOptions(aboutOptions);
}

// =============================================================================
// STATE AND STORAGE
// =============================================================================

let tray = null;
let settings = {};
let isQuitting = false;
let availableUpdate = null;

const pool = new RootServerPool({
  devHooks: getDevHooks(),
  isKnownPath,
  observerFor,
  helpersFor,
  syncEngineForRoot: (rootId) => engineRegistry.forRoot(rootId),
});

const userData = app.getPath('userData');
const settingsPath = path.join(userData, 'settings.json');
const debugStickyFlagPath = path.join(userData, 'debug-popover-sticky.flag');

function readDebugSticky() {
  try { return fs.existsSync(debugStickyFlagPath); } catch { return false; }
}

function writeDebugSticky(on) {
  try {
    if (on) {
      if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(debugStickyFlagPath, '');
    } else if (fs.existsSync(debugStickyFlagPath)) {
      fs.unlinkSync(debugStickyFlagPath);
    }
  } catch (err) {
    console.error('[DEBUG] Failed to update sticky flag:', err);
  }
}

function getDevHooks() {
  if (!isDev) return null;
  return {
    showSticky: () => {
      if (!tray) return;
      popover.setSticky(true);
      popover.showPopover(tray.getBounds());
      popover.shrinkToDebug();
      writeDebugSticky(true);
    },
    hideAndClear: () => {
      popover.setSticky(false);
      popover.hidePopover();
      writeDebugSticky(false);
    },
  };
}

function encryptApiKey(apiKey) {
  if (!apiKey) return null;

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(apiKey);
      return encrypted.toString('base64');
    }
  } catch (error) {
    console.error('Failed to encrypt API key:', error);
  }

  return apiKey;
}

function decryptApiKey(encryptedKey) {
  if (!encryptedKey) return null;

  try {
    if (typeof encryptedKey === 'string' && encryptedKey.startsWith('hcsk_')) {
      console.log('[SECURITY] Migrating plaintext API key to encrypted storage');
      return encryptedKey;
    }

    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encryptedKey, 'base64');
      return safeStorage.decryptString(buffer);
    }
  } catch (error) {
    console.error('Failed to decrypt API key:', error);
  }

  return encryptedKey;
}

function getDecryptedApiKey() {
  if (!settings.apiKey) return null;
  return decryptApiKey(settings.apiKey);
}

function personalRootPath() {
  const root = personalRoot(settings.roots || []);
  return root ? root.path : null;
}

function rootsSnapshot() {
  return (settings.roots || []).map((root) => ({ ...root }));
}

function serverRunning() {
  const root = personalRoot(settings.roots || []);
  const server = root ? pool.get(root.id) : null;
  return !!server && server.state === 'running';
}

function rootsState() {
  const states = new Map(pool.states().map((state) => [state.rootId, state]));
  return (settings.roots || []).map((root) => {
    const state = states.get(root.id) || { state: 'stopped', error: null };
    return { id: root.id, kind: root.kind, path: root.path, port: root.port, state: state.state, error: state.error };
  });
}

const IDLE_SYNC_STATUS = {
  isRunning: false,
  syncFolder: null,
  username: null,
  stats: { lastSync: null, errors: [] },
  queueStatus: { queueLength: 0, isProcessing: false, retryItems: [] }
};

function personalSession() {
  const root = personalRoot(settings.roots || []);
  if (!root) return null;
  return (settings.syncSessions || []).find((session) => session.rootId === root.id) || null;
}

function ensurePersonalSession(username) {
  const root = personalRoot(settings.roots || []);
  if (!root) return null;

  let session = personalSession();
  if (!session) {
    session = {
      id: crypto.randomUUID(),
      rootId: root.id,
      accountId: null,
      kind: 'personal',
      cached: {
        username: username || settings.syncUsername || null,
        displayName: username || settings.syncUsername || null,
        role: 'owner'
      },
      paused: null,
      legacyMetaDir: legacyMetaDirName(root.path)
    };
    settings.syncSessions = [...(settings.syncSessions || []), session];
  } else if (username && session.cached?.username !== username) {
    session.cached = { ...session.cached, username, displayName: username };
  }
  return session;
}

function personalEngine() {
  const session = personalSession();
  return session && manager ? manager.get(session.id) : null;
}

function personalSyncStatus() {
  const engine = personalEngine();
  if (engine) {
    lastPersonalStatus = engine.getStatus();
    return lastPersonalStatus;
  }
  return { ...(lastPersonalStatus || IDLE_SYNC_STATUS), isRunning: false };
}

function observerFor(rootId) {
  let observer = observers.get(rootId);
  if (!observer) {
    const root = (settings.roots || []).find((r) => r.id === rootId);
    if (!root) return null;
    observer = new RootObserver(root, { live: createRootLive(root) });
    observer.on('lease-released', () => releaseObserver(rootId));
    observers.set(rootId, observer);
  }
  return observer;
}

function observerHeld(rootId) {
  const server = pool.get(rootId);
  if (server && server.state === 'running') return true;
  return !!(manager && manager.forRoot(rootId));
}

function releaseObserver(rootId) {
  const observer = observers.get(rootId);
  if (!observer) return;
  if (observer.leases) return;
  if (observerHeld(rootId)) return;
  observers.delete(rootId);
  observer.stop();
}

function syncObservers() {
  for (const root of settings.roots || []) {
    if (observerHeld(root.id)) observerFor(root.id)?.start();
  }
  for (const rootId of [...observers.keys()]) releaseObserver(rootId);
}

async function stopObservers() {
  for (const observer of observers.values()) await observer.stop();
  observers.clear();
}

function folderRefusal(check) {
  if (check.reason === 'overlaps') {
    const other = (settings.roots || []).find((root) => root.id === check.rootId);
    return `That folder overlaps ${other ? other.path : 'another served folder'}.`;
  }
  return 'Choose a folder inside your home folder.';
}

function linuxAutostartEntry() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config');
  return path.join(configHome, 'autostart', 'hyperclay-local.desktop');
}

function setAutostart(enabled) {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }
  const entry = linuxAutostartEntry();
  if (!enabled) {
    fs.rmSync(entry, { force: true });
    return;
  }
  const exe = process.env.APPIMAGE || process.execPath;
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, `[Desktop Entry]\nType=Application\nName=Hyperclay Local\nExec="${exe}"\nX-GNOME-Autostart-enabled=true\n`);
}

function loadSettings() {
  try {
    let loaded = {};
    let needsSave = false;

    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      loaded = JSON.parse(data);

      if (loaded.apiKey) {
        loaded.hasApiKey = true;

        if (loaded.apiKey.startsWith && loaded.apiKey.startsWith('hcsk_')) {
          console.log('[SECURITY] Detected plaintext API key - will encrypt on next save');
          const encryptedKey = encryptApiKey(loaded.apiKey);
          loaded.apiKey = encryptedKey;
          loaded.hasApiKey = true;
          needsSave = true;
        }
      } else {
        loaded.hasApiKey = false;
      }
    }

    if (loaded.settingsVersion !== 2) {
      const backupPath = path.join(userData, 'settings.v1.json');
      if (!fs.existsSync(backupPath) && fs.existsSync(settingsPath)) {
        fs.copyFileSync(settingsPath, backupPath);
      }
      loaded = migrateSettings(loaded).settings;
      loaded.hasApiKey = !!loaded.apiKey;
      needsSave = true;
    }

    if (!loaded.deviceId) {
      loaded.deviceId = crypto.randomUUID();
      console.log(`[APP] Generated new device ID: ${loaded.deviceId}`);
      needsSave = true;
    }

    if (needsSave) {
      const settingsToSave = { ...loaded };
      delete settingsToSave.hasApiKey;
      fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));
    }

    return loaded;
  } catch (error) {
    console.error('Failed to load settings:', error);
    syncLogger.error('App', 'Failed to load settings — starting with empty config', {
      error: error.message,
      settingsPath
    });
  }
  return { deviceId: crypto.randomUUID() };
}

function saveSettings(settings) {
  try {
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }

    const settingsToSave = { ...settings };

    // Only encrypt if the key is plaintext — avoid double-encrypting
    if (settingsToSave.apiKey && settingsToSave.apiKey.startsWith('hcsk_')) {
      settingsToSave.apiKey = encryptApiKey(settingsToSave.apiKey);
    }

    delete settingsToSave.hasApiKey;

    fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// =============================================================================
// HELPER PROGRAMS
// =============================================================================

function rootAccountFor(root) {
  const session = (settings.syncSessions || []).find((s) => s.rootId === root.id);
  const accountId = session?.accountId ?? null;
  if (accountId === null) return { accountId: null, teamName: null };
  return { accountId, teamName: session?.cached?.displayName || session?.cached?.username || null };
}

let approvalQueue = Promise.resolve();

function approveHelperQueued(request) {
  const answer = approvalQueue.then(() => approveHelper(request));
  approvalQueue = answer.catch(() => {});
  return answer;
}

async function approveHelper({ displayName, name, program, teamName, allowBroad }) {
  const programLine = program ? `the program ${name} (${program.path})` : `a program called ${name}`;
  const message = teamName
    ? `${teamName}'s document ${displayName} wants to run ${programLine}.`
    : `${displayName} wants to run ${programLine}.`;
  const detail = (teamName ? `Editors on ${teamName} can change this document later. ` : '') +
    'The program runs as you and can read or change any file your account can access.' +
    (program ? '' : ' You will choose which program to use.');
  const buttons = allowBroad
    ? ['Allow for This Document', 'Allow for Any Document', 'Deny', 'Not Now']
    : ['Allow for This Document', 'Deny', 'Not Now'];
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'Allow document program?', message, detail, buttons,
    cancelId: buttons.length - 1, defaultId: buttons.length - 1, noLink: true,
    signal: AbortSignal.timeout(120000),
  });
  const choice = ['allow', ...(allowBroad ? ['allow-any'] : []), 'deny', 'not-now'][response];
  if ((choice === 'allow' || choice === 'allow-any') && !program) {
    const picked = await dialog.showOpenDialog({ title: `Choose the program for ${name}`, properties: ['openFile'] });
    if (picked.canceled || !picked.filePaths[0]) return { choice: 'not-now' };
    return { choice, programPath: picked.filePaths[0] };
  }
  return { choice };
}

function helpersFor(root) {
  return {
    rootAccount: () => rootAccountFor(root),
    settings: () => settings,
    saveSettings: () => saveSettings(settings),
    approve: approveHelperQueued,
    aiEdit: {
      enabled: () => settings.aiEdit?.enabled === true,
      run: runAiEdit,
    },
  };
}

// =============================================================================
// ICON MANAGEMENT
// =============================================================================

function getAppIcon() {
  const possibleIcons = [
    path.join(__dirname, '../../assets/icons/icon.png'),
    path.join(__dirname, '../../assets/icons/icon.svg'),
  ];

  for (const iconFile of possibleIcons) {
    if (fs.existsSync(iconFile)) {
      return iconFile;
    }
  }
  return null;
}

function getTrayIcon() {
  const trayIconPath = path.join(__dirname, '../../assets/icons/tray-icon.png');
  const mainIconPath = path.join(__dirname, '../../assets/icons/icon.png');

  try {
    if (fs.existsSync(trayIconPath)) {
      const icon = nativeImage.createFromPath(trayIconPath);

      if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
      }

      return icon;
    } else if (fs.existsSync(mainIconPath)) {
      const icon = nativeImage.createFromPath(mainIconPath);
      const size = process.platform === 'darwin' ? 22 : 16;
      return icon.resize({ width: size, height: size });
    }
  } catch (error) {
    console.error('Failed to load tray icon:', error);
  }

  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFYSURBVDiNpZM9SwNBEIafgwQSCxsLwcJCG1sLG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sL');
}

// =============================================================================
// TRAY MENU MANAGEMENT
// =============================================================================

function getTrayMenuTemplate() {
  return [
    ...(process.platform === 'linux' ? [
      {
        label: 'Open Panel',
        click: () => {
          popover.showPopover(tray.getBounds());
        }
      },
      { type: 'separator' }
    ] : []),
    {
      label: `Server: ${serverRunning() ? 'On' : 'Off'}`,
      enabled: false
    },
    {
      label: `Sync: ${settings.syncEnabled ? 'On' : 'Off'}`,
      enabled: false
    },
    {
      label: `AI Editing: ${settings.aiEdit?.enabled === true ? 'On' : 'Off'}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: serverRunning() ? 'Stop Server' : 'Start Server',
      click: () => {
        if (serverRunning()) {
          handleStopServer();
        } else {
          handleStartServer();
        }
      }
    },
    {
      label: settings.syncEnabled ? 'Disable Sync' : 'Enable Sync',
      enabled: !!(settings.hasApiKey && personalRootPath()),
      click: async () => {
        if (settings.syncEnabled) {
          await handleSyncStop();
        } else {
          if (settings.hasApiKey && personalRootPath()) {
            const apiKey = getDecryptedApiKey();
            if (apiKey) {
              await handleSyncStart(
                apiKey,
                settings.syncUsername,
                personalRootPath(),
                settings.serverUrl
              );
            }
          }
        }
      }
    },
    {
      label: settings.aiEdit?.enabled === true ? 'Disable AI Editing' : 'Enable AI Editing',
      click: () => {
        settings.aiEdit = { ...settings.aiEdit, enabled: !(settings.aiEdit?.enabled === true) };
        saveSettings(settings);
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Open Folder',
      enabled: !!personalRootPath(),
      click: () => {
        const folder = personalRootPath();
        if (folder) {
          shell.openPath(folder);
        }
      }
    },
    {
      label: 'Backups',
      enabled: !!personalRootPath(),
      click: async () => {
        const root = personalRoot(settings.roots || []);
        if (root) await openBackups(root.id);
      }
    },
    {
      label: 'Open Browser',
      enabled: serverRunning(),
      click: () => {
        if (serverRunning()) {
          shell.openExternal(`http://localhost:${PERSONAL_PORT}`);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'View Sync Logs',
      click: () => {
        const logsPath = app.getPath('logs');
        shell.openPath(path.join(logsPath, 'sync'));
      }
    },
    {
      label: 'View Error Logs',
      click: () => {
        const logsPath = app.getPath('logs');
        shell.openPath(path.join(logsPath, 'errors'));
      }
    },
    { type: 'separator' },
    {
      label: 'About Hyperclay Local',
      click: () => {
        if (process.platform === 'darwin') {
          app.showAboutPanel();
        } else {
          dialog.showMessageBox({
            type: 'info',
            title: 'About Hyperclay Local',
            message: `Hyperclay Local Server v${app.getVersion()}`,
            detail: 'A local server for running your malleable HTML files offline.\n\nMade with \u2764\ufe0f for the Hyperclay platform.',
            buttons: ['OK']
          });
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ];
}

function updateTrayMenu() {
  if (tray) {
    if (process.platform !== 'darwin') {
      const contextMenu = Menu.buildFromTemplate(getTrayMenuTemplate());
      tray.setContextMenu(contextMenu);
    }
  }
}

// =============================================================================
// UI UPDATE
// =============================================================================

function sendToPopover(channel, data) {
  const popoverWin = popover.getPopoverWindow();
  if (popoverWin && !popoverWin.isDestroyed()) {
    popoverWin.webContents.send(channel, data);
  }
}

function updateUI() {
  const syncStatus = personalSyncStatus();
  const statePayload = {
    selectedFolder: personalRootPath(),
    serverRunning: serverRunning(),
    serverPort: PERSONAL_PORT,
    syncEnabled: settings.syncEnabled,
    syncStatus: syncStatus,
    syncStats: syncStatus.stats,
    syncUsername: settings.syncUsername,
    syncFolder: personalRootPath(),
    roots: rootsState()
  };

  sendToPopover('update-state', statePayload);
}

async function afterRootsChanged() {
  syncObservers();
  updateTrayMenu();
  updateUI();
  await publishServedRoots();
}

async function publishServedRoots() {
  try {
    const listeningRoots = pool.states()
      .filter((state) => state.state === 'running')
      .map((state) => {
        const root = (settings.roots || []).find((candidate) => candidate.id === state.rootId);
        return root ? { path: root.path, port: state.port } : null;
      })
      .filter(Boolean);
    await writeServedRoots(servedRootsPath(app.getPath('userData')), listeningRoots);
  } catch (error) {
    console.error('[SERVED-ROOTS] Failed to write served-roots.json:', error);
  }
}

// =============================================================================
// VERSION CHECK
// =============================================================================

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

async function checkForUpdates() {
  try {
    const response = await fetch('https://cdn.jsdelivr.net/gh/panphora/hyperclay-local@main/package.json');

    if (!response.ok) {
      console.log('[UPDATE] Failed to check for updates:', response.status);
      return;
    }

    const remotePackage = await response.json();
    const remoteVersion = remotePackage.version;
    const currentVersion = app.getVersion();

    console.log(`[UPDATE] Current version: ${currentVersion}, Latest version: ${remoteVersion}`);

    if (compareVersions(remoteVersion, currentVersion) > 0) {
      console.log('[UPDATE] New version available!');
      availableUpdate = { currentVersion, latestVersion: remoteVersion };
      sendToPopover('update-available', availableUpdate);
    } else {
      console.log('[UPDATE] App is up to date');
    }
  } catch (error) {
    console.log('[UPDATE] Update check failed:', error.message);
  }
}

// =============================================================================
// TRAY CREATION
// =============================================================================

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Hyperclay Local Server');

  tray.on('click', (event, bounds) => {
    popover.togglePopover(bounds || tray.getBounds());
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate(getTrayMenuTemplate());
    tray.popUpContextMenu(contextMenu);
  });

  if (process.platform !== 'darwin') {
    const contextMenu = Menu.buildFromTemplate(getTrayMenuTemplate());
    tray.setContextMenu(contextMenu);
  }
}

// =============================================================================
// SERVER HANDLERS
// =============================================================================

async function handleSelectFolder(event) {
  const parentWin = event ? BrowserWindow.fromWebContents(event.sender) : null;
  const result = await dialog.showOpenDialog(parentWin, {
    properties: ['openDirectory'],
    title: 'Select folder containing your malleable HTML files'
  });

  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const root = personalRoot(settings.roots || []);
  const check = await validateRootPath(result.filePaths[0], settings.roots || [], {
    realPathOf: realpathNearestParent,
    ignoreRootId: root ? root.id : null
  });

  if (!check.ok) {
    dialog.showErrorBox('Folder not available', folderRefusal(check));
    return { success: false };
  }

  const running = personalEngine();
  if (running && running.isRunning) await handleSyncStop();

  if (root) {
    root.path = check.path;
    const session = personalSession();
    if (session) session.legacyMetaDir = legacyMetaDirName(check.path);
  } else {
    settings.roots = [...(settings.roots || []), {
      id: crypto.randomUUID(),
      kind: 'personal',
      path: check.path,
      port: PERSONAL_PORT,
      trustedAt: null
    }];
  }
  saveSettings(settings);

  if (settings.serverEnabled) {
    await pool.sync(rootsSnapshot(), { enabled: true });
  }
  await afterRootsChanged();

  return { success: true, folder: check.path };
}

async function handleStartServer() {
  settings.serverEnabled = true;
  saveSettings(settings);

  try {
    await pool.sync(rootsSnapshot(), { enabled: true });
    await afterRootsChanged();
  } catch (error) {
    errorLogger.error('App', 'Failed to start server', error);
    dialog.showErrorBox('Server Error', `Failed to start server: ${error.message}`);
  }
}

async function handleStopServer() {
  try {
    settings.serverEnabled = false;
    saveSettings(settings);

    await pool.sync(rootsSnapshot(), { enabled: false });
    await afterRootsChanged();
  } catch (error) {
    console.error('Error stopping server:', error);
    errorLogger.error('App', 'Failed to stop server', error);
    await afterRootsChanged();
    dialog.showErrorBox('Server Error', `Failed to stop server: ${error.message}`);
  }
}

// The "Backups" action of a folder: show the version store C1 keeps for it. The
// directory is created first, because a folder that has never been saved into has
// no history yet and the OS would otherwise refuse to open a path that is not there.
async function openBackups(rootId) {
  const root = (settings.roots || []).find((r) => r.id === rootId);
  if (!root) return { ok: false, error: 'unknown' };

  const backupsPath = path.join(root.path, VERSIONS_DIR);
  try {
    await fsPromises.mkdir(backupsPath, { recursive: true });
  } catch {}

  const failure = await shell.openPath(backupsPath);
  return failure ? { ok: false, error: 'open-failed' } : { ok: true };
}

async function changePort(rootId) {
  const root = (settings.roots || []).find((r) => r.id === rootId);
  if (!root) return { ok: false, error: 'unknown' };
  if (root.kind === 'personal') return { ok: false, error: 'personal' };

  let nextPort;
  try {
    nextPort = await allocateTeamPort((settings.roots || []).filter((r) => r.id !== rootId));
  } catch (error) {
    errorLogger.error('App', 'Failed to allocate a port', error);
    return { ok: false, error: 'no-port' };
  }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: `Move ${path.basename(root.path)} to localhost:${nextPort}?`,
    detail: `Links and bookmarks to localhost:${root.port} will stop working. The htmlclay wire command finds the new port by itself.`,
    buttons: ['Move', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  });
  if (response !== 0) return { ok: false, error: 'cancelled' };

  root.port = nextPort;
  saveSettings(settings);

  await pool.sync(rootsSnapshot(), { enabled: settings.serverEnabled });
  await afterRootsChanged();

  return { ok: true, port: nextPort };
}

// =============================================================================
// SYNC EVENT HANDLERS
// =============================================================================

function setupSyncEventHandlers() {
  manager.on('sync-start', data => {
    sendToPopover('sync-update', { syncing: true, ...data });
  });

  manager.on('sync-complete', data => {
    sendToPopover('sync-update', { syncing: false, ...data });
  });

  manager.on('sync-error', data => {
    sendToPopover('sync-update', {
      error: data.userMessage || data.error || data.originalError,
      priority: data.priority,
      dismissable: data.dismissable,
      type: data.type,
      file: data.file,
      sessionId: data.sessionId,
      rootId: data.rootId,
      accountId: data.accountId
    });
  });

  manager.on('file-synced', data => {
    sendToPopover('file-synced', data);
  });

  manager.on('sync-stats', data => {
    sendToPopover('sync-stats', data);
  });

  manager.on('backup-created', data => {
    sendToPopover('backup-created', data);
  });

  manager.on('sync-retry', data => {
    sendToPopover('sync-retry', data);
  });

  manager.on('sync-failed', data => {
    sendToPopover('sync-failed', data);
  });
}

// =============================================================================
// SYNC HANDLERS
// =============================================================================

async function handleSyncStart(apiKey, username, syncFolder, serverUrl) {
  let session = null;
  try {
    const root = personalRoot(settings.roots || []);
    session = ensurePersonalSession(username);
    if (!root || !session) return { success: false, error: 'No folder selected for sync' };

    if (apiKey) settings.apiKey = apiKey;
    observerFor(root.id)?.start();

    const result = await manager.start(session, root, { syncBase: '/_/sync', protocol: 1 });
    syncObservers();

    if (result.success) {
      settings.syncEnabled = true;
      settings.apiKey = apiKey;
      settings.hasApiKey = true;
      settings.syncUsername = username;
      settings.serverUrl = serverUrl;
      saveSettings(settings);
    }

    updateUI();
    updateTrayMenu();
    return result;
  } catch (error) {
    if (session) await manager.stop(session.id);
    return {
      success: false,
      error: error.message
    };
  }
}

async function handleSyncStop() {
  try {
    const session = personalSession();
    const result = session && manager ? await manager.stop(session.id) : { success: true };

    settings.syncEnabled = false;
    saveSettings(settings);

    syncObservers();

    updateUI();
    updateTrayMenu();
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

ipcMain.handle('select-folder', (event) => handleSelectFolder(event));
ipcMain.handle('start-server', handleStartServer);
ipcMain.handle('stop-server', handleStopServer);

ipcMain.handle('get-state', () => ({
  selectedFolder: personalRootPath(),
  serverRunning: serverRunning(),
  serverPort: PERSONAL_PORT,
  syncEnabled: settings.syncEnabled,
  syncStatus: personalSyncStatus(),
  availableUpdate,
  appVersion: app.getVersion(),
  roots: rootsState()
}));

ipcMain.handle('copy-text', (event, text) => {
  clipboard.writeText(String(text ?? ''));
});

ipcMain.handle('open-folder', () => {
  const folder = personalRootPath();
  if (folder) {
    shell.openPath(folder);
  }
});

ipcMain.handle('open-logs', () => {
  const logsPath = app.getPath('logs');
  const syncLogsPath = path.join(logsPath, 'sync');
  shell.openPath(syncLogsPath);
});

ipcMain.handle('open-error-logs', async () => {
  const logsPath = app.getPath('logs');
  const errorLogsPath = path.join(logsPath, 'errors');
  await fs.promises.mkdir(errorLogsPath, { recursive: true });
  shell.openPath(errorLogsPath);
});

ipcMain.handle('open-browser', (event, url) => {
  if (url) {
    shell.openExternal(url);
  } else if (serverRunning()) {
    shell.openExternal(`http://localhost:${PERSONAL_PORT}`);
  }
});

// Server IPC handlers
ipcMain.handle('retry-port', async (event, { rootId } = {}) => {
  if (!(settings.roots || []).some((root) => root.id === rootId)) return { ok: false, error: 'unknown' };
  const result = await pool.retry(rootId);
  await afterRootsChanged();
  return result;
});

ipcMain.handle('change-port', (event, { rootId } = {}) => changePort(rootId));
ipcMain.handle('open-backups', (event, { rootId } = {}) => openBackups(rootId));

// Sync IPC handlers
ipcMain.handle('sync-start', async (event, { apiKey, username, syncFolder, serverUrl }) => {
  return await handleSyncStart(apiKey, username, syncFolder, serverUrl);
});

ipcMain.handle('sync-stop', async () => {
  return await handleSyncStop();
});

ipcMain.handle('sync-resume', async (event, selectedFolder, username) => {
  const folderToSync = selectedFolder || personalRootPath();
  const usernameToUse = username || settings.syncUsername;

  if (!settings.hasApiKey) {
    return { error: 'no-api-key' };
  }

  if (!folderToSync) {
    return { error: 'No folder selected for sync' };
  }

  const apiKey = getDecryptedApiKey();
  if (!apiKey || !apiKey.startsWith('hcsk_')) {
    delete settings.apiKey;
    settings.hasApiKey = false;
    saveSettings(settings);
    return { error: 'no-api-key' };
  }

  return await handleSyncStart(
    apiKey,
    usernameToUse,
    folderToSync,
    settings.serverUrl
  );
});

ipcMain.handle('sync-status', () => {
  return personalSyncStatus();
});

ipcMain.handle('get-sync-stats', () => {
  const status = personalSyncStatus();
  return status.stats || null;
});

// API key management IPC handlers
ipcMain.handle('set-api-key', async (event, key, serverUrl) => {
  try {
    if (!key || !key.startsWith('hcsk_')) {
      return { error: 'Invalid API key format' };
    }

    const baseUrl = getServerBaseUrl(serverUrl);
    console.log(`[SYNC] Validating API key with server: ${baseUrl}`);

    const response = await fetch(`${baseUrl}/_/sync/status`, {
      headers: { 'X-API-Key': key }
    });

    if (!response.ok) {
      return { error: 'Invalid or expired API key' };
    }

    const data = await response.json();

    settings.apiKey = key;
    settings.hasApiKey = true;
    settings.syncUsername = data.username;
    settings.serverUrl = baseUrl;
    ensurePersonalSession(data.username);
    saveSettings(settings);

    return { success: true, username: data.username };
  } catch (error) {
    console.error('[SYNC] API key validation failed:', error);
    return { error: 'Failed to validate API key' };
  }
});

ipcMain.handle('get-api-key-info', () => {
  if (settings.hasApiKey && settings.syncUsername) {
    return {
      hasApiKey: true,
      username: settings.syncUsername,
      serverUrl: settings.serverUrl
    };
  }
  return null;
});

ipcMain.handle('remove-api-key', () => {
  delete settings.apiKey;
  settings.hasApiKey = false;
  delete settings.syncUsername;
  delete settings.serverUrl;
  settings.syncEnabled = false;
  saveSettings(settings);
  return { success: true };
});

ipcMain.handle('toggle-sync', async (event, enabled) => {
  const folderToSync = personalRootPath();

  if (enabled && !folderToSync) {
    return { error: 'Please select a folder before enabling sync' };
  }

  if (enabled && !settings.hasApiKey) {
    return { error: 'no-api-key' };
  }

  if (enabled) {
    const apiKey = getDecryptedApiKey();

    if (!apiKey || !apiKey.startsWith('hcsk_')) {
      // Key is corrupted or decryption failed — clear it so user can re-enter
      delete settings.apiKey;
      settings.hasApiKey = false;
      saveSettings(settings);
      return { error: 'no-api-key' };
    }

    const result = await handleSyncStart(
      apiKey,
      settings.syncUsername,
      folderToSync,
      settings.serverUrl
    );

    // If sync start fails due to invalid key, clear stored key
    if (!result.success && result.error && /invalid|expired|unauthorized|api.key/i.test(result.error)) {
      delete settings.apiKey;
      settings.hasApiKey = false;
      saveSettings(settings);
      return { error: 'no-api-key' };
    }

    return result;
  } else {
    return await handleSyncStop();
  }
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

// Options menu IPC handler
ipcMain.handle('show-options-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [
    {
      label: 'Select Folder...',
      click: () => handleSelectFolder(event)
    },
    {
      label: 'Open Folder',
      enabled: !!personalRootPath(),
      click: () => {
        const folder = personalRootPath();
        if (folder) shell.openPath(folder);
      }
    },
    {
      label: 'Open in Browser',
      enabled: serverRunning(),
      click: () => {
        if (serverRunning()) shell.openExternal(`http://localhost:${PERSONAL_PORT}`);
      }
    },
    { type: 'separator' },
    {
      label: 'AI Editing',
      type: 'checkbox',
      checked: settings.aiEdit?.enabled === true,
      click: () => {
        settings.aiEdit = { ...settings.aiEdit, enabled: !(settings.aiEdit?.enabled === true) };
        saveSettings(settings);
        updateTrayMenu();
      }
    },
    {
      label: 'Helper Programs',
      submenu: [
        ...(settings.helperPrograms || []).map((program) => ({
          label: `${program.name} — ${program.path}`,
          submenu: [
            {
              label: 'Remove',
              click: () => {
                removeProgram(settings, program.id);
                saveSettings(settings);
              }
            }
          ]
        })),
        {
          label: 'Forget All Document Permissions',
          click: () => {
            for (const document of new Set((settings.helperDecisions || []).map((decision) => decision.document))) {
              forgetDecisions(settings, document);
            }
            saveSettings(settings);
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Enter API Key for Sync',
      click: () => {
        sendToPopover('show-credentials', {});
      }
    },
    {
      label: 'View Sync Logs',
      click: () => {
        const logsPath = app.getPath('logs');
        const syncLogsPath = path.join(logsPath, 'sync');
        shell.openPath(syncLogsPath);
      }
    },
    {
      label: 'View Error Logs',
      click: () => {
        const logsPath = app.getPath('logs');
        const errorLogsPath = path.join(logsPath, 'errors');
        shell.openPath(errorLogsPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Autostart on Login',
      type: 'checkbox',
      checked: settings.autoStartEnabled || false,
      click: (menuItem) => {
        if (isDev) return;
        settings.autoStartEnabled = menuItem.checked;
        saveSettings(settings);
        setAutostart(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'About Hyperclay Local',
      click: () => {
        if (process.platform === 'darwin') {
          app.showAboutPanel();
        } else {
          const iconPath = getAppIcon();
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'About Hyperclay Local',
            message: `Hyperclay Local Server v${app.getVersion()}`,
            detail: 'A local server for running your malleable HTML files offline.\n\nMade with \u2764\ufe0f for the Hyperclay platform.',
            buttons: ['OK'],
            icon: iconPath || undefined
          });
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

const htmlClay = htmlClayLauncher();

function openPath(p) {
  return handleOpenPath(p, {
    roots: rootsState,
    startServer: handleStartServer,
    isServerRunning: serverRunning,
    openExternal: (url) => shell.openExternal(url),
    showMessage: (opts) => dialog.showMessageBox(opts),
    revealFolder: (dir) => shell.openPath(dir),
    personalRoot: () => personalRoot(settings.roots || []),
    htmlClay
  }).catch((error) => {
    errorLogger.error('App', 'Failed to open path', error);
  });
}

let openQueue = Promise.resolve();

function queueOpenPath(p) {
  openQueue = openQueue.then(() => openPath(p));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();          // second instance forwards argv via the lock and exits
  return;              // and skips the rest of startup
}

const pendingOpenPaths = extractOpenPaths(process.argv);
let openHandlerReady = false;

app.on('open-file', (event, p) => {        // macOS Finder/Apple Events
  event.preventDefault();
  if (openHandlerReady) queueOpenPath(p); else pendingOpenPaths.push(p);
});
app.on('second-instance', (event, argv) => {  // Windows/Linux re-launch with file arg
  extractOpenPaths(argv).forEach((p) => (openHandlerReady ? queueOpenPath(p) : pendingOpenPaths.push(p)));
});

app.whenReady().then(async () => {
  app.setName('Hyperclay Local');

  const baseUrl = getServerBaseUrl();
  const isDevServer = baseUrl.includes('localhyperclay');
  console.log(`[APP] Running in ${isDevServer ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);
  console.log(`[APP] Sync will use: ${baseUrl}`);

  if (isDevServer) {
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
      if (url.startsWith('https://localhyperclay.com')) {
        event.preventDefault();
        callback(true);
      } else {
        callback(false);
      }
    });

    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
    console.log('[APP] Disabled certificate validation for local development');
  }

  settings = loadSettings();

  manager = new SyncManager({
    userData,
    deviceId: settings.deviceId,
    serverUrl: settings.serverUrl,
    getApiKey: getDecryptedApiKey,
    settingsStore: { get: () => settings, save: saveSettings },
    observerFor,
    takeSnapshot: (rel, rootId) => getAndClearSnapshot(rel, rootId)
  });
  setupSyncEventHandlers();

  if (!isDev) {
    setAutostart(settings.autoStartEnabled || false);
  }

  // Hide dock icon — app lives in tray only
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();

  // Eagerly create the popover window (hidden) so its renderer hydrates during
  // launch. First tray click then shows an already-loaded window even if the
  // main thread is mid-block in sync auto-restart.
  popover.createPopoverWindow();

  checkForUpdates();

  // Defer sync + server auto-restart until after whenReady resolves, so the
  // tray and popover are fully interactive before any potentially-blocking work
  // (safeStorage.decryptString can block for seconds on first call after a
  // code-signature change).
  setImmediate(async () => {
    if (settings.syncEnabled && settings.hasApiKey && personalRootPath()) {
      console.log('[APP] Auto-restarting sync from previous session...');

      const apiKey = getDecryptedApiKey();
      if (apiKey) {
        const result = await handleSyncStart(
          apiKey,
          settings.syncUsername,
          personalRootPath(),
          settings.serverUrl
        );

        if (result.success) {
          console.log('[APP] Sync auto-restart successful');
        } else {
          console.error('[APP] Sync auto-restart failed:', result);
          syncLogger.error('App', 'Sync auto-restart failed', result);
          sendToPopover('sync-update', { syncing: false, error: result.error || 'Sync failed to restart automatically' });
          settings.syncEnabled = false;
          saveSettings(settings);
        }
      } else {
        console.error('[APP] Failed to auto-restart sync: could not decrypt API key');
        syncLogger.error('App', 'Failed to auto-restart sync: could not decrypt API key');
        sendToPopover('sync-update', { syncing: false, error: 'Could not decrypt API key — please re-enter your credentials' });
        settings.syncEnabled = false;
        saveSettings(settings);
      }
    }

    if (settings.serverEnabled && personalRootPath()) {
      console.log('[APP] Auto-restarting server from previous session...');
      try {
        await pool.sync(rootsSnapshot(), { enabled: true });
        await afterRootsChanged();
        console.log('[APP] Server auto-restart successful');
      } catch (err) {
        // Do not clobber settings.serverEnabled here — a transient port conflict (EADDRINUSE on restart) would otherwise silently disable the user's auto-start preference.
        console.error('[APP] Failed to auto-start server:', err);
        errorLogger.error('App', 'Failed to auto-start server', err);
      }
    }

    openHandlerReady = true;
    for (const p of pendingOpenPaths.splice(0)) queueOpenPath(p);
  });

  // On first launch, auto-show popover so user isn't staring at an empty tray
  if (!personalRootPath()) {
    setTimeout(() => {
      if (tray) {
        popover.showPopover(tray.getBounds());
      }
    }, 500);
  }

  // Dev-only: restore sticky popover from previous session if marker file exists
  if (isDev && readDebugSticky()) {
    console.log('[DEBUG] Restoring sticky popover from previous session');
    setTimeout(() => {
      if (tray) {
        popover.setSticky(true);
        popover.showPopover(tray.getBounds());
      }
    }, 500);
  }
});

app.on('window-all-closed', () => {
  // Keep app running in tray — popover is not a persistent window
});

app.on('before-quit', async (event) => {
  isQuitting = true;
  removeServedRoots(servedRootsPath(app.getPath('userData')));
  popover.destroyPopover();

  const sessions = manager ? manager.statuses().length : 0;
  if (pool.states().length || sessions) {
    event.preventDefault();

    try {
      if (sessions) {
        console.log('[APP] Stopping sync engine before quit...');
        await manager.stopAll();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (pool.states().length) {
        console.log('[APP] Stopping servers before quit...');
        await pool.stopAll();
      }

      await stopObservers();

      app.quit();
    } catch (error) {
      console.error('Error during quit cleanup:', error);
      errorLogger.error('App', 'Error during quit cleanup', error);
      app.quit();
    }
  }
});

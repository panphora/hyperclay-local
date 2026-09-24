const { app, BrowserWindow, dialog, shell, Menu, Tray, Notification, nativeImage, ipcMain, powerMonitor, safeStorage, clipboard } = require('electron');
const path = require('upath');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const os = require('os');
const syncLogger = require('../sync-engine/logger');
const errorLogger = require('./error-logger');
const { getServerBaseUrl } = require('./utils/utils');
const { makeIsKnownPath } = require('./utils/known-path');
const popover = require('./popover');
const { PERSONAL_PORT, personalRoot, validateRootPath, defaultTeamFolder, allocateTeamPort } = require('./roots');
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
const { rootAccountFor } = require('./helpers/root-account');
const { buildCards, worstState, trayIconVariant, trayTooltip, switchSublines, toLine, trayMenuModel } = require('./ui/card-model');
const { createNewTeamNotifier } = require('./new-team-notifier');
const { isAllowedExternalUrl, requireRoot, requireSession, requireAccount, cardMenuModel, disconnectDialog, removeFolderDialog, movePortDialog, flattenConflicts, ACTIVITY_THROTTLE_MS, createThrottle } = require('./ui/main-ipc');

let manager = null;
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

const ACTIVITY_LIMIT = 100;
const DISCOVERY_STALE_MS = 30_000;
let activity = [];
let lastCards = [];
let lastPayload = null;
let trayIconName = null;
let firstDiscoveryForKey = true;
let notifyNewTeam = null;

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

function personalSession() {
  const root = personalRoot(settings.roots || []);
  if (!root) return null;
  return (settings.syncSessions || []).find((session) => session.rootId === root.id) || null;
}

function personalUsername() {
  const session = personalSession();
  return (session && session.cached && session.cached.username) ||
    settings.syncUsername ||
    (settings.actor && settings.actor.username) ||
    null;
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
    rootAccount: () => rootAccountFor(root, settings),
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

const TRAY_ICON_FILES = {
  normal: 'tray-icon',
  dim: 'tray-icon-dim',
  alert: 'tray-icon-alert',
};

const trayIcons = new Map();

function loadTrayIcon(name) {
  try {
    const iconPath = path.join(__dirname, `../../assets/icons/${name}.png`);
    if (!fs.existsSync(iconPath)) return null;

    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return null;

    if (process.platform === 'darwin') icon.setTemplateImage(true);
    return icon;
  } catch (error) {
    console.error('Failed to load tray icon:', error);
    return null;
  }
}

function appIconForTray() {
  const mainIconPath = path.join(__dirname, '../../assets/icons/icon.png');

  try {
    if (fs.existsSync(mainIconPath)) {
      const icon = nativeImage.createFromPath(mainIconPath);
      const size = process.platform === 'darwin' ? 22 : 16;
      return icon.resize({ width: size, height: size });
    }
  } catch (error) {
    console.error('Failed to load tray icon:', error);
  }

  return null;
}

function trayIconFor(variant) {
  const name = TRAY_ICON_FILES[variant] ? variant : 'normal';
  if (trayIcons.has(name)) return trayIcons.get(name);

  const icon = loadTrayIcon(TRAY_ICON_FILES[name]) ||
    (name === 'normal' ? appIconForTray() : trayIconFor('normal')) ||
    nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFYSURBVDiNpZM9SwNBEIafgwQSCxsLwcJCG1sLG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sL');

  trayIcons.set(name, icon);
  return icon;
}

// =============================================================================
// TRAY MENU MANAGEMENT
// =============================================================================

function cardActionClick(card, action) {
  if (action === 'open') return () => { if (card.url) shell.openExternal(card.url); };
  if (action === 'reveal') return () => { revealRoot(card.rootId); };
  if (action === 'backups') return () => { openBackups(card.rootId); };
  if (action === 'setup') return () => showSetupView(card.accountId);
  return null;
}

function cardSubmenu(card, model) {
  return model.map((item, index) => {
    const click = cardActionClick(card, card.actions[index]);
    return click ? { ...item, click } : { ...item };
  });
}

function toggleAiEditing() {
  settings.aiEdit = { ...settings.aiEdit, enabled: !(settings.aiEdit?.enabled === true) };
  saveSettings(settings);
  updateTrayMenu();
}

function showAboutDialog() {
  if (process.platform === 'darwin') {
    app.showAboutPanel();
    return;
  }

  dialog.showMessageBox({
    type: 'info',
    title: 'About Hyperclay Local',
    message: `Hyperclay Local Server v${app.getVersion()}`,
    detail: 'A local server for running your malleable HTML files offline.\n\nMade with \u2764\ufe0f for the Hyperclay platform.',
    buttons: ['OK']
  });
}

const TRAY_ITEM_CLICKS = {
  'Start Server': () => handleStartServer(),
  'Stop Server': () => handleStopServer(),
  'Enable Sync': () => startPersonalSync(),
  'Disable Sync': () => handleSyncStop(),
  'Enable AI Editing': toggleAiEditing,
  'Disable AI Editing': toggleAiEditing,
  'View Sync Logs': () => shell.openPath(path.join(app.getPath('logs'), 'sync')),
  'View Error Logs': () => shell.openPath(path.join(app.getPath('logs'), 'errors')),
  'About Hyperclay Local': () => showAboutDialog(),
  'Quit': () => app.quit()
};

function getTrayMenuTemplate(cards = lastCards) {
  const model = trayMenuModel(cards, {
    serverEnabled: settings.serverEnabled === true,
    syncEnabled: settings.syncEnabled === true,
    hasApiKey: !!settings.hasApiKey,
    aiEditEnabled: settings.aiEdit?.enabled === true
  });

  const cardItems = cards.filter((card) => card.state !== 'viewer');
  let nextCard = 0;

  const items = model.map((item) => {
    if (item.submenu) {
      const card = cardItems[nextCard++];
      return card ? { label: item.label, submenu: cardSubmenu(card, item.submenu) } : { ...item };
    }

    const click = TRAY_ITEM_CLICKS[item.label];
    return click ? { ...item, click } : { ...item };
  });

  if (process.platform !== 'linux') return items;

  return [
    {
      label: 'Open Panel',
      click: () => {
        popover.showPopover(tray.getBounds());
      }
    },
    { type: 'separator' },
    ...items
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
// TEAM NOTIFICATIONS
// =============================================================================

function showSetupView(accountId) {
  if (tray) popover.showPopover(tray.getBounds());
  sendToPopover('show-team-setup', { accountId });
}

function notifyNewTeamAccount(account) {
  if (!Notification.isSupported()) return;

  const viewer = !(account.sync && account.sync.enabled === true);
  const team = account.displayName || account.username;
  const notification = new Notification({
    title: `Added to ${team}`,
    body: viewer
      ? `You're a viewer on ${account.username}. Open it on hyperclay.com.`
      : `You were added to ${account.username}. Set up a folder?`
  });

  notification.on('click', () => {
    if (viewer) {
      if (account.webUrl) shell.openExternal(account.webUrl);
      return;
    }
    showSetupView(account.id);
  });

  notification.show();
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

async function nextPortFor(rootId) {
  try {
    return await allocateTeamPort((settings.roots || []).filter((root) => root.id !== rootId));
  } catch (error) {
    return null;
  }
}

function snapshotSessions() {
  const statuses = new Map((manager ? manager.statuses() : []).map((status) => [status.sessionId, status]));

  return (settings.syncSessions || []).map((session) => {
    const status = statuses.get(session.id) || {};
    return {
      id: session.id,
      rootId: session.rootId,
      accountId: session.accountId ?? null,
      kind: session.kind,
      cached: session.cached || null,
      paused: status.paused ?? session.paused ?? null,
      status: status.status || 'idle',
      pendingCount: status.pendingCount || 0,
      conflicts: status.conflicts || [],
      lastSyncAt: status.lastSyncAt ?? status.lastSync ?? null,
      lastError: status.lastError || null
    };
  });
}

async function buildSnapshot() {
  const states = new Map(pool.states().map((state) => [state.rootId, state]));
  const roots = [];

  for (const root of settings.roots || []) {
    const state = states.get(root.id) || null;
    const portTaken = !!state && state.state === 'port-taken';
    roots.push({
      id: root.id,
      kind: root.kind,
      path: root.path,
      port: root.port,
      formerAccount: root.formerAccount || null,
      running: !!state && state.state === 'running',
      portTaken,
      nextPort: portTaken ? await nextPortFor(root.id) : null
    });
  }

  const sessions = snapshotSessions();
  const discovery = manager ? manager.discovery : null;
  const reasons = sessions.map((session) => session.paused && session.paused.reason).filter(Boolean);

  return {
    serverEnabled: settings.serverEnabled === true,
    syncEnabled: settings.syncEnabled === true,
    hasApiKey: !!settings.hasApiKey,
    actor: (discovery && discovery.actor) || settings.actor || null,
    serverUpdateRequired: reasons.includes('server-update-required'),
    keyInvalid: reasons.includes('key-revoked'),
    roots,
    sessions,
    accounts: (discovery && discovery.accounts) || [],
    home: app.getPath('home')
  };
}

function bannerFor(snapshot) {
  if (snapshot.keyInvalid) return 'reconnect';
  if (snapshot.serverUpdateRequired) return 'server-update';
  return null;
}

async function buildStatePayload() {
  const snapshot = await buildSnapshot();
  lastCards = buildCards(snapshot);

  lastPayload = {
    serverEnabled: snapshot.serverEnabled,
    syncEnabled: snapshot.syncEnabled,
    hasApiKey: snapshot.hasApiKey,
    actor: snapshot.actor,
    banner: bannerFor(snapshot),
    cards: lastCards,
    sublines: switchSublines(snapshot, lastCards),
    conflicts: flattenConflicts(manager ? manager.statuses() : []),
    home: os.homedir(),
    activity: [...activity]
  };

  return lastPayload;
}

/**
 * The feed updates on every synced file, but `updateUI()` rebuilds the cards and
 * probes ports for a taken one, so this resends the payload it already has with
 * only the activity replaced.
 */
const sendActivityUpdate = createThrottle(() => {
  if (!lastPayload) return;
  sendToPopover('update-state', { ...lastPayload, activity: [...activity] });
}, ACTIVITY_THROTTLE_MS);

function applyTrayState(cards) {
  if (!tray) return;

  const variant = trayIconVariant(worstState(cards));
  if (variant !== trayIconName) {
    tray.setImage(trayIconFor(variant));
    trayIconName = variant;
  }

  tray.setToolTip(trayTooltip(cards));
  updateTrayMenu();
}

async function updateUI() {
  const payload = await buildStatePayload();
  sendToPopover('update-state', payload);
  applyTrayState(payload.cards);
}

async function afterRootsChanged() {
  syncObservers();
  await updateUI();
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
  trayIconName = 'normal';
  tray = new Tray(trayIconFor('normal'));
  tray.setToolTip(trayTooltip(lastCards));

  tray.on('click', (event, bounds) => {
    refreshDiscovery({ stale: true });
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

// C4 §5.2: the two global switches. `on` is the whole argument — a port, a path
// or a key never crosses this boundary.
async function setServerEnabled(on) {
  if (on) await handleStartServer();
  else await handleStopServer();
  return { ok: true };
}

async function setSyncEnabled(on) {
  if (!on) {
    const stopped = await handleSyncStop();
    return stopped.success === false ? { ok: false, error: stopped.error || 'sync-failed' } : { ok: true };
  }

  const started = await startPersonalSync();
  return started.success ? { ok: true } : { ok: false, error: started.error || 'sync-failed' };
}

// The "Backups" action of a folder: show the version store C1 keeps for it. The
// directory is created first, because a folder that has never been saved into has
// no history yet and the OS would otherwise refuse to open a path that is not there.
async function openBackups(rootId) {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const backupsPath = path.join(check.root.path, VERSIONS_DIR);
  try {
    await fsPromises.mkdir(backupsPath, { recursive: true });
  } catch {}

  const failure = await shell.openPath(backupsPath);
  return failure ? { ok: false, error: 'open-failed' } : { ok: true };
}

async function revealRoot(rootId) {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const failure = await shell.openPath(check.root.path);
  return failure ? { ok: false, error: 'open-failed' } : { ok: true };
}

// C4 §4.9: the address on the card opens the folder this computer serves.
async function openRootInBrowser(rootId) {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const server = pool.get(rootId);
  if (!server || server.state !== 'running') return { ok: false, error: 'not-running' };

  await shell.openExternal(`http://localhost:${check.root.port}`);
  return { ok: true };
}

// C1-C2 §5.6: main proposes the port, the renderer never supplies one.
async function confirmAndChangePort(rootId) {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const root = check.root;
  if (root.kind === 'personal') return { ok: false, error: 'personal' };

  let nextPort;
  try {
    nextPort = await allocateTeamPort((settings.roots || []).filter((r) => r.id !== rootId));
  } catch (error) {
    errorLogger.error('App', 'Failed to allocate a port', error);
    return { ok: false, error: 'no-port' };
  }

  const { response } = await dialog.showMessageBox(movePortDialog({
    title: rootTitleFor(root),
    port: root.port,
    nextPort,
  }));
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
    const sessionsById = new Map((settings.syncSessions || []).map((session) => [session.id, session]));
    const line = toLine({ ...data, timestamp: new Date().toISOString() }, sessionsById, personalUsername());
    if (line) activity = [line, ...activity].slice(0, ACTIVITY_LIMIT);
    sendToPopover('file-synced', data);
    sendActivityUpdate();
  });

  manager.on('accounts', discovery => {
    if (!notifyNewTeam) return;
    notifyNewTeam(discovery.accounts || [], { firstDiscoveryForKey });
    firstDiscoveryForKey = false;
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

  manager.on('status-changed', () => {
    updateUI().catch(error => console.error('[SYNC] Failed to update the UI:', error.message));
  });
}

// =============================================================================
// SYNC HANDLERS
// =============================================================================

/**
 * C3 §5.8: discovery runs at launch, on wake, every five minutes and when the
 * popover opens. `stale` is the popover's throttle. Offline is logged, never
 * thrown into Electron.
 */
function refreshDiscovery({ stale = false } = {}) {
  if (!manager || settings.syncEnabled !== true || !settings.hasApiKey) return Promise.resolve();
  const refresh = stale ? manager.refreshAccountsIfStale(DISCOVERY_STALE_MS) : manager.refreshAccounts();
  return refresh.catch(error => {
    console.error('[SYNC] Discovery refresh failed:', error.message);
    errorLogger.error('Sync', 'Discovery refresh failed', error);
  });
}

/** C4 §5.2: the Options menu's Refresh Teams, and the popover's own refresh. */
async function handleRefreshAccounts() {
  if (!manager) return { ok: false, error: 'unavailable' };

  try {
    await manager.refreshAccounts();
  } catch (error) {
    console.error('[SYNC] Discovery refresh failed:', error.message);
    errorLogger.error('Sync', 'Discovery refresh failed', error);
    return { ok: false, error: 'offline' };
  }

  await updateUI();
  return { ok: true };
}

/** The five minute timer follows sync: it runs while sync is on and stops with it. */
function syncDiscoveryTimer() {
  if (!manager) return;
  if (settings.syncEnabled === true && settings.hasApiKey) manager.startDiscoveryTimer();
  else manager.stopDiscoveryTimer();
}

async function handleSyncStart(apiKey, username, syncFolder, serverUrl) {
  let session = null;
  try {
    const root = personalRoot(settings.roots || []);
    session = ensurePersonalSession(username);
    if (!root || !session) return { success: false, error: 'No folder selected for sync' };

    if (apiKey) settings.apiKey = apiKey;
    observerFor(root.id)?.start();

    // C3.11: every saved session starts, under protocol 2, with the `syncBase`
    // discovery names. The personal session answered for is the caller's result.
    const statuses = await manager.startEnabledSessions();
    syncObservers();

    const personal = statuses.find((status) => status.sessionId === session.id) || null;
    const result = personal && (personal.running || personal.paused)
      ? { success: true }
      : { success: false, error: 'sync-failed' };

    if (result.success) {
      settings.syncEnabled = true;
      settings.apiKey = apiKey;
      settings.hasApiKey = true;
      settings.syncUsername = username;
      settings.serverUrl = serverUrl;
      saveSettings(settings);
      syncDiscoveryTimer();
    }

    await updateUI();
    return result;
  } catch (error) {
    // C3.11: the launch is all the sessions, so a failure tears down all of them
    // rather than leaving the team sessions running behind a failed personal one.
    await manager.stopAll();
    return {
      success: false,
      error: error.message
    };
  }
}

async function handleSyncStop() {
  try {
    if (manager) await manager.stopAll();

    settings.syncEnabled = false;
    saveSettings(settings);
    syncDiscoveryTimer();

    syncObservers();

    await updateUI();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function startPersonalSync() {
  const folder = personalRootPath();
  if (!settings.hasApiKey || !folder) return { success: false, error: 'no-api-key' };

  const apiKey = getDecryptedApiKey();
  if (!apiKey) return { success: false, error: 'no-api-key' };

  return await handleSyncStart(apiKey, settings.syncUsername, folder, settings.serverUrl);
}

// =============================================================================
// TEAM COMMANDS
// =============================================================================

function currentAccounts() {
  return (manager && manager.discovery && manager.discovery.accounts) || [];
}

async function pathExists(dir) {
  try {
    await fsPromises.stat(dir);
    return true;
  } catch {
    return false;
  }
}

async function dirIsEmpty(dir) {
  try {
    return (await fsPromises.readdir(dir)).length === 0;
  } catch {
    return false;
  }
}

function sessionIdForRoot(rootId) {
  const session = (settings.syncSessions || []).find((candidate) => candidate.rootId === rootId);
  return session ? session.id : null;
}

/** The card model's `title`: the account's username, or the folder's own name. */
function rootTitleFor(root) {
  const session = (settings.syncSessions || []).find((candidate) => candidate.rootId === root.id);
  const accountId = session ? session.accountId : null;
  const account = currentAccounts().find((candidate) => candidate.id === accountId) || null;
  return (session && session.cached && session.cached.username) ||
    (account && account.username) ||
    (root.formerAccount && root.formerAccount.username) ||
    path.basename(root.path);
}

// C4 §5.2: everything the setup view draws, gathered before anything is created.
// No root, session or file exists until `setup-team`.
async function getTeamSetup(accountId) {
  const check = requireAccount(currentAccounts(), accountId);
  if (!check.ok) return check;

  const account = check.account;
  const roots = settings.roots || [];
  const suggestedFolder = await defaultTeamFolder(account.username, roots, {
    realPathOf: realpathNearestParent,
    exists: pathExists,
    isEmptyDir: dirIsEmpty,
    home: app.getPath('home'),
  });

  let port = null;
  try {
    port = await allocateTeamPort(roots);
  } catch (error) {
    errorLogger.error('App', 'Failed to allocate a port', error);
  }

  const preview = manager ? await manager.previewTeam(accountId) : { ok: false };
  const files = preview.ok ? preview.files : null;

  return {
    ok: true,
    accountId: account.id,
    username: account.username,
    displayName: account.displayName || account.username,
    role: account.role || null,
    suggestedFolder,
    folderIsNew: suggestedFolder ? !(await pathExists(suggestedFolder)) : false,
    port,
    files,
    bytes: files === null ? null : preview.bytes,
  };
}

/** CONTRACTS §8: the picker's answer is a folder and whether it is empty. */
async function chooseTeamFolder(accountId) {
  const check = requireAccount(currentAccounts(), accountId);
  if (!check.ok) return check;

  const account = check.account;
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: `Choose a folder for ${account.displayName || account.username}`,
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, error: 'cancelled' };

  const folder = result.filePaths[0];
  return { ok: true, folder, empty: await dirIsEmpty(folder) };
}

/** C4 §5.2: C3 creates the root and binds it; main only starts serving it. */
async function setupTeam(accountId, folder, trusted) {
  const check = requireAccount(currentAccounts(), accountId);
  if (!check.ok) return check;
  if (!manager) return { ok: false, error: 'unavailable' };

  const result = await manager.setupTeam({ accountId, folder, trusted });
  await pool.sync(rootsSnapshot(), { enabled: settings.serverEnabled });
  await afterRootsChanged();
  return result;
}

// C4 §4.9: sync stops, the folder stays on disk and is still served.
async function confirmAndDisconnect(sessionId) {
  const check = requireSession(settings.syncSessions, sessionId);
  if (!check.ok) return check;
  if (!manager) return { ok: false, error: 'unavailable' };

  const session = check.session;
  const root = (settings.roots || []).find((candidate) => candidate.id === session.rootId) || null;
  const cached = session.cached || {};
  const { response } = await dialog.showMessageBox(disconnectDialog({
    team: cached.displayName || cached.username || 'this team',
    folder: root ? root.path : '',
    port: root ? root.port : null,
  }));
  if (response !== 0) return { ok: false, error: 'cancelled' };

  const result = await manager.disconnect(sessionId);
  await afterRootsChanged();
  return result;
}

// C4 §4.9: the folder and its files stay; the port stops answering. Not offered
// for the personal folder, which moves through Options, `Change Personal Folder…`.
async function confirmAndRemoveFolder(rootId) {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const root = check.root;
  if (root.kind === 'personal') return { ok: false, error: 'personal' };
  if (!manager) return { ok: false, error: 'unavailable' };

  const { response } = await dialog.showMessageBox(removeFolderDialog({ folder: root.path, port: root.port }));
  if (response !== 0) return { ok: false, error: 'cancelled' };

  const result = await manager.removeRoot(rootId);
  await pool.sync(rootsSnapshot(), { enabled: settings.serverEnabled });
  await afterRootsChanged();
  return result;
}

async function openTeamWeb(accountId) {
  const check = requireAccount(currentAccounts(), accountId);
  if (!check.ok) return check;
  if (!check.account.webUrl) return { ok: false, error: 'no-url' };

  await shell.openExternal(check.account.webUrl);
  return { ok: true };
}

function cardMenuClick(card, action) {
  if (action === 'open') return () => openRootInBrowser(card.rootId);
  if (action === 'reveal') return () => revealRoot(card.rootId);
  if (action === 'backups') return () => openBackups(card.rootId);
  if (action === 'disconnect') return () => confirmAndDisconnect(card.sessionId || sessionIdForRoot(card.rootId));
  if (action === 'remove') return () => confirmAndRemoveFolder(card.rootId);
  return null;
}

/** C4 §4: the `⋯` menu of one card, as a native menu beside the popover. */
function showCardMenu(event, rootId) {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const root = check.root;
  const card = lastCards.find((candidate) => candidate.rootId === rootId) || {
    rootId,
    sessionId: null,
    kind: root.kind,
    actions: root.kind === 'personal' ? ['open', 'reveal', 'backups'] : ['open', 'reveal', 'backups', 'remove'],
  };

  const template = cardMenuModel(card).map((item) => {
    if (item.type === 'separator') return { type: 'separator' };
    const click = cardMenuClick(card, item.action);
    return click ? { label: item.label, click } : { label: item.label, enabled: false };
  });

  const win = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  Menu.buildFromTemplate(template).popup(win ? { window: win } : {});
  return { ok: true };
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

ipcMain.handle('select-folder', (event) => handleSelectFolder(event));

ipcMain.handle('get-state', async () => ({
  ...(await buildStatePayload()),
  availableUpdate,
  appVersion: app.getVersion()
}));

ipcMain.handle('copy-text', (event, text) => {
  clipboard.writeText(String(text ?? ''));
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

// C4 §5.2: only the two hyperclay https prefixes leave this app's own pages.
ipcMain.handle('open-browser', (event, url) => {
  if (!isAllowedExternalUrl(url)) return { ok: false, error: 'blocked' };

  shell.openExternal(url);
  return { ok: true };
});

// The two global switches, the team commands and the per-card commands (C4 §5.2).
// The renderer names ids; ports, paths and keys stay in main.
ipcMain.handle('set-server-enabled', (event, { on } = {}) => setServerEnabled(!!on));
ipcMain.handle('set-sync-enabled', (event, { on } = {}) => setSyncEnabled(!!on));
ipcMain.handle('refresh-accounts', () => handleRefreshAccounts());
ipcMain.handle('get-team-setup', (event, { accountId } = {}) => getTeamSetup(accountId));
ipcMain.handle('choose-team-folder', (event, { accountId } = {}) => chooseTeamFolder(accountId));
ipcMain.handle('setup-team', (event, { accountId, folder, trusted } = {}) => setupTeam(accountId, folder, trusted));
ipcMain.handle('disconnect', (event, { sessionId } = {}) => confirmAndDisconnect(sessionId));
ipcMain.handle('remove-folder', (event, { rootId } = {}) => confirmAndRemoveFolder(rootId));

ipcMain.handle('retry-port', async (event, { rootId } = {}) => {
  const check = requireRoot(settings.roots, rootId);
  if (!check.ok) return check;

  const result = await pool.retry(rootId);
  await afterRootsChanged();
  return result;
});

ipcMain.handle('change-port', (event, { rootId } = {}) => confirmAndChangePort(rootId));
ipcMain.handle('open-in-browser', (event, { rootId } = {}) => openRootInBrowser(rootId));
ipcMain.handle('reveal-folder', (event, { rootId } = {}) => revealRoot(rootId));
ipcMain.handle('open-backups', (event, { rootId } = {}) => openBackups(rootId));
ipcMain.handle('open-web', (event, { accountId } = {}) => openTeamWeb(accountId));
ipcMain.handle('show-card-menu', (event, { rootId } = {}) => showCardMenu(event, rootId));

ipcMain.handle('resolve-conflict', (event, { sessionId, path: filePath, choice } = {}) => {
  const check = requireSession(settings.syncSessions, sessionId);
  if (!check.ok) return check;
  if (!manager) return { ok: false, error: 'unavailable' };

  return manager.resolveConflict({ sessionId, path: filePath, choice });
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
    firstDiscoveryForKey = true;
    saveSettings(settings);
    if (manager) manager.adoptKey({ serverUrl: baseUrl });
    refreshDiscovery();

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
  syncDiscoveryTimer();
  return { success: true };
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

// Options menu IPC handler
ipcMain.handle('show-options-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [
    {
      label: 'Change Personal Folder…',
      click: () => handleSelectFolder(event)
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
      label: 'Sync Key…',
      click: () => {
        sendToPopover('show-credentials', {});
      }
    },
    {
      label: 'Refresh Teams',
      click: () => {
        handleRefreshAccounts();
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
  notifyNewTeam = createNewTeamNotifier({ settings, saveSettings, notify: notifyNewTeamAccount });

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

  // C3 §5.8: a laptop that wakes up refreshes discovery without a keystroke.
  powerMonitor.on('resume', () => refreshDiscovery());

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

    // C3 §5.8: the sessions are up, so the discovery timer starts. The launch
    // itself already discovered: `startEnabledSessions` refreshed the accounts
    // before it started every session (C3.11).
    syncDiscoveryTimer();

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

    await updateUI();
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
  sendActivityUpdate.cancel();
  if (manager) manager.stopDiscoveryTimer();
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

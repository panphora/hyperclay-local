const { app, BrowserWindow, dialog, shell, Menu, Tray, nativeImage, ipcMain, safeStorage } = require('electron');
const path = require('upath');
const fs = require('fs');
const crypto = require('crypto');
const { startServer, stopServer, getServerPort, isServerRunning } = require('./server');
const syncEngine = require('../sync-engine');
const syncLogger = require('../sync-engine/logger');
const errorLogger = require('./error-logger');
const { getServerBaseUrl } = require('./utils/utils');
const popover = require('./popover');

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

if (process.argv.includes('--dev')) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, '../../node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

// =============================================================================
// STATE AND STORAGE
// =============================================================================

let tray = null;
let serverRunning = false;
let selectedFolder = null;
let settings = {};
let isQuitting = false;
let availableUpdate = null;

const userData = app.getPath('userData');
const settingsPath = path.join(userData, 'settings.json');

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

    if (!loaded.deviceId) {
      loaded.deviceId = crypto.randomUUID();
      console.log(`[APP] Generated new device ID: ${loaded.deviceId}`);
      needsSave = true;
    }

    if (needsSave) {
      const settingsToSave = { ...loaded };
      fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));
    }

    return loaded;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return { deviceId: crypto.randomUUID() };
}

function saveSettings(settings) {
  try {
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }

    const settingsToSave = { ...settings };

    if (settingsToSave.apiKey) {
      // Only encrypt if the key is plaintext — avoid double-encrypting
      if (settingsToSave.apiKey.startsWith('hcsk_')) {
        settingsToSave.apiKey = encryptApiKey(settingsToSave.apiKey);
      }
      settingsToSave.hasApiKey = true;
    } else {
      settingsToSave.hasApiKey = false;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
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
    {
      label: `Server: ${serverRunning ? 'On' : 'Off'}`,
      enabled: false
    },
    {
      label: `Sync: ${settings.syncEnabled ? 'On' : 'Off'}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: serverRunning ? 'Stop Server' : 'Start Server',
      click: () => {
        if (serverRunning) {
          handleStopServer();
        } else {
          handleStartServer();
        }
      }
    },
    {
      label: settings.syncEnabled ? 'Disable Sync' : 'Enable Sync',
      enabled: !!(settings.hasApiKey && settings.syncFolder),
      click: async () => {
        if (settings.syncEnabled) {
          await handleSyncStop();
        } else {
          if (settings.hasApiKey && settings.syncFolder) {
            const apiKey = getDecryptedApiKey();
            if (apiKey) {
              await handleSyncStart(
                apiKey,
                settings.syncUsername,
                settings.syncFolder,
                settings.serverUrl
              );
            }
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Open Folder',
      enabled: !!selectedFolder,
      click: () => {
        if (selectedFolder) {
          shell.openPath(selectedFolder);
        }
      }
    },
    {
      label: 'Open Browser',
      enabled: serverRunning,
      click: () => {
        if (serverRunning) {
          shell.openExternal(`http://localhost:${getServerPort()}`);
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
  const syncStatus = syncEngine.getStatus();
  const statePayload = {
    selectedFolder,
    serverRunning,
    serverPort: getServerPort(),
    syncEnabled: settings.syncEnabled,
    syncStatus: syncStatus,
    syncStats: syncStatus.stats,
    syncUsername: settings.syncUsername,
    syncFolder: settings.syncFolder
  };

  sendToPopover('update-state', statePayload);
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

const EXAMPLE_APPS = [
  { url: 'https://kanban.hyperclay.com/download?file=1', filename: 'kanban.html' },
  { url: 'https://devlog.hyperclay.com/download?file=1', filename: 'devlog.html' },
  { url: 'https://landing.hyperclay.com/download?file=1', filename: 'landing.html' },
  { url: 'https://writer.hyperclay.com/download?file=1', filename: 'writer.html' },
];

async function populateExampleApps(folderPath) {
  const entries = fs.readdirSync(folderPath);
  const hasHtml = entries.some(f => f.endsWith('.html'));
  if (hasHtml) return;

  const results = await Promise.allSettled(
    EXAMPLE_APPS.map(async ({ url, filename }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const html = await res.text();
      fs.writeFileSync(path.join(folderPath, filename), html, 'utf-8');
    })
  );

  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('Failed to download example app:', r.reason.message);
    }
  }
}

async function handleSelectFolder(event) {
  const parentWin = event ? BrowserWindow.fromWebContents(event.sender) : null;
  const result = await dialog.showOpenDialog(parentWin, {
    properties: ['openDirectory'],
    title: 'Select folder containing your malleable HTML files'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    selectedFolder = result.filePaths[0];

    settings.selectedFolder = selectedFolder;
    saveSettings(settings);

    await populateExampleApps(selectedFolder);
    updateUI();
    return { success: true, folder: selectedFolder };
  }

  return { success: false };
}

async function handleStartServer() {
  if (!selectedFolder) {
    await handleSelectFolder();
    if (!selectedFolder) return;
  }

  try {
    await startServer(selectedFolder);
    serverRunning = isServerRunning();

    settings.serverEnabled = true;
    settings.serverFolder = selectedFolder;
    saveSettings(settings);

    updateUI();
    updateTrayMenu();

  } catch (error) {
    errorLogger.error('App', 'Failed to start server', error);
    dialog.showErrorBox('Server Error', `Failed to start server: ${error.message}`);
  }
}

async function handleStopServer() {
  try {
    await stopServer();
    serverRunning = isServerRunning();

    settings.serverEnabled = false;
    saveSettings(settings);

    updateUI();
    updateTrayMenu();
  } catch (error) {
    console.error('Error stopping server:', error);
    errorLogger.error('App', 'Failed to stop server', error);
    serverRunning = isServerRunning();
    updateUI();
    updateTrayMenu();
    dialog.showErrorBox('Server Error', `Failed to stop server: ${error.message}`);
  }
}

// =============================================================================
// SYNC EVENT HANDLERS
// =============================================================================

function setupSyncEventHandlers() {
  syncEngine.on('sync-start', data => {
    sendToPopover('sync-update', { syncing: true, ...data });
  });

  syncEngine.on('sync-complete', data => {
    sendToPopover('sync-update', { syncing: false, ...data });
  });

  syncEngine.on('sync-error', data => {
    sendToPopover('sync-update', {
      error: data.userMessage || data.error || data.originalError,
      priority: data.priority,
      dismissable: data.dismissable,
      type: data.type,
      file: data.file
    });
  });

  syncEngine.on('file-synced', data => {
    sendToPopover('file-synced', data);
  });

  syncEngine.on('sync-stats', data => {
    sendToPopover('sync-stats', data);
  });

  syncEngine.on('backup-created', data => {
    sendToPopover('backup-created', data);
  });

  syncEngine.on('sync-retry', data => {
    sendToPopover('sync-retry', data);
  });

  syncEngine.on('sync-failed', data => {
    sendToPopover('sync-failed', data);
  });
}

// =============================================================================
// SYNC HANDLERS
// =============================================================================

async function handleSyncStart(apiKey, username, syncFolder, serverUrl) {
  try {
    await syncLogger.init(syncFolder);
    syncEngine.setLogger(syncLogger);

    syncEngine.removeAllListeners();
    setupSyncEventHandlers();

    const result = await syncEngine.init(apiKey, username, syncFolder, serverUrl, settings.deviceId);

    if (result.success) {
      settings.syncEnabled = true;
      settings.apiKey = apiKey;
      settings.hasApiKey = true;
      settings.syncUsername = username;
      settings.syncFolder = syncFolder;
      settings.serverUrl = serverUrl;
      saveSettings(settings);
    }

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

async function handleSyncStop() {
  try {
    const result = await syncEngine.stop();

    settings.syncEnabled = false;
    saveSettings(settings);

    syncEngine.clearApiKey();
    syncEngine.removeAllListeners();

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
  selectedFolder,
  serverRunning,
  serverPort: getServerPort(),
  syncEnabled: settings.syncEnabled,
  syncStatus: syncEngine.getStatus(),
  availableUpdate
}));

ipcMain.handle('open-folder', () => {
  if (selectedFolder) {
    shell.openPath(selectedFolder);
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
  } else if (serverRunning) {
    shell.openExternal(`http://localhost:${getServerPort()}`);
  }
});

// Sync IPC handlers
ipcMain.handle('sync-start', async (event, { apiKey, username, syncFolder, serverUrl }) => {
  return await handleSyncStart(apiKey, username, syncFolder, serverUrl);
});

ipcMain.handle('sync-stop', async () => {
  return await handleSyncStop();
});

ipcMain.handle('sync-resume', async (event, selectedFolder, username) => {
  const folderToSync = selectedFolder || settings.syncFolder;
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
  return syncEngine.getStatus();
});

ipcMain.handle('get-sync-stats', () => {
  const status = syncEngine.getStatus();
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

    const response = await fetch(`${baseUrl}/sync/status`, {
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
  const folderToSync = selectedFolder || settings.syncFolder;

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
      enabled: !!selectedFolder,
      click: () => {
        if (selectedFolder) shell.openPath(selectedFolder);
      }
    },
    {
      label: 'Open in Browser',
      enabled: serverRunning,
      click: () => {
        if (serverRunning) shell.openExternal(`http://localhost:${getServerPort()}`);
      }
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
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

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
  selectedFolder = settings.selectedFolder || null;

  // Hide dock icon — app lives in tray only
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();

  checkForUpdates();

  // Auto-restart sync if it was enabled before quit
  if (settings.syncEnabled && settings.hasApiKey && settings.syncFolder) {
    console.log('[APP] Auto-restarting sync from previous session...');

    const apiKey = getDecryptedApiKey();
    if (apiKey) {
      const result = await handleSyncStart(
        apiKey,
        settings.syncUsername,
        settings.syncFolder,
        settings.serverUrl
      );

      if (result.success) {
        console.log('[APP] Sync auto-restart successful');
      } else {
        console.error('[APP] Sync auto-restart failed:', result);
        errorLogger.error('App', 'Sync auto-restart failed', result);
        settings.syncEnabled = false;
        saveSettings(settings);
      }
    } else {
      console.error('[APP] Failed to auto-restart sync: could not decrypt API key');
      errorLogger.error('App', 'Failed to auto-restart sync: could not decrypt API key');
      settings.syncEnabled = false;
      saveSettings(settings);
    }
  }

  // Auto-restart server if it was enabled before quit
  if (settings.serverEnabled && settings.serverFolder) {
    console.log('[APP] Auto-restarting server from previous session...');
    try {
      selectedFolder = settings.serverFolder;
      await startServer(selectedFolder);
      serverRunning = isServerRunning();
      updateTrayMenu();
      console.log('[APP] Server auto-restart successful');
    } catch (err) {
      console.error('[APP] Failed to auto-start server:', err);
      errorLogger.error('App', 'Failed to auto-start server', err);
      settings.serverEnabled = false;
      saveSettings(settings);
    }
  }

  // On first launch, auto-show popover so user isn't staring at an empty tray
  if (!settings.selectedFolder && !settings.syncFolder) {
    setTimeout(() => {
      if (tray) {
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
  popover.destroyPopover();

  if (isServerRunning() || syncEngine.isRunning) {
    event.preventDefault();

    try {
      if (syncEngine.isRunning) {
        console.log('[APP] Stopping sync engine before quit...');
        await syncEngine.stop();
        syncEngine.clearApiKey();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (isServerRunning()) {
        console.log('[APP] Stopping server before quit...');
        await stopServer();
        serverRunning = isServerRunning();
      }

      app.quit();
    } catch (error) {
      console.error('Error during quit cleanup:', error);
      errorLogger.error('App', 'Error during quit cleanup', error);
      app.quit();
    }
  }
});

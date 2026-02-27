const { app, BrowserWindow, dialog, shell, Menu, Tray, nativeImage, ipcMain, safeStorage } = require('electron');
const path = require('upath');
const fs = require('fs');
const crypto = require('crypto');
const { startServer, stopServer, getServerPort, isServerRunning } = require('./server');
const syncEngine = require('../sync-engine');
const syncLogger = require('../sync-engine/logger');
const { getServerBaseUrl } = require('./utils/utils');

// =============================================================================
// APP CONFIGURATION
// =============================================================================

// Set app name immediately for CMD+Tab on macOS - must be before app.whenReady()
app.setName('Hyperclay Local');
app.name = 'Hyperclay Local';

// Separate dev settings from production — different userData directory means
// different settings.json, API key, device ID, logs, everything.
const isDev = !app.isPackaged;
if (isDev) {
  app.setPath('userData', app.getPath('userData') + '-dev');
}

// Set app info for About panel on macOS
if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, '../../assets/icons/icon.png');
  const aboutOptions = {
    applicationName: 'Hyperclay Local',
    applicationVersion: '1.10.0',
    version: '1.10.0',
    copyright: 'Made with ❤️ for Hyperclay'
  };

  // Add icon if it exists
  if (fs.existsSync(iconPath)) {
    aboutOptions.iconPath = iconPath;
  }

  app.setAboutPanelOptions(aboutOptions);
}

// Enable live reload for development
if (process.argv.includes('--dev')) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, '../../node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

// =============================================================================
// STATE AND STORAGE
// =============================================================================

let mainWindow = null;
let tray = null;
let serverRunning = false;
let selectedFolder = null;
let settings = {};
let isQuitting = false;

const userData = app.getPath('userData');
const settingsPath = path.join(userData, 'settings.json');

/**
 * Encrypt API key using electron safeStorage
 */
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

  // Fallback to plaintext if encryption fails
  return apiKey;
}

/**
 * Decrypt API key using electron safeStorage
 */
function decryptApiKey(encryptedKey) {
  if (!encryptedKey) return null;

  try {
    // Check if key is already plaintext (migration case)
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

  // Fallback to assuming it's plaintext
  return encryptedKey;
}

/**
 * Get decrypted API key from settings (only when needed)
 * This triggers keychain access - use sparingly!
 */
function getDecryptedApiKey() {
  if (!settings.apiKey) return null;
  return decryptApiKey(settings.apiKey);
}

function loadSettings() {
  try {
    let settings = {};
    let needsSave = false;

    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(data);

      // Keep API key encrypted - don't decrypt at startup
      // Just set a flag to indicate one exists
      if (settings.apiKey) {
        settings.hasApiKey = true;

        // Check if this is a plaintext key that needs migration
        if (settings.apiKey.startsWith && settings.apiKey.startsWith('hcsk_')) {
          console.log('[SECURITY] Detected plaintext API key - will encrypt on next save');
          // Encrypt it now and save immediately
          const encryptedKey = encryptApiKey(settings.apiKey);
          settings.apiKey = encryptedKey;
          settings.hasApiKey = true;
          needsSave = true;
        }
      } else {
        settings.hasApiKey = false;
      }
    }

    // Generate device ID if not present (for multi-device sync support)
    if (!settings.deviceId) {
      settings.deviceId = crypto.randomUUID();
      console.log(`[APP] Generated new device ID: ${settings.deviceId}`);
      needsSave = true;
    }

    // Save if any changes were made
    if (needsSave) {
      const settingsToSave = { ...settings };
      fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));
    }

    return settings;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return { deviceId: crypto.randomUUID() };
}

function saveSettings(settings) {
  try {
    // Ensure userData directory exists
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }

    // Clone settings to avoid mutating original
    const settingsToSave = { ...settings };

    // Encrypt API key before saving and set hasApiKey flag
    if (settingsToSave.apiKey) {
      settingsToSave.apiKey = encryptApiKey(settingsToSave.apiKey);
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
    // Try tray-specific icon first
    // Note: Electron automatically loads @2x variant (tray-icon@2x.png) on Retina displays
    if (fs.existsSync(trayIconPath)) {
      const icon = nativeImage.createFromPath(trayIconPath);

      // On macOS, mark as template image so it adapts to light/dark menu bar
      if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
      }

      return icon;
    } else if (fs.existsSync(mainIconPath)) {
      // Fall back to main icon and resize it for tray
      const icon = nativeImage.createFromPath(mainIconPath);
      const size = process.platform === 'darwin' ? 22 : 16;
      return icon.resize({ width: size, height: size });
    }
  } catch (error) {
    // Fallback to a simple colored square
    console.error('Failed to load tray icon:', error);
  }

  // Return a simple fallback icon
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFYSURBVDiNpZM9SwNBEIafgwQSCxsLwcJCG1sLG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sL');
}

// =============================================================================
// TRAY MENU MANAGEMENT
// =============================================================================

function getTrayMenuTemplate() {
  const isAppVisible = mainWindow && mainWindow.isVisible();

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
      label: isAppVisible ? 'Hide App' : 'Show App',
      click: () => {
        if (isAppVisible) {
          // Hide from Dock and Cmd+Tab
          if (process.platform === 'darwin') {
            app.dock.hide();
            mainWindow?.hide();
          } else {
            mainWindow?.hide();
          }
        } else {
          // Show in Dock and Cmd+Tab
          if (process.platform === 'darwin') {
            app.dock.show();
          }
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      }
    },
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
            // Decrypt API key only when starting sync (triggers keychain prompt)
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
    // On macOS, context menu is built fresh on each right-click via popUpContextMenu
  }
}

// =============================================================================
// UI UPDATE
// =============================================================================

function updateUI() {
  if (mainWindow) {
    const syncStatus = syncEngine.getStatus();

    mainWindow.webContents.send('update-state', {
      selectedFolder,
      serverRunning,
      serverPort: getServerPort(),
      syncEnabled: settings.syncEnabled,
      syncStatus: syncStatus,
      syncStats: syncStatus.stats,
      syncUsername: settings.syncUsername,
      syncFolder: settings.syncFolder
    });
  }
}

// =============================================================================
// VERSION CHECK
// =============================================================================

/**
 * Compare two semver version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
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

/**
 * Check for updates from CDN
 */
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
      if (mainWindow) {
        mainWindow.webContents.send('update-available', {
          currentVersion,
          latestVersion: remoteVersion
        });
      }
    } else {
      console.log('[UPDATE] App is up to date');
    }
  } catch (error) {
    // Silently fail - don't bother user if check fails
    console.log('[UPDATE] Update check failed:', error.message);
  }
}

// =============================================================================
// WINDOW CREATION
// =============================================================================

function getWindowOptions() {
  const iconPath = getAppIcon();
  const options = {
    title: 'Hyperclay Local',
    width: 720,
    height: 710,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  };

  if (iconPath) {
    options.icon = iconPath;
  }

  return options;
}

function createWindow() {
  mainWindow = new BrowserWindow(getWindowOptions());
  mainWindow.loadFile(path.join(__dirname, '../renderer/app.html'));

  // Show window when ready — start hidden unless first launch
  mainWindow.once('ready-to-show', () => {
    if (!settings.syncEnabled && !settings.selectedFolder && !settings.syncFolder) {
      // First launch — show window for setup
      mainWindow.show();
      if (process.platform === 'darwin') {
        app.focus();
      }
    } else {
      // Returning user — start hidden in tray
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
    }

    updateUI();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Update tray menu when window visibility changes
  mainWindow.on('show', () => {
    updateTrayMenu();
  });

  mainWindow.on('hide', () => {
    updateTrayMenu();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Add context menu with copy functionality
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { selectionText, isEditable } = params;

    if (selectionText || isEditable) {
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Copy', role: 'copy', enabled: selectionText.length > 0 },
        { label: 'Cut', role: 'cut', enabled: isEditable && selectionText.length > 0 },
        { label: 'Paste', role: 'paste', enabled: isEditable },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll' }
      ]);

      contextMenu.popup();
    }
  });

  // Create system tray
  createTray();

  // Create menu
  createMenu();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
    mainWindow.hide();
  } else {
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Hyperclay Local Server');

  // Left-click toggles window, right-click opens context menu
  tray.on('click', () => {
    toggleWindow();
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate(getTrayMenuTemplate());
    tray.popUpContextMenu(contextMenu);
  });

  // On non-macOS, also set context menu normally (left-click doesn't steal menu there)
  if (process.platform !== 'darwin') {
    const contextMenu = Menu.buildFromTemplate(getTrayMenuTemplate());
    tray.setContextMenu(contextMenu);
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: handleSelectFolder
        },
        { type: 'separator' },
        {
          label: 'Start Server',
          accelerator: 'CmdOrCtrl+R',
          click: handleStartServer,
          enabled: !serverRunning
        },
        {
          label: 'Stop Server',
          accelerator: 'CmdOrCtrl+S',
          click: handleStopServer,
          enabled: serverRunning
        },
        { type: 'separator' },
        process.platform === 'darwin' ?
          { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' } :
          { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Hyperclay Local',
          click: () => {
            const iconPath = getAppIcon();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Hyperclay Local',
              message: 'Hyperclay Local Server v1.1.0',
              detail: 'A local server for running your malleable HTML files offline.\n\nMade with ❤️ for the Hyperclay platform.',
              buttons: ['OK'],
              icon: iconPath || undefined
            });
          }
        },
        {
          label: 'Visit Hyperclay.com',
          click: () => {
            shell.openExternal('https://hyperclay.com');
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: 'About ' + app.getName(), role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: 'Hide ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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

async function handleSelectFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder containing your malleable HTML files'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    selectedFolder = result.filePaths[0];

    // Save to persistent storage
    settings.selectedFolder = selectedFolder;
    saveSettings(settings);

    await populateExampleApps(selectedFolder);
    updateUI();
  }
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

    // Auto-open browser
    shell.openExternal(`http://localhost:${getServerPort()}`);

  } catch (error) {
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
    mainWindow?.webContents.send('sync-update', {
      syncing: true,
      ...data
    });
  });

  syncEngine.on('sync-complete', data => {
    mainWindow?.webContents.send('sync-update', {
      syncing: false,
      ...data
    });
  });

  syncEngine.on('sync-error', data => {
    mainWindow?.webContents.send('sync-update', {
      error: data.userMessage || data.error || data.originalError,
      priority: data.priority,
      dismissable: data.dismissable,
      type: data.type,
      file: data.file
    });
  });

  syncEngine.on('file-synced', data => {
    mainWindow?.webContents.send('file-synced', data);
  });

  syncEngine.on('sync-stats', data => {
    mainWindow?.webContents.send('sync-stats', data);
  });

  syncEngine.on('backup-created', data => {
    mainWindow?.webContents.send('backup-created', data);
  });

  syncEngine.on('sync-retry', data => {
    mainWindow?.webContents.send('sync-retry', data);
  });

  syncEngine.on('sync-failed', data => {
    mainWindow?.webContents.send('sync-failed', data);
  });
}

// =============================================================================
// SYNC HANDLERS
// =============================================================================

async function handleSyncStart(apiKey, username, syncFolder, serverUrl) {
  try {
    // Initialize logger with sync folder
    await syncLogger.init(syncFolder);

    // Set logger on sync engine
    syncEngine.setLogger(syncLogger);

    // Wire up event handlers before starting
    syncEngine.removeAllListeners();
    setupSyncEventHandlers();

    const result = await syncEngine.init(apiKey, username, syncFolder, serverUrl, settings.deviceId);

    if (result.success) {
      // Persist ALL settings including API key
      settings.syncEnabled = true;
      settings.apiKey = apiKey;
      settings.hasApiKey = true; // Update flag in memory
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

    // Update settings but keep API key for potential restart
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

// Server IPC handlers
ipcMain.handle('select-folder', handleSelectFolder);
ipcMain.handle('start-server', handleStartServer);
ipcMain.handle('stop-server', handleStopServer);

ipcMain.handle('get-state', () => ({
  selectedFolder,
  serverRunning,
  serverPort: getServerPort(),
  syncStatus: syncEngine.getStatus()
}));

ipcMain.handle('open-folder', () => {
  if (selectedFolder) {
    shell.openPath(selectedFolder);
  }
});

ipcMain.handle('open-logs', () => {
  // Open the sync logs directory
  const logsPath = app.getPath('logs');
  const syncLogsPath = path.join(logsPath, 'sync');
  shell.openPath(syncLogsPath);
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
  // Resume sync with stored credentials (decrypts API key - triggers keychain)
  // Use provided values if available, fallback to saved settings
  const folderToSync = selectedFolder || settings.syncFolder;
  const usernameToUse = username || settings.syncUsername;

  if (!settings.hasApiKey) {
    return { error: 'No stored credentials to resume sync' };
  }

  if (!folderToSync) {
    return { error: 'No folder selected for sync' };
  }

  const apiKey = getDecryptedApiKey();
  if (!apiKey) {
    return { error: 'Failed to decrypt stored API key' };
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

    // Validate key with server
    const response = await fetch(`${baseUrl}/sync/status`, {
      headers: { 'X-API-Key': key }
    });

    if (!response.ok) {
      return { error: 'Invalid or expired API key' };
    }

    const data = await response.json();

    // Store settings
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
  // Use selectedFolder (current folder) as priority, fallback to saved syncFolder
  const folderToSync = selectedFolder || settings.syncFolder;

  if (enabled && !folderToSync) {
    return { error: 'Please select a folder before enabling sync' };
  }

  if (enabled && !settings.hasApiKey) {
    return { error: 'Please connect with API key first' };
  }

  if (enabled) {
    // Decrypt API key (triggers keychain prompt)
    const apiKey = getDecryptedApiKey();

    if (!apiKey) {
      return { error: 'Failed to decrypt API key' };
    }

    // Start sync with existing settings
    return await handleSyncStart(
      apiKey,
      settings.syncUsername,
      folderToSync,  // Use the current selected folder
      settings.serverUrl
    );
  } else {
    // Stop sync
    return await handleSyncStop();
  }
});

// Window resize IPC handler
ipcMain.handle('resize-window', (event, height) => {
  if (mainWindow && height) {
    const currentSize = mainWindow.getSize();
    const minHeight = 500;
    const maxHeight = 900;

    // Clamp height between min and max
    const newHeight = Math.max(minHeight, Math.min(maxHeight, height));

    mainWindow.setSize(currentSize[0], newHeight, true); // true = animate
  }
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app.whenReady().then(async () => {
  // Ensure app name is set again after ready
  app.setName('Hyperclay Local');

  // Log environment mode
  const baseUrl = getServerBaseUrl();
  const isDev = baseUrl.includes('localhyperclay');
  console.log(`[APP] Running in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);
  console.log(`[APP] Sync will use: ${baseUrl}`);

  // Handle certificate errors for local development
  if (isDev) {
    // Allow self-signed certificates for localhyperclay.com in development
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
      if (url.startsWith('https://localhyperclay.com')) {
        // Ignore certificate error for local development
        event.preventDefault();
        callback(true);
      } else {
        // Use default behavior for other URLs
        callback(false);
      }
    });

    // For Node.js fetch in main process, we need to configure it differently
    // This is a workaround for development with self-signed certificates
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
    console.log('[APP] Disabled certificate validation for local development');
  }

  // Load settings on startup
  settings = loadSettings();
  selectedFolder = settings.selectedFolder || null;

  // Set app icon for dock/taskbar
  const iconPath = getAppIcon();
  if (iconPath) {
    const icon = nativeImage.createFromPath(iconPath);
    app.dock?.setIcon(icon); // macOS dock
  }

  createWindow();

  // Check for updates on startup
  checkForUpdates();

  // Auto-restart sync if it was enabled before quit
  if (settings.syncEnabled && settings.hasApiKey && settings.syncFolder) {
    console.log('[APP] Auto-restarting sync from previous session...');

    try {
      // Decrypt API key (this triggers keychain prompt during auto-restart)
      const apiKey = getDecryptedApiKey();

      if (!apiKey) {
        throw new Error('Failed to decrypt API key');
      }

      // Initialize logger with sync folder
      await syncLogger.init(settings.syncFolder);

      // Set logger on sync engine
      syncEngine.setLogger(syncLogger);

      // Wire up event handlers using the shared function
      syncEngine.removeAllListeners();
      setupSyncEventHandlers();

      // Initialize sync
      const result = await syncEngine.init(
        apiKey,
        settings.syncUsername,
        settings.syncFolder,
        settings.serverUrl,
        settings.deviceId
      );

      if (result.success) {
        console.log('[APP] Sync auto-restart successful');
        // Note: Settings are already saved from previous session, no need to save again
      } else {
        console.error('[APP] Sync auto-restart failed:', result);
        // Clear sync settings on failure
        settings.syncEnabled = false;
        saveSettings(settings);
      }
    } catch (error) {
      console.error('[APP] Failed to auto-restart sync:', error);
      settings.syncEnabled = false;
      saveSettings(settings);
    }

    updateUI();
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
      settings.serverEnabled = false;
      saveSettings(settings);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // If we're quitting, let the quit proceed
  // Otherwise keep app running in system tray
  if (isQuitting) {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  isQuitting = true;

  // Stop both server and sync engine before quitting
  if (isServerRunning() || syncEngine.isRunning) {
    event.preventDefault(); // Prevent immediate quit

    try {
      // Stop sync engine if running (keep syncEnabled true for auto-restart on next launch)
      if (syncEngine.isRunning) {
        console.log('[APP] Stopping sync engine before quit...');
        await syncEngine.stop();
        syncEngine.clearApiKey();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Stop server if running
      if (isServerRunning()) {
        console.log('[APP] Stopping server before quit...');
        await stopServer();
        serverRunning = isServerRunning();
      }

      app.quit(); // Now quit after cleanup
    } catch (error) {
      console.error('Error during quit cleanup:', error);
      app.quit(); // Quit anyway
    }
  }
});
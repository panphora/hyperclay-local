const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  getState: () => ipcRenderer.invoke('get-state'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),

  // Sync methods
  syncStart: (apiKey, username, syncFolder, serverUrl) => ipcRenderer.invoke('sync-start', { apiKey, username, syncFolder, serverUrl }),
  syncStop: () => ipcRenderer.invoke('sync-stop'),
  syncResume: (selectedFolder) => ipcRenderer.invoke('sync-resume', selectedFolder),
  syncStatus: () => ipcRenderer.invoke('sync-status'),

  // API key and settings methods
  setApiKey: (key, serverUrl) => ipcRenderer.invoke('set-api-key', key, serverUrl),
  getApiKeyInfo: () => ipcRenderer.invoke('get-api-key-info'),
  removeApiKey: () => ipcRenderer.invoke('remove-api-key'),
  toggleSync: (enabled) => ipcRenderer.invoke('toggle-sync', enabled),
  getSyncStats: () => ipcRenderer.invoke('get-sync-stats'),

  // Window management
  resizeWindow: (height) => ipcRenderer.invoke('resize-window', height),

  // Listen for state updates
  onStateUpdate: (callback) => {
    ipcRenderer.on('update-state', (_event, state) => callback(state));
  },

  // Sync event listeners
  onSyncUpdate: (callback) => {
    ipcRenderer.on('sync-update', (_event, data) => callback(data));
  },

  onFileSynced: (callback) => {
    ipcRenderer.on('file-synced', (_event, data) => callback(data));
  },

  onSyncStats: (callback) => {
    ipcRenderer.on('sync-stats', (_event, data) => callback(data));
  },

  // Backup event listener
  onBackupCreated: (callback) => {
    ipcRenderer.on('backup-created', (_event, data) => callback(data));
  },

  // Retry and failure event listeners
  onSyncRetry: (callback) => {
    ipcRenderer.on('sync-retry', (_event, data) => callback(data));
  },

  onSyncFailed: (callback) => {
    ipcRenderer.on('sync-failed', (_event, data) => callback(data));
  },

  // Update available listener
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, data) => callback(data));
  },

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
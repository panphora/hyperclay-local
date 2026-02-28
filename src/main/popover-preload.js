const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  getState: () => ipcRenderer.invoke('get-state'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),

  syncStart: (apiKey, username, syncFolder, serverUrl) => ipcRenderer.invoke('sync-start', { apiKey, username, syncFolder, serverUrl }),
  syncStop: () => ipcRenderer.invoke('sync-stop'),
  syncResume: (selectedFolder, username) => ipcRenderer.invoke('sync-resume', selectedFolder, username),

  setApiKey: (key, serverUrl) => ipcRenderer.invoke('set-api-key', key, serverUrl),
  getApiKeyInfo: () => ipcRenderer.invoke('get-api-key-info'),
  removeApiKey: () => ipcRenderer.invoke('remove-api-key'),
  toggleSync: (enabled) => ipcRenderer.invoke('toggle-sync', enabled),
  getSyncStats: () => ipcRenderer.invoke('get-sync-stats'),

  showOptionsMenu: () => ipcRenderer.invoke('show-options-menu'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  onStateUpdate: (callback) => {
    ipcRenderer.on('update-state', (_event, state) => callback(state));
  },

  onSyncUpdate: (callback) => {
    ipcRenderer.on('sync-update', (_event, data) => callback(data));
  },

  onFileSynced: (callback) => {
    ipcRenderer.on('file-synced', (_event, data) => callback(data));
  },

  onSyncStats: (callback) => {
    ipcRenderer.on('sync-stats', (_event, data) => callback(data));
  },

  onSyncRetry: (callback) => {
    ipcRenderer.on('sync-retry', (_event, data) => callback(data));
  },

  onSyncFailed: (callback) => {
    ipcRenderer.on('sync-failed', (_event, data) => callback(data));
  },

  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, data) => callback(data));
  },

  onArrowX: (callback) => {
    ipcRenderer.on('popover-arrow-x', (_event, x) => callback(x));
  },

  onShowCredentials: (callback) => {
    ipcRenderer.on('show-credentials', (_event) => callback());
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

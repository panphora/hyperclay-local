const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  getApiKeyInfo: () => ipcRenderer.invoke('get-api-key-info'),
  openSettings: (tab) => ipcRenderer.invoke('open-settings', tab),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleSync: (enabled) => ipcRenderer.invoke('toggle-sync', enabled),

  onStateUpdate: (callback) => {
    ipcRenderer.on('update-state', (_event, state) => callback(state));
  },

  onSyncUpdate: (callback) => {
    ipcRenderer.on('sync-update', (_event, data) => callback(data));
  },

  onSyncStats: (callback) => {
    ipcRenderer.on('sync-stats', (_event, data) => callback(data));
  },

  onArrowX: (callback) => {
    ipcRenderer.on('popover-arrow-x', (_event, x) => callback(x));
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

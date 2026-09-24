const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getState: () => ipcRenderer.invoke('get-state'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),

  setApiKey: (key, serverUrl) => ipcRenderer.invoke('set-api-key', key, serverUrl),
  getApiKeyInfo: () => ipcRenderer.invoke('get-api-key-info'),
  removeApiKey: () => ipcRenderer.invoke('remove-api-key'),

  setServerEnabled: (on) => ipcRenderer.invoke('set-server-enabled', { on }),
  setSyncEnabled: (on) => ipcRenderer.invoke('set-sync-enabled', { on }),
  refreshAccounts: () => ipcRenderer.invoke('refresh-accounts'),
  getTeamSetup: (accountId) => ipcRenderer.invoke('get-team-setup', { accountId }),
  chooseTeamFolder: (accountId) => ipcRenderer.invoke('choose-team-folder', { accountId }),
  setupTeam: (accountId, folder, trusted) => ipcRenderer.invoke('setup-team', { accountId, folder, trusted }),
  resolveConflict: (sessionId, path, choice) => ipcRenderer.invoke('resolve-conflict', { sessionId, path, choice }),
  disconnect: (sessionId) => ipcRenderer.invoke('disconnect', { sessionId }),
  removeFolder: (rootId) => ipcRenderer.invoke('remove-folder', { rootId }),
  retryPort: (rootId) => ipcRenderer.invoke('retry-port', { rootId }),
  changePort: (rootId) => ipcRenderer.invoke('change-port', { rootId }),
  openInBrowser: (rootId) => ipcRenderer.invoke('open-in-browser', { rootId }),
  revealFolder: (rootId) => ipcRenderer.invoke('reveal-folder', { rootId }),
  openBackups: (rootId) => ipcRenderer.invoke('open-backups', { rootId }),
  openWeb: (accountId) => ipcRenderer.invoke('open-web', { accountId }),
  showCardMenu: (rootId) => ipcRenderer.invoke('show-card-menu', { rootId }),

  showOptionsMenu: () => ipcRenderer.invoke('show-options-menu'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  onStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('update-state', handler);
    return () => ipcRenderer.removeListener('update-state', handler);
  },

  onSyncUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync-update', handler);
    return () => ipcRenderer.removeListener('sync-update', handler);
  },

  onFileSynced: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('file-synced', handler);
    return () => ipcRenderer.removeListener('file-synced', handler);
  },

  onSyncStats: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync-stats', handler);
    return () => ipcRenderer.removeListener('sync-stats', handler);
  },

  onSyncRetry: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync-retry', handler);
    return () => ipcRenderer.removeListener('sync-retry', handler);
  },

  onSyncFailed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync-failed', handler);
    return () => ipcRenderer.removeListener('sync-failed', handler);
  },

  onUpdateAvailable: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },

  onArrowX: (callback) => {
    const handler = (_event, x) => callback(x);
    ipcRenderer.on('popover-arrow-x', handler);
    return () => ipcRenderer.removeListener('popover-arrow-x', handler);
  },

  onArrowPosition: (callback) => {
    const handler = (_event, pos) => callback(pos);
    ipcRenderer.on('popover-arrow-position', handler);
    return () => ipcRenderer.removeListener('popover-arrow-position', handler);
  },

  onShowCredentials: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('show-credentials', handler);
    return () => ipcRenderer.removeListener('show-credentials', handler);
  },

  onShowTeamSetup: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('show-team-setup', handler);
    return () => ipcRenderer.removeListener('show-team-setup', handler);
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  getState: () => ipcRenderer.invoke('get-state'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openBrowser: () => ipcRenderer.invoke('open-browser'),
  
  // Listen for state updates
  onStateUpdate: (callback) => {
    ipcRenderer.on('update-state', (_event, state) => callback(state));
  },
  
  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
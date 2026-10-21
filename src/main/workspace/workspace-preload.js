const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback is required');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function listenForFlush(callback) {
  const stop = listen('workspace-flush-request', callback);
  ipcRenderer.send('workspace-flush-listener', true);
  return () => {
    stop();
    ipcRenderer.send('workspace-flush-listener', false);
  };
}

contextBridge.exposeInMainWorld('workspaceNative', {
  onNavigate: callback => listen('workspace-navigate', callback),
  onFlushRequest: callback => listenForFlush(callback),
  onPermissionRefused: callback => listen('workspace-permission-refused', callback),
  flushResult: result => ipcRenderer.invoke('workspace-flush-result', result),
  openExternal: url => ipcRenderer.invoke('workspace-open-external', url),
});

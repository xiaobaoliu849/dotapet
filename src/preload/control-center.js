const { contextBridge, ipcRenderer } = require('electron');

// The sidebar only switches pages and folds itself; each page has its own narrow preload.
contextBridge.exposeInMainWorld('controlCenter', {
  state: () => ipcRenderer.invoke('hub:state'),
  navigate: page => ipcRenderer.invoke('hub:navigate', page),
  setSidebarCollapsed: collapsed => ipcRenderer.invoke('hub:set-sidebar-collapsed', collapsed),
  onState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('hub:state', listener);
    return () => ipcRenderer.removeListener('hub:state', listener);
  },
});

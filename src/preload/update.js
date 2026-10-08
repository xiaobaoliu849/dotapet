const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petUpdates', {
  action: action => ipcRenderer.invoke('update:action', action),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
});

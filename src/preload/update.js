const { contextBridge, ipcRenderer } = require('electron');
// The chosen language and its dictionary, before the page draws anything.
contextBridge.exposeInMainWorld('dotapetI18n', ipcRenderer.sendSync('i18n:get'));
contextBridge.exposeInMainWorld('petUpdates', {
  action: action => ipcRenderer.invoke('update:action', action),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
});

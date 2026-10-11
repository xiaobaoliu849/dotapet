const { contextBridge, ipcRenderer } = require('electron');
// The chosen language and its dictionary, before the page draws anything.
contextBridge.exposeInMainWorld('dotapetI18n', ipcRenderer.sendSync('i18n:get'));

// The sidebar only switches pages and folds itself; each page has its own narrow preload.
contextBridge.exposeInMainWorld('controlCenter', {
  state: () => ipcRenderer.invoke('hub:state'),
  navigate: page => ipcRenderer.invoke('hub:navigate', page),
  setSidebarCollapsed: collapsed => ipcRenderer.invoke('hub:set-sidebar-collapsed', collapsed),
  slide: x => ipcRenderer.send('hub:slide', x),
  setLanguage: choice => ipcRenderer.invoke('hub:set-language', choice),
  onState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('hub:state', listener);
    return () => ipcRenderer.removeListener('hub:state', listener);
  },
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get-config'),
  saveShortcuts: shortcuts => ipcRenderer.invoke('shortcuts:save-config', shortcuts),
  resetShortcuts: () => ipcRenderer.invoke('shortcuts:reset-defaults'),
  onShortcutsChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('shortcuts:changed', listener);
    return () => ipcRenderer.removeListener('shortcuts:changed', listener);
  },
});

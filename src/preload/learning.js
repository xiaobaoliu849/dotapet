const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dotapetI18n', ipcRenderer.sendSync('i18n:get'));
contextBridge.exposeInMainWorld('learningAPI', {
  load: () => ipcRenderer.invoke('learning:load'),
  save: (id, action, value) => ipcRenderer.invoke('learning:progress', id, action, value),
  update: () => ipcRenderer.invoke('learning:update'),
  sources: () => ipcRenderer.invoke('learning:sources'),
  onProgress: callback => ipcRenderer.on('learning:update-progress', (_event, state) => callback(state)),
  onHidden: callback => ipcRenderer.on('learning:hidden', callback),
});

const { contextBridge, ipcRenderer } = require('electron');
// The chosen language and its dictionary, before the page draws anything.
contextBridge.exposeInMainWorld('dotapetI18n', ipcRenderer.sendSync('i18n:get'));
contextBridge.exposeInMainWorld('chatRegion', {
  load: () => ipcRenderer.invoke('chat-region:load'),
  finish: region => ipcRenderer.invoke('chat-region:finish', region),
});

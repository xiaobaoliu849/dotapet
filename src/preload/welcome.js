const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('welcomeAPI', {
  action: action => ipcRenderer.invoke('welcome:action', action),
});

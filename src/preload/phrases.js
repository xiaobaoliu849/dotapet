const { contextBridge, ipcRenderer } = require('electron');
// The chosen language and its dictionary, before the page draws anything.
contextBridge.exposeInMainWorld('dotapetI18n', ipcRenderer.sendSync('i18n:get'));

// The phrase editor (settings page and F6 panel) needs only its own actions.
contextBridge.exposeInMainWorld('electronAPI', {
  getPhrasesConfig: () => ipcRenderer.invoke('phrases:get-config'),
  savePhrasesConfig: phrases => ipcRenderer.invoke('phrases:save-config', phrases),
  translatePhraseText: text => ipcRenderer.invoke('phrases:translate-text', text),
  copyToClipboard: text => ipcRenderer.send('clipboard:write', text),
  onPhrasesChanged: callback => {
    const listener = (_event, phrases) => callback(phrases);
    ipcRenderer.on('phrases:changed', listener);
    return () => ipcRenderer.removeListener('phrases:changed', listener);
  },
});

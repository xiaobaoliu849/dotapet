const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('customizationAPI', {
  get: () => ipcRenderer.invoke('customization:get'),
  importImage: payload => ipcRenderer.invoke('customization:import-image', payload),
  saveProfile: payload => ipcRenderer.invoke('customization:save-profile', payload),
  activate: key => ipcRenderer.invoke('customization:activate', key),
  updateAsset: payload => ipcRenderer.invoke('customization:update-asset', payload),
  removeAsset: id => ipcRenderer.invoke('customization:remove-asset', id),
  savePreset: payload => ipcRenderer.invoke('customization:save-preset', payload),
  removePreset: id => ipcRenderer.invoke('customization:remove-preset', id),
  exportPreset: id => ipcRenderer.invoke('customization:export-preset', id),
  importPreset: () => ipcRenderer.invoke('customization:import-preset'),
  onChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('customization:changed', listener);
    return () => ipcRenderer.removeListener('customization:changed', listener);
  },
});

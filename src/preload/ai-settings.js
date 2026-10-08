const { contextBridge, ipcRenderer } = require('electron');

// The settings window has no clipboard, game input, GSI, or window-control API.
contextBridge.exposeInMainWorld('electronAPI', {
  getAISettings: () => ipcRenderer.invoke('ai:get-settings'),
  saveAISettings: settings => ipcRenderer.invoke('ai:save-settings', settings),
  deleteAISecrets: provider => ipcRenderer.invoke('ai:delete-secrets', provider),
  importAIConfig: () => ipcRenderer.invoke('ai:import-config'),
  testAIConnection: provider => ipcRenderer.invoke('ai:test-connection', provider),
  testTextConnection: provider => ipcRenderer.invoke('ai:test-text', provider),
  cancelAITest: () => ipcRenderer.invoke('ai:cancel-test'),
  connectAI: provider => ipcRenderer.invoke('ai:connect', provider),
  disconnectAI: () => ipcRenderer.invoke('ai:disconnect'),
  openMicrophonePrivacy: () => ipcRenderer.invoke('ai:microphone-privacy'),
  onSettingsPurpose: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('settings:purpose', listener);
    return () => ipcRenderer.removeListener('settings:purpose', listener);
  },
  onVoiceStatus: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('voice:status', listener);
    return () => ipcRenderer.removeListener('voice:status', listener);
  },
});

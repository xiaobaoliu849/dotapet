const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dotapetI18n', ipcRenderer.sendSync('i18n:get'));
contextBridge.exposeInMainWorld('learningAPI', {
  load: () => ipcRenderer.invoke('learning:load'),
  save: (id, action, value) => ipcRenderer.invoke('learning:progress', id, action, value),
  startSession: options => ipcRenderer.invoke('learning:start-session', options),
  answerSession: (sessionId, lessonId, choice) => ipcRenderer.invoke('learning:answer-session', sessionId, lessonId, choice),
  update: () => ipcRenderer.invoke('learning:update'),
  sources: () => ipcRenderer.invoke('learning:sources'),
  practiceVoice: persona => ipcRenderer.invoke('learning:practice-voice', persona),
  stopVoice: () => ipcRenderer.invoke('learning:stop-voice'),
  onProgress: callback => ipcRenderer.on('learning:update-progress', (_event, state) => callback(state)),
  onVoiceStatus: callback => ipcRenderer.on('learning:voice-status', (_event, data) => callback(data)),
  onVoiceEvent: callback => ipcRenderer.on('learning:voice-event', (_event, data) => callback(data)),
  onHidden: callback => ipcRenderer.on('learning:hidden', callback),
});

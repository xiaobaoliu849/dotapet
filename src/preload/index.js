const { contextBridge, ipcRenderer, webFrame } = require('electron');

try {
  webFrame.setVisualZoomLevelLimits(1, 1);
  webFrame.setZoomFactor(1);
} catch (e) {}

contextBridge.exposeInMainWorld('electronAPI', {
  openCustomization: () => ipcRenderer.invoke('customization:open'),
  getCustomization: () => ipcRenderer.invoke('customization:get'),
  migrateCustomization: entries => ipcRenderer.invoke('customization:migrate', entries),
  onCustomizationChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('customization:changed', listener);
    return () => ipcRenderer.removeListener('customization:changed', listener);
  },
  onCustomizationActivate: callback => {
    const listener = (_event, key) => callback(key);
    ipcRenderer.on('customization:activate', listener);
    return () => ipcRenderer.removeListener('customization:activate', listener);
  },
  openAISettings: purpose => ipcRenderer.send('ai:open-settings', purpose),
  openWelcome: () => ipcRenderer.send('welcome:open'),
  // Hit-testing / Click-through
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },

  // Window Movement & Position
  startDrag: (screenX, screenY) => {
    ipcRenderer.send('window:drag-start', { screenX, screenY });
  },
  moveDrag: (screenX, screenY) => {
    ipcRenderer.send('window:drag-move', { screenX, screenY });
  },
  endDrag: () => {
    ipcRenderer.send('window:drag-end');
  },
  snapWindowTo: (position) => {
    ipcRenderer.send('window:snap-to', position);
  },
  centerWindow: () => {
    ipcRenderer.send('window:center');
  },

  // Position Pin: lock the companion so it can't be dragged or wander off
  setWindowPinned: (pinned) => {
    ipcRenderer.send('window:set-pinned', pinned);
  },
  getWindowPinned: () => ipcRenderer.invoke('window:get-pinned'),
  onWindowPinnedChanged: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('window:pinned-changed', subscription);
    return () => ipcRenderer.removeListener('window:pinned-changed', subscription);
  },

  // Companion Scaling & Compact Modes
  getScaleMode: () => ipcRenderer.invoke('window:get-scale'),
  setScaleMode: (mode) => ipcRenderer.send('window:set-scale', mode),
  cycleScaleMode: () => ipcRenderer.send('window:cycle-scale'),
  onScaleChanged: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('window:scale-changed', subscription);
    return () => ipcRenderer.removeListener('window:scale-changed', subscription);
  },

  // Voice Events & Streaming
  sendAudioChunk: (chunk) => {
    ipcRenderer.send('voice:send-audio-chunk', chunk);
  },
  setVoiceProvider: (provider) => {
    ipcRenderer.send('voice:set-provider', provider);
  },
  cycleVoiceProvider: () => {
    ipcRenderer.send('voice:cycle-provider');
  },
  getCurrentVoiceProvider: () => ipcRenderer.invoke('voice:get-current-provider'),
  onVoiceProviderCycled: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('voice:provider-cycled', subscription);
    return () => ipcRenderer.removeListener('voice:provider-cycled', subscription);
  },
  commitVoiceUtterance: () => {
    ipcRenderer.send('voice:commit-utterance');
  },
  onVoiceStatus: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:status', subscription);
    return () => ipcRenderer.removeListener('voice:status', subscription);
  },
  onVoiceAudioStart: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:audio-start', subscription);
    return () => ipcRenderer.removeListener('voice:audio-start', subscription);
  },
  onVoiceInterrupted: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:interrupted', subscription);
    return () => ipcRenderer.removeListener('voice:interrupted', subscription);
  },
  onVoiceTextDelta: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:text-delta', subscription);
    return () => ipcRenderer.removeListener('voice:text-delta', subscription);
  },
  onVoiceAudioChunk: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:audio-chunk', subscription);
    return () => ipcRenderer.removeListener('voice:audio-chunk', subscription);
  },
  onVoiceComplete: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:complete', subscription);
    return () => ipcRenderer.removeListener('voice:complete', subscription);
  },
  onUserInterim: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:user-interim', subscription);
    return () => ipcRenderer.removeListener('voice:user-interim', subscription);
  },
  onUserFinal: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('voice:user-final', subscription);
    return () => ipcRenderer.removeListener('voice:user-final', subscription);
  },

  // In-Game Shortcuts
  onShortcutToggleVoice: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:toggle-voice', subscription);
    return () => ipcRenderer.removeListener('shortcut:toggle-voice', subscription);
  },
  onShortcutToggleHeroMenu: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:toggle-hero-menu', subscription);
    return () => ipcRenderer.removeListener('shortcut:toggle-hero-menu', subscription);
  },
  onShortcutToggleRoam: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:toggle-roam', subscription);
    return () => ipcRenderer.removeListener('shortcut:toggle-roam', subscription);
  },
  onShortcutTogglePetMode: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:toggle-pet-mode', subscription);
    return () => ipcRenderer.removeListener('shortcut:toggle-pet-mode', subscription);
  },
  onShortcutTriggerPetSpecial: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:trigger-pet-special', subscription);
    return () => ipcRenderer.removeListener('shortcut:trigger-pet-special', subscription);
  },
  onShortcutTogglePin: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:toggle-pin', subscription);
    return () => ipcRenderer.removeListener('shortcut:toggle-pin', subscription);
  },
  onShortcutCycleVoiceProvider: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:cycle-voice-provider', subscription);
    return () => ipcRenderer.removeListener('shortcut:cycle-voice-provider', subscription);
  },
  onShortcutToggleCompact: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('shortcut:toggle-compact', subscription);
    return () => ipcRenderer.removeListener('shortcut:toggle-compact', subscription);
  },

  // Roaming & Autonomous Wandering
  toggleRoam: () => ipcRenderer.send('roam:toggle'),
  // Deterministic control used by tests/probe_roam_smoothness.js
  startRoam: () => ipcRenderer.send('roam:start'),
  stopRoam: () => ipcRenderer.send('roam:stop'),
  onRoamStateChanged: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('roam:state-changed', subscription);
    return () => ipcRenderer.removeListener('roam:state-changed', subscription);
  },
  onRoamIdleTriggered: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('roam:idle-triggered', subscription);
    return () => ipcRenderer.removeListener('roam:idle-triggered', subscription);
  },

  // Roaming motion: Main plans the walk, the renderer integrates it on vsync
  // and reports back only when the integer window X changes.
  onRoamPlan: (callback) => {
    const subscription = (event, plan) => callback(plan);
    ipcRenderer.on('roam:plan', subscription);
    return () => ipcRenderer.removeListener('roam:plan', subscription);
  },
  roamApplyX: (x, epoch) => ipcRenderer.send('roam:apply-x', { x, epoch }),
  roamLegComplete: (epoch) => ipcRenderer.send('roam:leg-complete', { epoch }),
  roamReachedBound: (epoch) => ipcRenderer.send('roam:reached-bound', { epoch }),
  onRoamFreeze: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('roam:freeze', subscription);
    return () => ipcRenderer.removeListener('roam:freeze', subscription);
  },

  // Hero Management
  getHeroesConfig: () => ipcRenderer.invoke('hero:get-config'),
  getCurrentHero: () => ipcRenderer.invoke('hero:get-current'),
  selectHero: (heroId) => ipcRenderer.invoke('hero:select', heroId),
  // Keep the main-process voice persona in sync with pet mode / pet selection
  syncPetPersona: (payload) => ipcRenderer.invoke('pet:sync-persona', payload),
  onHeroChanged: (callback) => {
    const subscription = (event, hero) => callback(hero);
    ipcRenderer.on('hero:changed', subscription);
    return () => ipcRenderer.removeListener('hero:changed', subscription);
  },

  // Translation & Clipboard
  translateClipboard: () => ipcRenderer.invoke('translate:clipboard'),
  onTranslateResult: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('translate:result', subscription);
    return () => ipcRenderer.removeListener('translate:result', subscription);
  },
  copyToClipboard: (text) => {
    ipcRenderer.send('clipboard:write', text);
  },

  // Quick Phrases & AHK Migrated Panel
  togglePhrasesWindow: () => ipcRenderer.send('phrases:toggle-window'),
  getPhrasesConfig: () => ipcRenderer.invoke('phrases:get-config'),
  savePhrasesConfig: (phrases) => ipcRenderer.invoke('phrases:save-config', phrases),
  translatePhraseText: (text) => ipcRenderer.invoke('phrases:translate-text', text),
  onPhraseSent: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('phrase:sent', subscription);
    return () => ipcRenderer.removeListener('phrase:sent', subscription);
  },

  // DOTA 2 Game State Integration (GSI)
  checkGsiInstall: (customDir) => ipcRenderer.invoke('gsi:check-install', customDir),
  installGsiConfig: (customDir) => ipcRenderer.invoke('gsi:install-config', customDir),
  onGsiHeroDetected: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:hero-detected', subscription);
    return () => ipcRenderer.removeListener('gsi:hero-detected', subscription);
  },
  onGsiCombatKill: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:combat-kill', subscription);
    return () => ipcRenderer.removeListener('gsi:combat-kill', subscription);
  },
  onGsiCombatDeath: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:combat-death', subscription);
    return () => ipcRenderer.removeListener('gsi:combat-death', subscription);
  },
  onGsiLowHealth: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:low-health', subscription);
    return () => ipcRenderer.removeListener('gsi:low-health', subscription);
  },
  onGsiTacticalTimer: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:tactical-timer', subscription);
    return () => ipcRenderer.removeListener('gsi:tactical-timer', subscription);
  },
  onGsiSnapshot: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:snapshot', subscription);
    return () => ipcRenderer.removeListener('gsi:snapshot', subscription);
  },
  onGsiConnectionStatus: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:connection-status', subscription);
    return () => ipcRenderer.removeListener('gsi:connection-status', subscription);
  },
  onGsiInstallResult: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('gsi:install-result', subscription);
    return () => ipcRenderer.removeListener('gsi:install-result', subscription);
  },

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});

import electron from 'electron';
const { globalShortcut } = electron;

/**
 * Register global shortcuts for DOTA 2 Live Companion
 * Supports both new shortcuts (Alt+Q, Alt+T) and legacy AHK shortcuts (F8, F6)
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {Object} handlers
 * @returns {Array<{key: string, label: string}>} registrations that FAILED —
 *   on Windows a hotkey owned by another RegisterHotKey client (e.g. the old
 *   dota2_translator.ahk still running) silently wins, and a swallowed failure
 *   reads exactly like "F8 does nothing in game".
 */
export function registerShortcuts(mainWindow, handlers = {}) {
  const failures = [];
  const registerKey = (key, label, callback) => {
    try {
      if (!globalShortcut?.register) {
        return;
      }
      const ok = globalShortcut.register(key, () => {
        console.log(`[Shortcut] ${label} (${key}) triggered`);
        if (callback) callback();
      });
      if (!ok) {
        console.warn(`[Shortcut] Could not register ${key}`);
        failures.push({ key, label });
      }
    } catch (e) {
      console.error(`[Shortcut] Error registering ${key}:`, e);
      failures.push({ key, label });
    }
  };

  // F6: Quick Phrase Panel (Native Desktop Replacement for legacy AHK)
  // Opens/toggles the dedicated resizable phrases editor window (main's
  // onTogglePhrasePanel) — the pet HUD window is far too small for the
  // 860px phrase table.
  registerKey('F6', 'Quick Phrase Panel (F6)', () => {
    if (handlers.onTogglePhrasePanel) {
      handlers.onTogglePhrasePanel();
    }
  });

  // Ctrl/Alt+digits are managed by gamePhraseShortcuts only while Dota is
  // foreground, so browsers and editors retain their own digit shortcuts.

  // Alt+Q: Voice Duplex Toggle
  registerKey('Alt+Q', 'Voice Duplex Toggle', () => {
    if (handlers.onToggleVoice) {
      handlers.onToggleVoice();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-voice');
    }
  });

  // Alt+T: In Dota, capture and translate the chat area; elsewhere translate
  // the clipboard. No key injection into the game either way.
  registerKey('Alt+T', 'Translate Chat / Clipboard', () => {
    if (handlers.onTriggerTranslate) handlers.onTriggerTranslate();
  });

  // Alt+Shift+T: Frame the chat area once for Alt+T.
  registerKey('Alt+Shift+T', 'Select Chat Area', () => {
    if (handlers.onSelectChatRegion) handlers.onSelectChatRegion();
  });

  // F8: In-game chat translation — the legacy AHK headline feature. Captures
  // the chat box with Ctrl+A/Ctrl+C, translates, and types the result back.
  registerKey('F8', 'In-Game Chat Translate (F8)', () => {
    if (handlers.onGameChatTranslate) {
      handlers.onGameChatTranslate();
    } else if (handlers.onTriggerTranslate) {
      handlers.onTriggerTranslate();
    }
  });

  // Alt+H: Quick Hero Selection
  registerKey('Alt+H', 'Hero Switcher Menu', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-hero-menu');
    }
  });

  // Alt+M: Toggle Desktop Pet Roam Mode
  registerKey('Alt+M', 'Toggle Pet Roam Mode', () => {
    if (handlers.onToggleRoam) {
      handlers.onToggleRoam();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-roam');
    }
  });

  // Alt+P: Toggle Aurora Wolf Pet Mode
  registerKey('Alt+P', 'Toggle Aurora Pet Mode', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-pet-mode');
    }
  });

  // Alt+E: Trigger Pet Signature Skill
  registerKey('Alt+E', 'Trigger Pet Signature Skill', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:trigger-pet-special');
    }
  });

  // Alt+L / Alt+Shift+L: Toggle Window Pin / Position Lock (固定 / 解锁位置)
  registerKey('Alt+L', 'Toggle Window Pin (Alt+L)', () => {
    if (handlers.onTogglePin) {
      handlers.onTogglePin();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-pin');
    }
  });

  registerKey('Alt+Shift+L', 'Toggle Window Pin (Alt+Shift+L)', () => {
    if (handlers.onTogglePin) {
      handlers.onTogglePin();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-pin');
    }
  });

  // Alt+V / Alt+Shift+V: Cycle Voice Provider Engine (切换语音引擎)
  registerKey('Alt+V', 'Cycle Voice Provider (Alt+V)', () => {
    if (handlers.onCycleVoiceProvider) {
      handlers.onCycleVoiceProvider();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:cycle-voice-provider');
    }
  });

  registerKey('Alt+Shift+V', 'Cycle Voice Provider (Alt+Shift+V)', () => {
    if (handlers.onCycleVoiceProvider) {
      handlers.onCycleVoiceProvider();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:cycle-voice-provider');
    }
  });

  // Alt+C / Alt+Shift+C: Toggle Compact / Mini Mode (伴侣缩小/迷你模式切换)
  registerKey('Alt+C', 'Toggle Compact Mode (Alt+C)', () => {
    if (handlers.onToggleCompact) {
      handlers.onToggleCompact();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-compact');
    }
  });

  registerKey('Alt+Shift+C', 'Toggle Compact Mode (Alt+Shift+C)', () => {
    if (handlers.onToggleCompact) {
      handlers.onToggleCompact();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:toggle-compact');
    }
  });

  // Alt+Shift+M: Minimize/Show Pet HUD
  registerKey('Alt+Shift+M', 'Toggle Window Visibility', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.showInactive();
      }
    }
  });

  if (failures.length > 0 && handlers.onShortcutFailures) {
    handlers.onShortcutFailures(failures);
  }
  return failures;
}

/**
 * Unregister all global shortcuts
 */
export function unregisterShortcuts() {
  if (globalShortcut?.unregisterAll) {
    globalShortcut.unregisterAll();
  }
  console.log('[Shortcut] All global shortcuts unregistered');
}

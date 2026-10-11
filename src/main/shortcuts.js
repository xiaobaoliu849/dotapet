import electron from 'electron';

function getGlobalShortcut() {
  return electron?.globalShortcut || globalThis?.electron?.globalShortcut || null;
}

const SHORTCUT_ACTIONS = [
  { id: 'toggleVoice', label: '语音对话开关', description: '开始 / 结束和它说话', defaultKey: 'Alt+Q' },
  { id: 'translate', label: '聊天 / 剪贴板翻译', description: 'DOTA 2 截取聊天；其他时候翻译剪贴板', defaultKey: 'Alt+T' },
  { id: 'selectChatRegion', label: '框选聊天区域', description: '框选 DOTA 2 游戏内聊天区域', defaultKey: 'Alt+Shift+T' },
  { id: 'gameChatTranslate', label: '游戏内输入翻译', description: '把游戏里输入的中文翻成英文并发送', defaultKey: 'F8' },
  { id: 'togglePhrases', label: '快捷短语面板', description: '打开或隐藏快速短语浮窗', defaultKey: 'F6' },
  { id: 'togglePin', label: '固定 / 解除固定位置', description: '锁定桌宠位置，防误触', defaultKey: 'Alt+L' },
  { id: 'toggleHide', label: '隐藏 / 显示桌宠', description: '快速隐藏或呼出桌面宠物', defaultKey: 'Alt+Shift+M' },
  { id: 'toggleRoam', label: '桌宠漫游巡航', description: '开启或暂停桌面自由漫步', defaultKey: 'Alt+M' },
  { id: 'toggleCompact', label: '迷你 / 紧凑模式', description: '切换桌宠大小缩放比例', defaultKey: 'Alt+C' },
  { id: 'cycleVoice', label: '切换语音引擎', description: '在配置的 AI 语音提供商之间切换', defaultKey: 'Alt+V' },
  { id: 'heroMenu', label: '英雄切换菜单', description: '快速打开英雄切换选择', defaultKey: 'Alt+H' },
  { id: 'petSpecial', label: '专属技能互动', description: '触发当前宠物的特色专属技能', defaultKey: 'Alt+E' },
];

export function getShortcutActions() {
  return structuredClone(SHORTCUT_ACTIONS);
}

export function getDefaultShortcuts() {
  const defaults = {};
  for (const action of SHORTCUT_ACTIONS) {
    defaults[action.id] = action.defaultKey;
  }
  return defaults;
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
const MODIFIER_MAP = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmdorctrl: 'Ctrl',
  commandorcontrol: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  command: 'Super',
  cmd: 'Super',
};

const BASE_KEY_MAP = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  printscreen: 'PrintScreen',
  prtsc: 'PrintScreen',
};

/**
 * Normalizes an accelerator string into canonical format (e.g. 'Ctrl+Alt+Q').
 * Returns '' for empty / falsy values (unbound).
 */
export function normalizeAccelerator(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const rawParts = trimmed.split('+').map(p => p.trim()).filter(Boolean);
  if (!rawParts.length) return '';

  const modifiers = new Set();
  let baseKey = '';

  for (const part of rawParts) {
    const lower = part.toLowerCase();
    if (Object.hasOwn(MODIFIER_MAP, lower)) {
      modifiers.add(MODIFIER_MAP[lower]);
    } else {
      if (baseKey) {
        // More than one base key is invalid
        return '';
      }
      if (/^f[1-9]$|^f1[0-9]$|^f2[0-4]$/i.test(lower)) {
        baseKey = lower.toUpperCase();
      } else if (/^[a-z]$/i.test(lower)) {
        baseKey = lower.toUpperCase();
      } else if (/^[0-9]$/.test(lower)) {
        baseKey = lower;
      } else if (Object.hasOwn(BASE_KEY_MAP, lower)) {
        baseKey = BASE_KEY_MAP[lower];
      } else if (/^[`\-=~[\]\\;',./]$/.test(part)) {
        baseKey = part;
      } else {
        baseKey = part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
      }
    }
  }

  if (!baseKey && !modifiers.size) return '';

  const sortedModifiers = MODIFIER_ORDER.filter(m => modifiers.has(m));
  if (baseKey) {
    return [...sortedModifiers, baseKey].join('+');
  }
  return sortedModifiers.join('+');
}

/**
 * Validates a single accelerator string.
 * Returns { valid: boolean, normalized: string, error?: string, disabled?: boolean }.
 */
export function validateAccelerator(value) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    return { valid: true, normalized: '', disabled: true };
  }

  const normalized = normalizeAccelerator(value);
  if (!normalized) {
    return { valid: false, error: '快捷键格式无效。' };
  }

  const parts = normalized.split('+');
  const baseKey = parts[parts.length - 1];
  const hasModifiers = parts.length > 1;

  if (MODIFIER_ORDER.includes(baseKey)) {
    return { valid: false, error: '快捷键必须包含具体按键（如字母、数字或功能键）。' };
  }

  const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(baseKey);
  const isSpecialStandalone = ['PrintScreen', 'ScrollLock', 'Pause'].includes(baseKey);

  if (!hasModifiers && !isFKey && !isSpecialStandalone) {
    return { valid: false, error: '字母、数字与符号键必须搭配 Ctrl、Alt 或 Shift 组合使用，以免影响正常输入。' };
  }

  return { valid: true, normalized, disabled: false };
}

/**
 * Validates a full shortcuts configuration dictionary.
 * Detects conflicts between actions and ensures valid accelerators.
 */
export function validateShortcutsConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, error: '快捷键配置格式不正确。' };
  }

  const defaults = getDefaultShortcuts();
  const normalized = {};
  const usedKeys = new Map();

  for (const action of SHORTCUT_ACTIONS) {
    const rawValue = Object.hasOwn(config, action.id) ? config[action.id] : defaults[action.id];
    const validation = validateAccelerator(rawValue);
    if (!validation.valid) {
      return { valid: false, error: `「${action.label}」: ${validation.error}` };
    }

    const key = validation.normalized;
    normalized[action.id] = key;

    if (key) {
      if (usedKeys.has(key)) {
        const otherAction = usedKeys.get(key);
        return { valid: false, error: `快捷键「${key}」与「${otherAction.label}」冲突，请更换。` };
      }
      usedKeys.set(key, action);
    }
  }

  return { valid: true, shortcuts: normalized };
}

function resolveActionHandler(actionId, mainWindow, handlers) {
  switch (actionId) {
    case 'toggleVoice':
      return () => {
        if (handlers.onToggleVoice) handlers.onToggleVoice();
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-voice');
      };
    case 'translate':
      return () => {
        if (handlers.onTriggerTranslate) handlers.onTriggerTranslate();
      };
    case 'selectChatRegion':
      return () => {
        if (handlers.onSelectChatRegion) handlers.onSelectChatRegion();
      };
    case 'gameChatTranslate':
      return () => {
        if (handlers.onGameChatTranslate) handlers.onGameChatTranslate();
        else if (handlers.onTriggerTranslate) handlers.onTriggerTranslate();
      };
    case 'togglePhrases':
      return () => {
        if (handlers.onTogglePhrasePanel) handlers.onTogglePhrasePanel();
      };
    case 'togglePin':
      return () => {
        if (handlers.onTogglePin) handlers.onTogglePin();
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-pin');
      };
    case 'toggleHide':
      return () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) mainWindow.hide();
          else mainWindow.showInactive();
        }
      };
    case 'toggleRoam':
      return () => {
        if (handlers.onToggleRoam) handlers.onToggleRoam();
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-roam');
      };
    case 'toggleCompact':
      return () => {
        if (handlers.onToggleCompact) handlers.onToggleCompact();
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-compact');
      };
    case 'cycleVoice':
      return () => {
        if (handlers.onCycleVoiceProvider) handlers.onCycleVoiceProvider();
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:cycle-voice-provider');
      };
    case 'heroMenu':
      return () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-hero-menu');
      };
    case 'petSpecial':
      return () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:trigger-pet-special');
      };
    default:
      return null;
  }
}

/**
 * Register global shortcuts for DOTA 2 Live Companion
 * Supports custom shortcut configurations, runtime updates, and legacy defaults.
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {Object} handlers
 * @param {Object} [customShortcuts]
 * @returns {Array<{key: string, label: string}>} registrations that FAILED
 */
export function registerShortcuts(mainWindow, handlers = {}, customShortcuts = null) {
  const failures = [];
  const defaults = getDefaultShortcuts();
  const effective = { ...defaults, ...(customShortcuts || {}) };
  const globalShortcut = getGlobalShortcut();

  const registerKey = (key, label, callback) => {
    if (!key) return;
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

  const registeredKeys = new Set();

  for (const action of SHORTCUT_ACTIONS) {
    const rawKey = effective[action.id];
    const validation = validateAccelerator(rawKey);
    if (!validation.valid || validation.disabled || !validation.normalized) {
      continue;
    }

    const key = validation.normalized;
    const callback = resolveActionHandler(action.id, mainWindow, handlers);
    if (callback) {
      registerKey(key, action.label, callback);
      registeredKeys.add(key);
    }
  }

  // Compatibility aliases when default shortcuts are intact and don't clash
  const registeredValues = new Set(Object.values(effective).filter(Boolean));
  if (effective.togglePin === 'Alt+L' && !registeredValues.has('Alt+Shift+L')) {
    registerKey('Alt+Shift+L', 'Toggle Window Pin (Alt+Shift+L)', () => {
      if (handlers.onTogglePin) handlers.onTogglePin();
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-pin');
    });
  }

  if (effective.cycleVoice === 'Alt+V' && !registeredValues.has('Alt+Shift+V')) {
    registerKey('Alt+Shift+V', 'Cycle Voice Provider (Alt+Shift+V)', () => {
      if (handlers.onCycleVoiceProvider) handlers.onCycleVoiceProvider();
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:cycle-voice-provider');
    });
  }

  if (effective.toggleCompact === 'Alt+C' && !registeredValues.has('Alt+Shift+C')) {
    registerKey('Alt+Shift+C', 'Toggle Compact Mode (Alt+Shift+C)', () => {
      if (handlers.onToggleCompact) handlers.onToggleCompact();
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:toggle-compact');
    });
  }

  if (failures.length > 0 && handlers.onShortcutFailures) {
    handlers.onShortcutFailures(failures);
  }
  return failures;
}

/**
 * Unregister all global shortcuts
 */
export function unregisterShortcuts() {
  const globalShortcut = getGlobalShortcut();
  if (globalShortcut?.unregisterAll) {
    globalShortcut.unregisterAll();
  }
  console.log('[Shortcut] All global shortcuts unregistered');
}

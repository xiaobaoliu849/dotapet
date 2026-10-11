import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getShortcutActions,
  getDefaultShortcuts,
  normalizeAccelerator,
  validateAccelerator,
  validateShortcutsConfig,
  registerShortcuts,
  unregisterShortcuts,
} from '../src/main/shortcuts.js';

test('getShortcutActions returns all 13 configurable actions', () => {
  const actions = getShortcutActions();
  assert.equal(actions.length, 13);
  const ids = actions.map(a => a.id);
  assert.ok(ids.includes('toggleVoice'));
  assert.ok(ids.includes('translate'));
  assert.ok(ids.includes('snipTranslate'));
  assert.ok(ids.includes('selectChatRegion'));
  assert.ok(ids.includes('gameChatTranslate'));
  assert.ok(ids.includes('togglePhrases'));
  assert.ok(ids.includes('togglePin'));
  assert.ok(ids.includes('toggleHide'));
  assert.ok(ids.includes('toggleRoam'));
  assert.ok(ids.includes('toggleCompact'));
  assert.ok(ids.includes('cycleVoice'));
  assert.ok(ids.includes('heroMenu'));
  assert.ok(ids.includes('petSpecial'));
});

test('getDefaultShortcuts returns expected default keybindings', () => {
  const defaults = getDefaultShortcuts();
  assert.equal(defaults.toggleVoice, 'Alt+Q');
  assert.equal(defaults.translate, 'Alt+T');
  assert.equal(defaults.snipTranslate, 'Alt+Shift+S');
  assert.equal(defaults.selectChatRegion, 'Alt+Shift+T');
  assert.equal(defaults.gameChatTranslate, 'F8');
  assert.equal(defaults.togglePhrases, 'F6');
  assert.equal(defaults.togglePin, 'Alt+L');
  assert.equal(defaults.toggleHide, 'Alt+Shift+M');
  assert.equal(defaults.toggleRoam, 'Alt+M');
  assert.equal(defaults.toggleCompact, 'Alt+C');
  assert.equal(defaults.cycleVoice, 'Alt+V');
  assert.equal(defaults.heroMenu, 'Alt+H');
  assert.equal(defaults.petSpecial, 'Alt+E');
});

test('normalizeAccelerator orders modifiers and capitalizes base keys', () => {
  assert.equal(normalizeAccelerator('alt+q'), 'Alt+Q');
  assert.equal(normalizeAccelerator('ctrl+alt+shift+t'), 'Ctrl+Alt+Shift+T');
  assert.equal(normalizeAccelerator('shift+ctrl+f8'), 'Ctrl+Shift+F8');
  assert.equal(normalizeAccelerator('cmdorctrl+k'), 'Ctrl+K');
  assert.equal(normalizeAccelerator('f6'), 'F6');
  assert.equal(normalizeAccelerator('F12'), 'F12');
  assert.equal(normalizeAccelerator('alt + shift + m'), 'Alt+Shift+M');
  assert.equal(normalizeAccelerator('esc'), 'Escape');
  assert.equal(normalizeAccelerator('ctrl+space'), 'Ctrl+Space');
  assert.equal(normalizeAccelerator(''), '');
  assert.equal(normalizeAccelerator('   '), '');
  assert.equal(normalizeAccelerator(null), '');
});

test('validateAccelerator requires modifiers for alphanumeric keys and allows standalone F-keys', () => {
  // Empty / disabled
  assert.deepEqual(validateAccelerator(''), { valid: true, normalized: '', disabled: true });
  assert.deepEqual(validateAccelerator(null), { valid: true, normalized: '', disabled: true });

  // Valid combos
  assert.equal(validateAccelerator('Alt+Q').valid, true);
  assert.equal(validateAccelerator('Ctrl+Shift+F8').valid, true);
  assert.equal(validateAccelerator('F6').valid, true);
  assert.equal(validateAccelerator('F11').valid, true);
  assert.equal(validateAccelerator('PrintScreen').valid, true);

  // Invalid: modifier only
  assert.equal(validateAccelerator('Ctrl').valid, false);
  assert.equal(validateAccelerator('Ctrl+Alt').valid, false);

  // Invalid: bare letter / number without modifier (would hijack global typing)
  assert.equal(validateAccelerator('A').valid, false);
  assert.equal(validateAccelerator('1').valid, false);
  assert.equal(validateAccelerator('Space').valid, false);
});

test('validateShortcutsConfig detects duplicate conflicts and invalid accelerators', () => {
  const defaults = getDefaultShortcuts();

  // Valid configuration
  const valid = validateShortcutsConfig(defaults);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.shortcuts, defaults);

  // Valid with disabled action
  const withDisabled = validateShortcutsConfig({ ...defaults, petSpecial: '' });
  assert.equal(withDisabled.valid, true);
  assert.equal(withDisabled.shortcuts.petSpecial, '');

  // Conflict: two actions share the same shortcut
  const conflict = validateShortcutsConfig({ ...defaults, translate: 'Alt+Q' });
  assert.equal(conflict.valid, false);
  assert.match(conflict.error, /冲突/);

  // Invalid key in one action
  const invalidKey = validateShortcutsConfig({ ...defaults, heroMenu: 'Ctrl' });
  assert.equal(invalidKey.valid, false);
  assert.match(invalidKey.error, /英雄切换菜单/);
});

test('registerShortcuts registers keys, handles custom overrides and reports failures', () => {
  const registered = new Map();
  const mockGlobalShortcut = {
    register(key, callback) {
      if (key === 'Alt+INVALID') return false;
      registered.set(key, callback);
      return true;
    },
    unregisterAll() {
      registered.clear();
    },
  };

  // Replace globalShortcut in global context for testing
  const originalElectron = global.electron;
  global.electron = { globalShortcut: mockGlobalShortcut };

  try {
    const events = [];
    const handlers = {
      onToggleVoice: () => events.push('voice'),
      onTriggerTranslate: () => events.push('translate'),
      onTogglePhrasePanel: () => events.push('phrases'),
      onShortcutFailures: (failures) => events.push({ failures }),
    };

    // Default registration
    let failures = registerShortcuts(null, handlers);
    assert.equal(failures.length, 0);
    assert.ok(registered.has('Alt+Q'));
    assert.ok(registered.has('F8'));
    assert.ok(registered.has('F6'));
    assert.ok(registered.has('Alt+Shift+L'), 'compat alias registered');

    // Triggering a registered callback executes handler
    registered.get('Alt+Q')();
    assert.deepEqual(events, ['voice']);

    // Unregister
    mockGlobalShortcut.unregisterAll();
    assert.equal(registered.size, 0);

    // Custom configuration
    failures = registerShortcuts(null, handlers, {
      toggleVoice: 'Ctrl+Shift+V',
      petSpecial: '', // disabled
    });
    assert.equal(failures.length, 0);
    assert.ok(registered.has('Ctrl+Shift+V'), 'custom key registered');
    assert.equal(registered.has('Alt+Q'), false, 'old key not registered');
    assert.equal(registered.has('Alt+E'), false, 'disabled key not registered');

    // Test failure handling
    mockGlobalShortcut.unregisterAll();
    failures = registerShortcuts(null, handlers, { toggleVoice: 'Alt+INVALID' });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].key, 'Alt+INVALID');
  } finally {
    global.electron = originalElectron;
  }
});

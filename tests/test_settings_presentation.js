import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { presentSettingsWhenReady } from '../src/main/settingsPresentation.js';

function fixture(options = {}) {
  const window = new EventEmitter();
  const calls = [];
  Object.assign(window, { isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('show'),
    focus: () => calls.push('focus'), moveTop: () => calls.push('moveTop') });
  let fallback;
  presentSettingsWhenReady(window, { schedule: fn => { fallback = fn; return 1; }, cancel: () => calls.push('cancel'), ...options });
  return { window, calls, fallback: () => fallback() };
}

test('settings become visible and focused if ready-to-show never fires', () => {
  const ui = fixture(); ui.fallback();
  assert.deepEqual(ui.calls, ['restore', 'show', 'focus', 'moveTop']);
  ui.window.emit('ready-to-show');
  assert.equal(ui.calls.length, 4, 'a late event must not steal focus again');
});
test('closing settings cancels fallback and cannot present a destroyed window', () => {
  const ui = fixture(); ui.window.emit('closed'); ui.window.isDestroyed = () => true; ui.fallback();
  assert.deepEqual(ui.calls, ['cancel']);
});
test('smoke mode never presents a desktop window', () => {
  const ui = fixture({ smokeTest: true }); ui.window.emit('ready-to-show'); ui.fallback();
  assert.deepEqual(ui.calls, []);
});

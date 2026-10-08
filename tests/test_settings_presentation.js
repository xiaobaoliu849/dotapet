import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { presentSettingsWhenReady, settingsWindowBounds } from '../src/main/settingsPresentation.js';

test('settings and minimum sizes fit a scaled desktop with a nonzero origin', () => {
  const area = { x: -1000, y: 25, width: 600, height: 580 };
  assert.deepEqual(settingsWindowBounds(area), { x: -1000, y: 25, width: 600, height: 580, minWidth: 600, minHeight: 580 });
  const large = settingsWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(large.width, 940); assert.equal(large.x, 490); assert.equal(large.y, 130);
});

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGamePhraseShortcuts } from '../src/main/gamePhraseShortcuts.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const keys = new Map(), sent = [], failures = [];
  let foreground = 'chrome';
  const shortcuts = { register(key, callback) { keys.set(key, callback); return true; }, unregister(key) { keys.delete(key); } };
  const controller = createGamePhraseShortcuts({ shortcuts, foregroundProcessName: () =>
    foreground instanceof Error ? Promise.reject(foreground) : Promise.resolve(foreground),
  onSendPhrase: (...args) => sent.push(args), onShortcutFailures: list => failures.push(list),
  schedule: () => 1, cancel() {} });
  return { controller, keys, sent, failures, shortcuts, focus: value => { foreground = value; } };
}

test('persistent desktop shortcuts leave Ctrl/Alt+digits available to other apps', () => {
  const source = fs.readFileSync(new URL('../src/main/shortcuts.js', import.meta.url), 'utf8')
    .replace("import electron from 'electron';", '').replaceAll('export function ', 'function ');
  const keys = [];
  vm.runInNewContext(`${source}\nregisterShortcuts(null);`, {
    electron: { globalShortcut: { register: key => { keys.push(key); return true; } } }, console,
  });
  assert.ok(keys.includes('F6'));
  assert.ok(keys.includes('F8'));
  assert.equal(keys.some(key => /^(Ctrl|Alt)\+\d$/.test(key)), false);
});

test('entering and leaving Dota registers and releases only the twenty phrase keys', async () => {
  const f = fixture();
  f.keys.set('F6', () => {});
  await f.controller.start();
  assert.equal(f.keys.size, 1);
  f.focus('DOTA2.exe'); await f.controller.refresh();
  assert.equal(f.keys.size, 21);
  f.keys.get('Ctrl+1')(); f.keys.get('Alt+0')(); await tick();
  assert.deepEqual(f.sent, [['1', 'cn'], ['0', 'en']]);
  f.focus('chrome'); await f.controller.refresh();
  assert.deepEqual([...f.keys.keys()], ['F6']);
  f.focus('dota2'); await f.controller.refresh();
  assert.equal(f.keys.size, 21);
  f.controller.stop(); assert.deepEqual([...f.keys.keys()], ['F6']);
});

test('rapid focus loss does not change the clipboard before the next poll', async () => {
  const f = fixture(); f.focus('dota2'); await f.controller.start();
  f.focus('code'); f.keys.get('Ctrl+1')(); await tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.keys.size, 0);
  f.controller.stop();
});

test('unknown, lookalike and failed foreground queries release digit shortcuts', async () => {
  const f = fixture(); await f.controller.start();
  for (const name of ['dota2-launcher', '', new Error('helper exited')]) {
    f.focus('dota2'); await f.controller.refresh(); assert.equal(f.keys.size, 20);
    f.focus(name); await f.controller.refresh(); assert.equal(f.keys.size, 0);
  }
  f.controller.stop();
});

test('shutdown during a foreground query cannot register late hotkeys', async () => {
  const f = fixture(); const query = deferred(); f.focus(query.promise);
  const starting = f.controller.start();
  f.controller.stop(); query.resolve('dota2'); await starting;
  assert.equal(f.keys.size, 0);
});

test('registration conflicts report once per focus period and never unregister others keys', async () => {
  const f = fixture();
  const register = f.shortcuts.register;
  f.shortcuts.register = (key, callback) => key === 'Ctrl+4' ? false : register(key, callback);
  f.focus('dota2'); await f.controller.start(); await f.controller.refresh();
  assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0][0].key, 'Ctrl+4');
  assert.equal(f.keys.size, 19);
  f.controller.stop(); assert.equal(f.keys.size, 0);
});

test('overlapping polls share one request, and shutdown blocks an in-flight send', async () => {
  const f = fixture(); f.focus('dota2'); await f.controller.start();
  const query = deferred(); f.focus(query.promise);
  const a = f.controller.refresh(), b = f.controller.refresh();
  f.keys.get('Alt+2')(); f.controller.stop();
  query.resolve('dota2'); await Promise.all([a, b]); await tick();
  assert.equal(f.keys.size, 0); assert.equal(f.sent.length, 0);
});

test('a failed helper backs off, then normal foreground polling recovers', async () => {
  const scheduled = [], keys = new Set(); let failing = true;
  const controller = createGamePhraseShortcuts({
    shortcuts: { register(key) { keys.add(key); return true; }, unregister: key => keys.delete(key) },
    foregroundProcessName: async () => { if (failing) throw new Error('helper blocked'); return 'dota2'; },
    onSendPhrase() {}, schedule: (callback, delay) => { scheduled.push({ callback, delay }); return 1; }, cancel() {},
  });
  await controller.start(); assert.equal(scheduled[0].delay, 2000); assert.equal(keys.size, 0);
  failing = false; scheduled[0].callback(); await tick();
  assert.equal(keys.size, 20); assert.equal(scheduled.at(-1).delay, 125);
  controller.stop(); assert.equal(keys.size, 0);
});

test('a hung foreground query releases hotkeys and its late result cannot re-register them', async () => {
  let time = 0, nextId = 0, foreground = Promise.resolve('dota2');
  const timers = new Map(), keys = new Map(), query = deferred();
  const controller = createGamePhraseShortcuts({
    shortcuts: { register(key, callback) { keys.set(key, callback); return true; }, unregister: key => keys.delete(key) },
    foregroundProcessName: () => foreground, onSendPhrase() {},
    schedule: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: time + delay }); return id; },
    cancel: id => timers.delete(id),
  });
  async function advance(target) {
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = due[1].at; timers.delete(due[0]); due[1].callback(); await tick();
    }
    time = target;
  }
  await controller.start(); assert.equal(keys.size, 20);
  foreground = query.promise; await advance(600);
  assert.equal(keys.size, 0);
  query.resolve('dota2'); await tick(); assert.equal(keys.size, 0);
  controller.stop();
});

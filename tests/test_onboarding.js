import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { WelcomeStore } from '../src/main/welcomeController.js';

test('dismissing the guide survives an upgrade without touching other settings', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-guide-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'ai-settings.json'), 'existing encrypted credentials');
  const store = new WelcomeStore(directory);
  assert.equal(store.state.dismissed, false);
  store.dismiss('1.0.0');
  const upgraded = new WelcomeStore(directory);
  assert.equal(upgraded.state.dismissed, true);
  upgraded.dismiss('1.1.0');
  assert.equal(fs.readFileSync(path.join(directory, 'ai-settings.json'), 'utf8'), 'existing encrypted credentials');
});

test('opening with a damaged guide preference preserves the file and skips nagging', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-guide-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'welcome.json'), 'broken');
  assert.equal(new WelcomeStore(directory).state.dismissed, true);
  assert.equal(fs.readFileSync(path.join(directory, 'welcome.json'), 'utf8'), 'broken');
});

const microphoneSource = fs.readFileSync(new URL('../src/renderer/microphone-check.js', import.meta.url), 'utf8');
function microphoneUI(acquire) {
  const nodes = Object.fromEntries(['mic-start', 'mic-stop', 'mic-status', 'mic-level', 'mic-privacy'].map(id => [id, {
    listeners: {}, style: {}, parentElement: { setAttribute() {} }, addEventListener(name, fn) { this.listeners[name] = fn; },
  }]));
  const timers = new Map(); let counter = 0;
  const window = { addEventListener() {} };
  vm.runInNewContext(microphoneSource, {
    window, document: { getElementById: id => nodes[id], addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: acquire } },
    setTimeout: (fn, ms) => { timers.set(++counter, { fn, ms }); return counter; },
    clearTimeout: id => timers.delete(id), requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, Float32Array,
  });
  return { nodes, window, timers };
}

test('stopping while microphone permission is pending closes a late stream', async () => {
  let resolve, stopped = 0;
  const ui = microphoneUI(() => new Promise(r => { resolve = r; }));
  const pending = ui.nodes['mic-start'].listeners.click();
  ui.nodes['mic-stop'].listeners.click();
  resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await pending;
  assert.equal(stopped, 1);
  assert.match(ui.nodes['mic-status'].textContent, /已关闭/);
  assert.equal(ui.nodes['mic-start'].disabled, false);
  assert.equal(ui.timers.size, 0);
});

test('permission denial offers a recovery path and releases the timer', async () => {
  const ui = microphoneUI(async () => { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error; });
  await ui.nodes['mic-start'].listeners.click();
  assert.match(ui.nodes['mic-status'].textContent, /Windows/);
  assert.equal(ui.nodes['mic-privacy'].hidden, false);
  assert.equal(ui.nodes['mic-stop'].hidden, true);
  assert.equal(ui.timers.size, 0);
});

test('a timed out device request cannot leave its eventual stream open', async () => {
  let resolve, stopped = 0;
  const ui = microphoneUI(() => new Promise(r => { resolve = r; }));
  const pending = ui.nodes['mic-start'].listeners.click();
  const timeout = [...ui.timers.values()][0];
  timeout.fn();
  resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await pending;
  assert.equal(stopped, 1);
  assert.match(ui.nodes['mic-status'].textContent, /超时/);
});

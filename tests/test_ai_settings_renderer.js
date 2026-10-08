import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { AI_PROVIDERS } from '../src/main/aiSettingsStore.js';

const source = fs.readFileSync(new URL('../src/renderer/ai-settings.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function renderer(overrides = {}) {
  const nodes = new Map();
  class Element {
    constructor(tag, id = '') {
      Object.assign(this, { tag, id, value: '', hidden: false, disabled: false, dataset: {}, children: [], listeners: {} });
    }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    replaceChildren(...children) {
      for (const child of this.children) if (child.id) nodes.delete(child.id);
      this.children = [];
      this.append(...children);
    }
    append(...children) {
      this.children.push(...children);
      for (const child of children) if (child.id) nodes.set(child.id, child);
    }
    click() { return this.listeners.click?.(); }
  }
  for (const id of ['feedback', 'provider-help', 'secret-fields', 'optional-secret-fields', 'workspace-fields', 'voice-fields', 'connection-status']) nodes.set(id, new Element('div', id));
  for (const id of ['provider', 'voice', 'translator', 'region', 'usage']) nodes.set(id, new Element('select', id));
  nodes.set('overseas', new Element('input', 'overseas'));
  for (const id of ['model', 'workspace', 'voice-custom']) nodes.set(id, new Element('input', id));
  for (const id of ['connect', 'disconnect', 'save', 'test', 'cancel', 'delete', 'import']) nodes.set(id, new Element('button', id));
  const settings = { selectedProvider: 'qwen', translationProvider: 'qwen', encryptionAvailable: true,
    providers: AI_PROVIDERS.map(item => ({ ...item, fields: item.fields.map(field => ({ ...field, configured: false })) })) };
  const calls = { test: 0, cancel: 0 };
  const api = {
    getAISettings: async () => ({ ok: true, settings }),
    saveAISettings: async () => ({ ok: true, settings }),
    testAIConnection: async () => { calls.test++; return { ok: true, result: { ok: true, message: 'ready' } }; },
    testTextConnection: async () => { calls.text = (calls.text || 0) + 1; return { ok: true, result: { ok: true, message: 'text ready' } }; },
    cancelAITest: async () => { calls.cancel++; return { ok: true }; },
    onVoiceStatus() {}, ...overrides,
  };
  const document = {
    getElementById: id => nodes.get(id),
    createElement: tag => new Element(tag),
    querySelectorAll: query => [...nodes.values()].filter(node => query === 'input[type=password]' ? node.type === 'password' : ['button', 'input', 'select'].includes(node.tag)),
  };
  vm.runInNewContext(source, { window: { electronAPI: api }, document, Option: class { constructor(text, value) { Object.assign(this, { text, value }); } } });
  await tick();
  nodes.get('usage').value = 'voice'; nodes.get('usage').listeners.change();
  return { nodes, calls, settings };
}

test('translation selection saves the matching key and tests text without requesting voice', async () => {
  let saved;
  const ui = await renderer({ saveAISettings: async data => { saved = data; return { ok: true, settings: ui.settings }; } });
  ui.nodes.get('usage').value = 'translate'; ui.nodes.get('usage').listeners.change();
  ui.nodes.get('provider').value = 'deepseek'; ui.nodes.get('provider').listeners.change();
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  await ui.nodes.get('test').click();
  assert.equal(saved.translationProvider, 'deepseek');
  assert.equal(ui.calls.text, 1);
  assert.equal(ui.calls.test, 0);
  assert.equal(ui.nodes.get('connect').hidden, true);
});

test('cancelling while settings save is pending prevents any provider test request', async () => {
  let resolveSave;
  const ui = await renderer({ saveAISettings: () => new Promise(resolve => { resolveSave = resolve; }) });
  const pending = ui.nodes.get('test').click();
  assert.equal(ui.nodes.get('cancel').hidden, false);
  ui.nodes.get('cancel').click();
  resolveSave({ ok: true, settings: ui.settings });
  await pending;
  assert.equal(ui.calls.test, 0);
  assert.equal(ui.calls.cancel, 1);
  assert.match(ui.nodes.get('feedback').textContent, /已取消/);
  assert.equal(ui.nodes.get('provider').disabled, false);
});

test('controls stay disabled after save while a connection test is still pending', async () => {
  let finishTest;
  const ui = await renderer({ testAIConnection: () => new Promise(resolve => { finishTest = resolve; }) });
  const pending = ui.nodes.get('test').click();
  await tick();
  for (const id of ['connect', 'delete', 'provider', 'save']) assert.equal(ui.nodes.get(id).disabled, true, id);
  finishTest({ ok: true, result: { ok: true, message: 'ready' } });
  await pending;
  assert.equal(ui.nodes.get('connect').disabled, false);
  assert.equal(ui.nodes.get('cancel').hidden, true);
});

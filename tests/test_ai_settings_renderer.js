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
    focus() { this.focused = true; }
    setAttribute(name, value) { this[name] = value; }
    get options() { return this.children; }
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
  for (const id of ['feedback', 'provider-help', 'secret-fields', 'optional-secret-fields', 'workspace-fields', 'voice-fields', 'connection-status', 'provider-options', 'welcome-title', 'welcome-description', 'provider-caption', 'all-voice-fields', 'custom-voice-fields', 'google-mode-fields', 'model-fields', 'translator-fields', 'shared-credentials', 'model-label', 'translator-summary']) nodes.set(id, new Element('div', id));
  for (const id of ['provider', 'voice', 'translator', 'region', 'usage', 'google-mode', 'all-voices']) nodes.set(id, new Element('select', id));
  for (const id of ['model', 'workspace', 'voice-custom', 'custom-voice-id']) nodes.set(id, new Element('input', id));
  for (const id of ['connect', 'disconnect', 'save', 'test', 'cancel', 'delete', 'import', 'voice-test', 'finish', 'skip', 'usage-voice', 'usage-translate', 'translator-config', 'open-phrases']) nodes.set(id, new Element('button', id));
  const settings = { selectedProvider: 'qwen', translationProvider: 'qwen', encryptionAvailable: true,
    providers: AI_PROVIDERS.map(item => ({ ...item, fields: item.fields.map(field => ({ ...field, configured: false })) })) };
  const calls = { test: 0, cancel: 0, save: 0, connect: 0, finish: 0 };
  const api = {
    getAISettings: async () => ({ ok: true, settings }),
    saveAISettings: async data => { calls.save++; calls.saved = data; return { ok: true, settings }; },
    testAIConnection: async () => { calls.test++; return { ok: true, result: { ok: true, message: 'ready' } }; },
    testTextConnection: async () => { calls.text = (calls.text || 0) + 1; return { ok: true, result: { ok: true, message: 'text ready' } }; },
    cancelAITest: async () => { calls.cancel++; return { ok: true }; },
    connectAI: async provider => { calls.connect++; calls.connectedProvider = provider; return { ok: true, status: { status: 'connected', providerId: provider } }; },
    finishAISetup: async () => { calls.finish++; return { ok: true }; },
    openPhrases: async () => { calls.phrases = (calls.phrases || 0) + 1; return { ok: true }; },
    onVoiceStatus(listener) { calls.statusListener = listener; }, ...overrides,
  };
  const document = {
    getElementById: id => nodes.get(id),
    createElement: tag => new Element(tag),
    querySelectorAll: query => [...nodes.values()].filter(node => query === 'input[type=password]' ? node.type === 'password' : ['button', 'input', 'select'].includes(node.tag)),
  };
  vm.runInNewContext(source, { window: { electronAPI: api }, document, Option: class { constructor(text, value) { Object.assign(this, { text, value }); } } });
  await tick();
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

test('settings exposes the phrase panel without saving or connecting', async () => {
  const ui = await renderer();
  await ui.nodes.get('open-phrases').click();
  assert.equal(ui.calls.phrases, 1);
  assert.equal(ui.calls.save + ui.calls.connect + ui.calls.test, 0);
});

test('cancelling while settings save is pending prevents any provider test request', async () => {
  let resolveSave;
  const ui = await renderer({ saveAISettings: () => new Promise(resolve => { resolveSave = resolve; }) });
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  const pending = ui.nodes.get('voice-test').click();
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
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  const pending = ui.nodes.get('voice-test').click();
  await tick();
  for (const id of ['connect', 'delete', 'provider', 'save']) assert.equal(ui.nodes.get(id).disabled, true, id);
  finishTest({ ok: true, result: { ok: true, message: 'ready' } });
  await pending;
  assert.equal(ui.nodes.get('connect').disabled, false);
  assert.equal(ui.nodes.get('cancel').hidden, true);
});

test('first setup shows all four voice providers without making cloud calls', async () => {
  const ui = await renderer();
  assert.equal(ui.nodes.get('usage').value, 'voice');
  assert.deepEqual(ui.nodes.get('provider').children.map(item => item.value), ['qwen', 'doubao', 'google', 'cartesia']);
  assert.equal(ui.nodes.get('provider-options').children.length, 4);
  assert.equal(ui.calls.connect + ui.calls.test + ui.calls.save, 0);
  assert.equal(ui.nodes.get('voice').children.length, 3);
  assert.equal(ui.nodes.get('voice').value, 'Tina');
});

test('one primary click saves and connects without a separate test', async () => {
  const ui = await renderer();
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.save, 1);
  assert.equal(ui.calls.connect, 1);
  assert.equal(ui.calls.test, 0);
  assert.equal(ui.calls.connectedProvider, 'qwen');
  assert.equal(ui.nodes.get('finish').hidden, false);
  assert.equal(ui.nodes.get('secret-apiKey').value, '');
  await ui.nodes.get('finish').click();
  assert.equal(ui.calls.finish, 1);
});

test('missing required credentials do not save or request a connection', async () => {
  const ui = await renderer();
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.connect, 0);
  assert.equal(ui.calls.save, 0);
  assert.match(ui.nodes.get('feedback').textContent, /请先填写/);
  const cartesia = ui.nodes.get('provider-options').children.find(item => item.dataset.provider === 'cartesia');
  cartesia.click();
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  await ui.nodes.get('connect').click();
  assert.match(ui.nodes.get('feedback').textContent, /DeepSeek/);
  assert.equal(ui.calls.connect, 0);
});

test('clicking provider cards clears unsaved keys and preserves saved uncommon voices', async () => {
  const ui = await renderer();
  const google = ui.settings.providers.find(item => item.id === 'google');
  google.voice = 'Charon';
  ui.nodes.get('secret-apiKey').value = 'unsaved-qwen';
  ui.nodes.get('provider-options').children.find(item => item.dataset.provider === 'google').click();
  assert.equal(ui.nodes.get('provider').value, 'google');
  assert.equal(ui.nodes.get('secret-apiKey').value, '');
  assert.equal(ui.nodes.get('voice').value, 'Charon');
  assert.equal(ui.nodes.get('voice').children.length, 4);
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.saved.voice, 'Charon');
});

test('advanced voice and Gemini translation choices reach the matching profile', async () => {
  const ui = await renderer();
  ui.nodes.get('provider-options').children.find(item => item.dataset.provider === 'google').click();
  ui.nodes.get('all-voices').value = 'Charon'; ui.nodes.get('all-voices').listeners.change();
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.saved.voice, 'Charon');
  ui.nodes.get('google-mode').value = 'google-translate'; ui.nodes.get('google-mode').listeners.change();
  assert.equal(ui.nodes.get('voice-fields').hidden, true);
  assert.equal(ui.nodes.get('finish').hidden, true);
  ui.nodes.get('secret-apiKey').value = 'translation-key';
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.saved.provider, 'google-translate');
  assert.equal(ui.calls.connectedProvider, 'google-translate');
  assert.equal(ui.nodes.get('provider').children.length, 4);
});

test('changing purpose remembers provider choices and clicking the active tab keeps input', async () => {
  const ui = await renderer();
  ui.nodes.get('provider-options').children.find(item => item.dataset.provider === 'doubao').click();
  ui.nodes.get('secret-apiKey').value = 'unsaved';
  ui.nodes.get('usage-voice').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'unsaved');
  ui.nodes.get('provider-options').children.find(item => item.dataset.provider === 'doubao').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'unsaved');
  ui.nodes.get('usage-translate').click();
  assert.equal(ui.nodes.get('provider').children.length, 2);
  assert.equal(ui.nodes.get('connect').hidden, true);
  ui.nodes.get('usage-voice').click();
  assert.equal(ui.nodes.get('provider').value, 'doubao');
  assert.equal(ui.nodes.get('secret-apiKey').value, 'unsaved');
});

test('Qwen shares a key draft across purposes without submitting voice model changes for translation', async () => {
  const ui = await renderer();
  ui.nodes.get('secret-apiKey').value = 'shared-qwen-key';
  ui.nodes.get('voice').value = 'Raymond'; ui.nodes.get('voice').listeners.change();
  ui.nodes.get('usage-translate').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'shared-qwen-key');
  assert.match(ui.nodes.get('shared-credentials').textContent, /共用/);
  await ui.nodes.get('test').click();
  assert.equal(ui.calls.saved.purpose, 'translate');
  assert.equal(ui.calls.saved.model, undefined);
  assert.equal(ui.calls.saved.voice, undefined);
  assert.equal(ui.calls.saved.secrets.apiKey, 'shared-qwen-key');
  ui.nodes.get('usage-voice').click();
  assert.equal(ui.nodes.get('voice').value, 'Raymond');
  assert.equal(ui.nodes.get('secret-apiKey').value, '');
});

test('failed saves retain the input for correction and retry', async () => {
  const ui = await renderer({ saveAISettings: async () => ({ ok: false, error: 'Unable to save' }) });
  ui.nodes.get('secret-apiKey').value = 'retry-key';
  await ui.nodes.get('connect').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'retry-key');
  assert.equal(ui.calls.connect, 0);
  assert.match(ui.nodes.get('feedback').textContent, /Unable to save/);
});

test('late cancelled test results cannot report setup complete', async () => {
  let resolveTest;
  const ui = await renderer({ testTextConnection: () => new Promise(resolve => { resolveTest = resolve; }) });
  ui.nodes.get('usage-translate').click();
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  const pending = ui.nodes.get('test').click();
  await tick();
  ui.nodes.get('cancel').click();
  resolveTest({ ok: true, result: { ok: true, message: 'ready' } });
  await pending;
  assert.equal(ui.nodes.get('finish').hidden, true);
  assert.match(ui.nodes.get('feedback').textContent, /已取消/);
});

test('connection status prevents duplicate starts, offers retry, and marks unsaved changes', async () => {
  const ui = await renderer({ connectAI: async () => ({ ok: true, status: { status: 'connecting', providerId: 'qwen' } }) });
  ui.nodes.get('secret-apiKey').value = 'synthetic';
  await ui.nodes.get('connect').click();
  assert.equal(ui.nodes.get('connect').disabled, true);
  assert.match(ui.nodes.get('connect').textContent, /正在连接/);
  assert.equal(ui.nodes.get('finish').hidden, true);
  ui.calls.statusListener({ status: 'error', providerId: 'qwen', error: 'Unable to connect' });
  assert.equal(ui.nodes.get('connect').disabled, false);
  assert.match(ui.nodes.get('connect').textContent, /重试/);
  ui.calls.statusListener({ status: 'connected', providerId: 'qwen' });
  assert.equal(ui.nodes.get('finish').hidden, false);
  assert.equal(ui.nodes.get('connect').className, 'secondary');
  ui.nodes.get('voice').value = 'Raymond'; ui.nodes.get('voice').listeners.change();
  assert.equal(ui.nodes.get('finish').hidden, true);
  assert.equal(ui.nodes.get('connect').className, 'primary');
  assert.match(ui.nodes.get('feedback').textContent, /设置有更改/);
});

test('choosing a provider focuses its key field and Enter starts configuration', async () => {
  const ui = await renderer();
  ui.nodes.get('provider-options').children.find(item => item.dataset.provider === 'doubao').click();
  const input = ui.nodes.get('secret-apiKey');
  assert.equal(input.focused, true);
  input.value = 'synthetic';
  input.listeners.keydown({ key: 'Enter', isComposing: true, preventDefault() {} });
  assert.equal(ui.calls.save, 0, 'IME confirmation must not submit a key');
  input.listeners.keydown({ key: 'Enter', preventDefault() {} });
  await tick();
  assert.equal(ui.calls.connectedProvider, 'doubao');
});

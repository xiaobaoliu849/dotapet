import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { AI_PROVIDERS, credentialAccount } from '../src/main/aiSettingsStore.js';

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
      const forget = node => { if (node.id) nodes.delete(node.id); node.children?.forEach(forget); };
      this.children.forEach(forget);
      this.children = [];
      this.append(...children);
    }
    append(...children) {
      this.children.push(...children);
      // Register nested ids so key inputs built inside wrappers are reachable.
      const register = node => { if (node.id) nodes.set(node.id, node); node.children?.forEach(register); };
      children.forEach(register);
    }
    click() { return this.listeners.click?.(); }
  }
  for (const id of ['feedback', 'translate-feedback', 'provider-help', 'secret-fields', 'optional-secret-fields', 'workspace-fields', 'voice-fields', 'connection-status', 'provider-options', 'translator-options', 'translate-state', 'translate-key', 'translate-model-fields', 'all-voice-fields', 'custom-voice-fields', 'google-mode-fields', 'voice-card', 'translate-card', 'welcome-pet']) nodes.set(id, new Element('div', id));
  for (const id of ['provider', 'voice', 'region', 'google-mode', 'all-voices']) nodes.set(id, new Element('select', id));
  for (const id of ['model', 'workspace', 'voice-custom', 'custom-voice-id', 'translate-model', 'preferred-address']) nodes.set(id, new Element('input', id));
  nodes.set('custom-instructions', new Element('textarea', 'custom-instructions'));
  for (const id of ['connect', 'disconnect', 'save', 'test', 'cancel', 'import', 'voice-test', 'finish', 'skip', 'translate-change']) nodes.set(id, new Element('button', id));
  const settings = { selectedProvider: 'qwen', translationProvider: 'qwen', encryptionAvailable: true,
    providers: AI_PROVIDERS.map(item => ({ ...item, fields: item.fields.map(field => ({ ...field, account: credentialAccount(item.id, field.id), configured: false })) })) };
  const calls = { test: 0, cancel: 0, save: 0, connect: 0, finish: 0, saves: [] };
  const api = {
    getAISettings: async () => ({ ok: true, settings }),
    saveAISettings: async data => { calls.save++; calls.saved = data; calls.saves.push(data); return { ok: true, settings }; },
    testAIConnection: async () => { calls.test++; return { ok: true, result: { ok: true, message: 'ready' } }; },
    testTextConnection: async () => { calls.text = (calls.text || 0) + 1; return { ok: true, result: { ok: true, message: 'text ready' } }; },
    cancelAITest: async () => { calls.cancel++; return { ok: true }; },
    connectAI: async provider => { calls.connect++; calls.connectedProvider = provider; return { ok: true, status: { status: 'connected', providerId: provider } }; },
    finishAISetup: async () => { calls.finish++; return { ok: true }; },
    deleteAISecrets: async (provider, field) => { calls.deleted = [provider, field]; return { ok: true, settings }; },
    onVoiceStatus(listener) { calls.statusListener = listener; }, ...overrides,
  };
  const document = {
    getElementById: id => nodes.get(id),
    createElement: tag => new Element(tag),
    querySelectorAll: () => [...nodes.values()].filter(node => ['button', 'input', 'select', 'textarea'].includes(node.tag)),
  };
  vm.runInNewContext(source, { window: { electronAPI: api }, document, setTimeout, Option: class { constructor(text, value) { Object.assign(this, { text, value }); } } });
  await tick();
  return { nodes, calls, settings };
}
const card = (ui, id, group = 'provider-options') => ui.nodes.get(group).children.find(item => item.dataset.provider === id);
const configure = (ui, id) => { for (const field of ui.settings.providers.find(item => item.id === id).fields) field.configured = true; };
const type = (ui, id, value) => { ui.nodes.get(id).value = value; ui.nodes.get(id).listeners.input(); };

test('address and instructions survive provider and translation changes and save only with voice', async () => {
  const ui = await renderer();
  type(ui, 'preferred-address', 'Daddy');
  type(ui, 'custom-instructions', 'Call James Jay.\nKeep replies warm.');
  card(ui, 'doubao').click();
  assert.equal(ui.nodes.get('preferred-address').value, 'Daddy');
  configure(ui, 'deepseek');
  card(ui, 'deepseek', 'translator-options').click(); await tick();
  assert.equal(ui.calls.saved.conversation, undefined);
  assert.equal(ui.nodes.get('custom-instructions').value, 'Call James Jay.\nKeep replies warm.');
  assert.equal(ui.nodes.get('preferred-address').value, 'Daddy');
  await ui.nodes.get('save').click();
  assert.equal(ui.calls.saved.conversation.preferredAddress, 'Daddy');
  assert.equal(ui.calls.saved.conversation.customInstructions, 'Call James Jay.\nKeep replies warm.');
});

test('failed personalization saves keep the draft; pending saves disable both preference controls', async () => {
  let resolve;
  const ui = await renderer({ saveAISettings: () => new Promise(done => { resolve = done; }) });
  type(ui, 'preferred-address', '队长');
  type(ui, 'custom-instructions', '简短一点');
  const pending = ui.nodes.get('save').click();
  assert.equal(ui.nodes.get('preferred-address').disabled, true);
  assert.equal(ui.nodes.get('custom-instructions').disabled, true);
  resolve({ ok: false, error: 'Save failed' }); await pending;
  card(ui, 'google').click();
  assert.equal(ui.nodes.get('preferred-address').value, '队长');
  assert.equal(ui.nodes.get('custom-instructions').value, '简短一点');
});

test('one page shows four voice providers and a translation card without cloud calls', async () => {
  const ui = await renderer();
  assert.deepEqual(ui.nodes.get('provider').children.map(item => item.value), ['qwen', 'doubao', 'google', 'cartesia']);
  assert.equal(ui.nodes.get('provider-options').children.length, 4);
  assert.deepEqual(ui.nodes.get('translator-options').children.map(item => item.dataset.provider), ['qwen', 'deepseek']);
  assert.equal(ui.calls.connect + ui.calls.test + ui.calls.save, 0);
  assert.equal(ui.nodes.get('voice').children.length, 3);
  assert.equal(ui.nodes.get('voice').value, 'Tina');
});

test('the Qwen key is pasted once: translation reuses it instead of asking again', async () => {
  const ui = await renderer();
  assert.equal(ui.nodes.get('translate-key').children.length, 0, 'no second key box');
  assert.match(ui.nodes.get('translate-state').textContent, /上方的阿里千问密钥/);
  type(ui, 'secret-apiKey', 'shared-qwen-key');
  ui.nodes.get('voice').value = 'Raymond'; ui.nodes.get('voice').listeners.change();
  await ui.nodes.get('test').click();
  assert.equal(ui.calls.saved.purpose, 'translate');
  assert.equal(ui.calls.saved.translationProvider, 'qwen');
  assert.equal(ui.calls.saved.secrets.apiKey, 'shared-qwen-key');
  assert.equal(ui.calls.saved.model, undefined);
  assert.equal(ui.calls.saved.voice, undefined);
  assert.equal(ui.calls.text, 1);
  assert.equal(ui.calls.test, 0);
  assert.equal(ui.nodes.get('voice').value, 'Raymond', 'unsaved voice choice survives a translation save');
});

test('Cartesia DeepSeek key doubles as the DeepSeek translation key and saves in one click', async () => {
  const ui = await renderer();
  card(ui, 'cartesia').click();
  card(ui, 'deepseek', 'translator-options').click();
  assert.equal(ui.calls.save, 0);
  assert.equal(ui.nodes.get('translate-key').children.length, 0, 'no second DeepSeek box');
  assert.match(ui.nodes.get('translate-state').textContent, /上方的 DeepSeek 密钥/);
  type(ui, 'secret-apiKey', 'cartesia');
  type(ui, 'secret-llmApiKey', 'deepseek');
  // The vault has both keys once the voice save returns.
  configure(ui, 'cartesia'); configure(ui, 'deepseek');
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.test, 1);
  assert.equal(ui.calls.connect, 0, 'setup only tests; the paid session waits for Alt+Q');
  assert.deepEqual(ui.calls.saves.map(item => item.provider), ['cartesia', 'deepseek']);
  assert.equal(ui.calls.saves[0].secrets.llmApiKey, 'deepseek');
  assert.equal(ui.calls.saves[1].translationProvider, 'deepseek');
});

test('a translator without a saved key shows one key box and saves with the translate purpose', async () => {
  const ui = await renderer();
  card(ui, 'deepseek', 'translator-options').click();
  assert.equal(ui.calls.save, 0, 'choosing a translator without a key does not save yet');
  type(ui, 'translate-secret', 'synthetic');
  assert.match(ui.nodes.get('test').textContent, /保存并启用/);
  await ui.nodes.get('test').click();
  assert.equal(ui.calls.saved.provider, 'deepseek');
  assert.equal(ui.calls.saved.translationProvider, 'deepseek');
  assert.equal(ui.calls.saved.secrets.apiKey, 'synthetic');
  assert.equal(ui.calls.text, 1);
  assert.equal(ui.calls.test, 0);
});

test('switching to a translator whose key is saved applies immediately', async () => {
  const ui = await renderer();
  configure(ui, 'deepseek');
  card(ui, 'deepseek', 'translator-options').click();
  await tick();
  assert.equal(ui.calls.saved.translationProvider, 'deepseek');
  assert.equal(ui.calls.saved.secrets, undefined);
  assert.match(ui.nodes.get('translate-feedback').textContent, /DeepSeek/);
});

test('Gemini chat and live translation share one key draft', async () => {
  const ui = await renderer();
  card(ui, 'google').click();
  type(ui, 'secret-apiKey', 'google-key');
  ui.nodes.get('google-mode').value = 'google-translate'; ui.nodes.get('google-mode').listeners.change();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'google-key');
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.saved.provider, 'google-translate');
  assert.equal(ui.calls.saved.secrets.apiKey, 'google-key');
  assert.equal(ui.calls.test, 1);
  assert.equal(ui.calls.connect, 0);
});

test('a saved key is removed only after a confirming second click', async () => {
  const ui = await renderer();
  configure(ui, 'qwen');
  card(ui, 'doubao').click(); card(ui, 'qwen').click();
  const heading = ui.nodes.get('secret-fields').children[0].children[0];
  const remove = heading.children.find(child => child.className?.includes('key-remove'));
  remove.click();
  assert.equal(ui.calls.deleted, undefined);
  assert.match(remove.textContent, /确认/);
  remove.click(); await tick();
  assert.deepEqual(ui.calls.deleted, ['qwen', 'apiKey']);
});

test('cancelling while settings save is pending prevents any provider test request', async () => {
  let resolveSave;
  const ui = await renderer({ saveAISettings: () => new Promise(resolve => { resolveSave = resolve; }) });
  type(ui, 'secret-apiKey', 'synthetic');
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
  type(ui, 'secret-apiKey', 'synthetic');
  const pending = ui.nodes.get('voice-test').click();
  await tick();
  for (const id of ['connect', 'provider', 'save', 'test']) assert.equal(ui.nodes.get(id).disabled, true, id);
  finishTest({ ok: true, result: { ok: true, message: 'ready' } });
  await pending;
  assert.equal(ui.nodes.get('connect').disabled, false);
  assert.equal(ui.nodes.get('cancel').hidden, true);
});

test('one primary click saves and proves the setup with a self-closing test', async () => {
  const ui = await renderer();
  type(ui, 'secret-apiKey', 'synthetic');
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.save, 1);
  assert.equal(ui.calls.test, 1);
  assert.equal(ui.calls.connect, 0, 'setup never opens the billed session');
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
  assert.match(ui.nodes.get('feedback').textContent, /请先粘贴/);
  card(ui, 'cartesia').click();
  type(ui, 'secret-apiKey', 'synthetic');
  await ui.nodes.get('connect').click();
  assert.match(ui.nodes.get('feedback').textContent, /DeepSeek/);
  assert.equal(ui.calls.connect, 0);
});

test('provider cards keep each account draft separate and preserve saved uncommon voices', async () => {
  const ui = await renderer();
  ui.settings.providers.find(item => item.id === 'google').voice = 'Charon';
  type(ui, 'secret-apiKey', 'unsaved-qwen');
  card(ui, 'google').click();
  assert.equal(ui.nodes.get('provider').value, 'google');
  assert.equal(ui.nodes.get('secret-apiKey').value, '');
  assert.equal(ui.nodes.get('voice').value, 'Charon');
  assert.equal(ui.nodes.get('voice').children.length, 4);
  card(ui, 'qwen').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'unsaved-qwen');
  card(ui, 'google').click();
  type(ui, 'secret-apiKey', 'synthetic');
  await ui.nodes.get('connect').click();
  assert.equal(ui.calls.saved.voice, 'Charon');
});

test('advanced voice choices survive provider changes with a selectable option', async () => {
  const ui = await renderer();
  card(ui, 'google').click();
  ui.nodes.get('all-voices').value = 'Charon'; ui.nodes.get('all-voices').listeners.change();
  card(ui, 'qwen').click(); card(ui, 'google').click();
  assert.equal(ui.nodes.get('voice').value, 'Charon');
  assert.ok(ui.nodes.get('voice').options.some(option => option.value === 'Charon'));
});

test('cancelled import keeps the current key draft', async () => {
  const ui = await renderer({ importAIConfig: async () => ({ ok: true, cancelled: true }) });
  type(ui, 'secret-apiKey', 'unsaved-key');
  await ui.nodes.get('import').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'unsaved-key');
});

test('failed saves retain the input for correction and retry', async () => {
  const ui = await renderer({ saveAISettings: async () => ({ ok: false, error: 'Unable to save' }) });
  type(ui, 'secret-apiKey', 'retry-key');
  await ui.nodes.get('connect').click();
  assert.equal(ui.nodes.get('secret-apiKey').value, 'retry-key');
  assert.equal(ui.calls.connect, 0);
  assert.match(ui.nodes.get('feedback').textContent, /Unable to save/);
});

test('late cancelled translation tests cannot report success', async () => {
  let resolveTest;
  const ui = await renderer({ testTextConnection: () => new Promise(resolve => { resolveTest = resolve; }) });
  type(ui, 'secret-apiKey', 'synthetic');
  const pending = ui.nodes.get('test').click();
  await tick();
  ui.nodes.get('cancel').click();
  resolveTest({ ok: true, result: { ok: true, message: 'ready' } });
  await pending;
  assert.match(ui.nodes.get('translate-feedback').textContent, /已取消/);
});

test('connection status prevents duplicate starts, offers retry, and marks unsaved changes', async () => {
  const ui = await renderer();
  ui.calls.statusListener({ status: 'connecting', providerId: 'qwen' });
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
  card(ui, 'doubao').click();
  const input = ui.nodes.get('secret-apiKey');
  assert.equal(input.focused, true);
  type(ui, 'secret-apiKey', 'synthetic');
  input.listeners.keydown({ key: 'Enter', isComposing: true, preventDefault() {} });
  assert.equal(ui.calls.save, 0, 'IME confirmation must not submit a key');
  input.listeners.keydown({ key: 'Enter', preventDefault() {} });
  await tick();
  assert.equal(ui.calls.test, 1);
  assert.equal(ui.calls.saved?.provider, 'doubao');
  assert.equal(ui.calls.connect, 0);
});

test('a purpose request brings the asked card forward without saving or connecting', async () => {
  let request;
  const ui = await renderer({ onSettingsPurpose: listener => { request = listener; } });
  ui.nodes.get('voice-card').scrollIntoView = () => {};
  ui.nodes.get('voice-card').classList = { add(name) { ui.nodes.get('voice-card').highlighted = name; }, remove() {} };
  request('help');
  assert.equal(ui.nodes.get('voice-card').highlighted, undefined, 'help now lives in its own sidebar page');
  request('voice');
  assert.equal(ui.nodes.get('voice-card').highlighted, 'attention');
  assert.equal(ui.calls.save + ui.calls.connect + ui.calls.test, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AISettingsStore } from '../src/main/aiSettingsStore.js';
import { applyAIConfiguration, engineOptions, checkTextConnection } from '../src/main/aiConfiguration.js';
import { CLOUD_KEYS, CloudVoiceEngine, configureCloudKeys, loadEnv } from '../src/services/cloudVoiceEngine.js';
import { checkVoiceConnection, connectionError } from '../src/services/connectionCheck.js';
import { TranslationService } from '../src/services/translationService.js';
import { isTrustedSettingsSender, aiKeyPage, settingsAffectVoice } from '../src/main/aiSettingsIpc.js';

test('key acquisition opens only known provider pages and rejects arbitrary URLs', () => {
  for (const id of ['qwen', 'doubao', 'google', 'google-translate', 'cartesia', 'deepseek']) assert.equal(new URL(aiKeyPage(id)).protocol, 'https:');
  assert.equal(aiKeyPage('google'), aiKeyPage('google-translate'));
  for (const value of ['https://example.com', 'file:///C:/', 'javascript:alert(1)', '__proto__']) assert.throws(() => aiKeyPage(value));
});

// Unit-test substitute for OS encryption. Electron smoke tests use actual DPAPI.
const key = crypto.randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()]);
  },
  decryptString(value) {
    const cipher = crypto.createDecipheriv('aes-256-cbc', key, value.subarray(0, 16));
    return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString('utf8');
  },
};
function vault(t, secure = encryption) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-vault-test-'));
  t.after(() => { configureCloudKeys(); fs.rmSync(directory, { recursive: true, force: true }); });
  const filePath = path.join(directory, 'ai-settings.json');
  return new AISettingsStore({ filePath, safeStorage: secure });
}

test('conversation preferences persist globally, preserve credentials and can be cleared', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'private-key' } });
  const originalSecrets = structuredClone(store.data.providers.qwen.secrets);
  const conversation = { preferredAddress: ' Daddy ', customInstructions: 'Be gentle.\nCall my friend James Jay.' };
  const visible = store.save({ provider: 'qwen', conversation });
  assert.equal(visible.conversation.preferredAddress, 'Daddy');
  assert.deepEqual(store.data.providers.qwen.secrets, originalSecrets);
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.deepEqual(reloaded.publicSettings().conversation, visible.conversation);
  for (const provider of ['qwen', 'doubao', 'google', 'cartesia']) {
    assert.deepEqual(engineOptions(reloaded, provider).conversationPreferences, visible.conversation);
  }
  reloaded.save({ provider: 'deepseek', purpose: 'translate', conversation: { preferredAddress: 'ignored' } });
  assert.deepEqual(reloaded.publicSettings().conversation, visible.conversation);
  reloaded.save({ provider: 'doubao' });
  assert.deepEqual(reloaded.publicSettings().conversation, visible.conversation);
  reloaded.save({ provider: 'doubao', conversation: { preferredAddress: '', customInstructions: '' } });
  assert.deepEqual(reloaded.publicSettings().conversation, { preferredAddress: '', customInstructions: '' });
});

test('old vaults migrate with empty preferences; invalid preferences cannot overwrite the vault', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'preserved' } });
  const before = fs.readFileSync(store.filePath, 'utf8');
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.deepEqual(reloaded.publicSettings().conversation, { preferredAddress: '', customInstructions: '' });
  for (const conversation of [null, [], 'bad', { preferredAddress: 123 }, { preferredAddress: 'a\nb' }, { preferredAddress: 'a'.repeat(81) }, { customInstructions: 'a'.repeat(2001) }, { customInstructions: '\0' }]) {
    assert.throws(() => store.save({ provider: 'qwen', conversation }));
    assert.equal(fs.readFileSync(store.filePath, 'utf8'), before);
    assert.equal(store.getPrivate('qwen').apiKey, 'preserved');
  }
});

test('translation saves keep the selected voice provider and Qwen voice model', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', model: 'custom-voice-model', voice: 'Raymond', secrets: { apiKey: 'shared-key' } });
  store.save({ provider: 'doubao', secrets: { apiKey: 'voice-key' } });
  store.save({ provider: 'deepseek', purpose: 'translate', translationProvider: 'deepseek', secrets: { apiKey: 'text-key' } });
  assert.equal(store.data.selectedProvider, 'doubao');
  store.save({ provider: 'qwen', purpose: 'translate', translationProvider: 'qwen', model: 'qwen-flash', voice: 'Tina' });
  assert.equal(store.getPrivate('qwen').model, 'custom-voice-model');
  assert.equal(store.getPrivate('qwen').voice, 'Raymond');
  assert.equal(store.getPrivate('qwen').apiKey, 'shared-key');
  assert.equal(store.data.selectedProvider, 'doubao');
  assert.equal(new AISettingsStore({ filePath: store.filePath, safeStorage: encryption }).data.selectedProvider, 'doubao');
  assert.throws(() => store.save({ provider: 'doubao', purpose: 'translate' }));
  assert.throws(() => store.save({ provider: 'qwen', purpose: 'unknown' }));
});

test('translation changes interrupt voice only when its shared credentials change', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'shared-key' } });
  assert.equal(settingsAffectVoice(store, { provider: 'deepseek', purpose: 'translate', secrets: { apiKey: 'text-key' } }, 'qwen'), false);
  assert.equal(settingsAffectVoice(store, { provider: 'qwen', purpose: 'translate', secrets: { apiKey: '' }, region: 'beijing', workspaceId: '' }, 'qwen'), false);
  assert.equal(settingsAffectVoice(store, { provider: 'qwen', purpose: 'translate', secrets: { apiKey: 'shared-key' } }, 'qwen'), false);
  assert.equal(settingsAffectVoice(store, { provider: 'qwen', purpose: 'translate', secrets: { apiKey: 'replacement' } }, 'qwen'), true);
  assert.equal(settingsAffectVoice(store, { provider: 'qwen', purpose: 'translate', region: 'singapore' }, 'qwen'), true);
});

test('vault encrypts secrets, reloads them and exposes only configuration flags', t => {
  const store = vault(t);
  const visible = store.save({ provider: 'qwen', model: 'qwen3.8-omni-flash-realtime', voice: 'Tina', secrets: { apiKey: 'private-qwen-key' } });
  assert.equal(store.getPrivate('qwen').apiKey, 'private-qwen-key');
  assert.ok(!JSON.stringify(visible).includes('private-qwen-key'));
  assert.ok(!fs.readFileSync(store.filePath, 'utf8').includes('private-qwen-key'));
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(reloaded.getPrivate('qwen').apiKey, 'private-qwen-key');
  store.save({ provider: 'qwen', secrets: { apiKey: '' } });
  assert.equal(store.getPrivate('qwen').apiKey, 'private-qwen-key');
});

test('provider switching keeps unrelated keys separate; deleting clears persisted and runtime credentials', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'qwen-only' } });
  store.save({ provider: 'google', secrets: { apiKey: 'google-only' } });
  assert.equal(engineOptions(store, 'google').apiKey, 'google-only');
  assert.equal(engineOptions(store, 'qwen').apiKey, 'qwen-only');
  assert.equal(engineOptions(store, 'google-translate').apiKey, 'google-only', 'one Google key serves both Gemini modes');
  applyAIConfiguration(store);
  assert.equal(CLOUD_KEYS.dashscope, 'qwen-only');
  store.deleteSecrets('qwen');
  applyAIConfiguration(store);
  assert.equal(CLOUD_KEYS.dashscope, '');
  assert.equal(store.getPrivate('qwen').apiKey, '');
  assert.equal(store.getPrivate('google').apiKey, 'google-only');
  assert.equal(new AISettingsStore({ filePath: store.filePath, safeStorage: encryption }).getPrivate('qwen').apiKey, '');
});

test('a key is saved once per account and shared by every feature that uses it', t => {
  const store = vault(t);
  store.save({ provider: 'cartesia', secrets: { apiKey: 'voice', llmApiKey: 'deepseek-shared' } });
  assert.equal(store.getPrivate('deepseek').apiKey, 'deepseek-shared');
  assert.equal(store.data.translationProvider, 'deepseek', 'translation follows the account that has a key');
  store.save({ provider: 'deepseek', purpose: 'translate', translationProvider: 'deepseek', secrets: { apiKey: 'deepseek-new' } });
  assert.equal(store.getPrivate('cartesia').llmApiKey, 'deepseek-new');
  assert.equal(store.publicSettings().providers.find(item => item.id === 'cartesia').fields[1].configured, true);
  store.save({ provider: 'qwen', secrets: { apiKey: 'qwen-key' } });
  assert.equal(store.data.translationProvider, 'deepseek', 'an explicit working translator is kept');
  store.deleteSecrets('cartesia', 'llmApiKey');
  assert.equal(store.getPrivate('deepseek').apiKey, '');
  assert.equal(store.getPrivate('cartesia').apiKey, 'voice', 'removing one key leaves the others');
  assert.throws(() => store.deleteSecrets('cartesia', 'unknown'));
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(reloaded.getPrivate('deepseek').apiKey, '');
});

test('vaults from older versions share keys that were saved for one feature only', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'qwen' } });
  const data = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  data.providers.google = { secrets: { apiKey: encryption.encryptString('legacy-google').toString('base64') } };
  data.providers['google-translate'] = { secrets: {} };
  data.providers.deepseek = { secrets: { apiKey: encryption.encryptString('legacy-deepseek').toString('base64') } };
  data.providers.cartesia = { secrets: { apiKey: encryption.encryptString('cartesia').toString('base64'), llmApiKey: encryption.encryptString('other-deepseek').toString('base64') } };
  fs.writeFileSync(store.filePath, JSON.stringify(data));
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(reloaded.getPrivate('google-translate').apiKey, 'legacy-google');
  assert.equal(reloaded.getPrivate('cartesia').llmApiKey, 'other-deepseek', 'existing distinct keys are never overwritten on load');
  assert.equal(reloaded.getPrivate('deepseek').apiKey, 'legacy-deepseek');
});

test('saving a translation key interrupts voice only when the live session uses that account', t => {
  const store = vault(t);
  store.save({ provider: 'cartesia', secrets: { apiKey: 'voice', llmApiKey: 'deepseek' } });
  assert.equal(settingsAffectVoice(store, { provider: 'deepseek', purpose: 'translate', secrets: { apiKey: 'replacement' } }, 'cartesia'), true);
  assert.equal(settingsAffectVoice(store, { provider: 'deepseek', purpose: 'translate', secrets: { apiKey: 'deepseek' } }, 'cartesia'), false);
  assert.equal(settingsAffectVoice(store, { provider: 'deepseek', purpose: 'translate', secrets: { apiKey: 'replacement' } }, 'doubao'), false);
});

test('a damaged unselected credential cannot block healthy providers or retain old runtime keys', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'previous-qwen-key' } });
  store.save({ provider: 'deepseek', secrets: { apiKey: 'healthy-deepseek' } });
  applyAIConfiguration(store);
  const data = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  data.providers.qwen.secrets.apiKey = Buffer.from('broken ciphertext').toString('base64');
  fs.writeFileSync(store.filePath, JSON.stringify(data));
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(reloaded.error, '');
  applyAIConfiguration(reloaded);
  assert.equal(CLOUD_KEYS.dashscope, '');
  assert.equal(CLOUD_KEYS.deepseek, 'healthy-deepseek');
  assert.equal(engineOptions(reloaded, 'deepseek').apiKey, 'healthy-deepseek');
  assert.throws(() => engineOptions(reloaded, 'qwen'), /无法解密/);
  const visible = reloaded.publicSettings();
  assert.match(visible.providers.find(item => item.id === 'qwen').credentialError, /无法解密/);
  assert.equal(visible.providers.find(item => item.id === 'deepseek').credentialError, '');
  reloaded.deleteSecrets('qwen');
  assert.equal(reloaded.publicSettings().providers.find(item => item.id === 'qwen').credentialError, '');
});

test('persisted provider metadata cannot redirect a credential to an arbitrary host', t => {
  const store = vault(t);
  store.save({ provider: 'qwen', secrets: { apiKey: 'private-key' } });
  const original = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  for (const profile of [
    { ...original.providers.qwen, workspaceId: 'attacker.example/path' },
    { ...original.providers.qwen, region: 'attacker.example' },
    { ...original.providers.qwen, model: 'qwen\r\nInjected: header' },
    { ...original.providers.qwen, secrets: { apiKey: ['malformed'] } },
  ]) {
    const changed = { ...original, providers: { qwen: profile } };
    fs.writeFileSync(store.filePath, JSON.stringify(changed));
    const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
    assert.match(reloaded.error, /无法读取/);
    assert.throws(() => applyAIConfiguration(reloaded), /无法读取/);
    assert.equal(CLOUD_KEYS.dashscope, '');
    assert.deepEqual(JSON.parse(fs.readFileSync(store.filePath, 'utf8')), changed);
  }
});

test('settings IPC rejects other windows, subframes and navigated documents', () => {
  const url = 'file:///trusted/ai-settings.html';
  const frame = { url };
  const webContents = { mainFrame: frame };
  const win = { isDestroyed: () => false, webContents };
  const event = { sender: webContents, senderFrame: frame };
  assert.equal(isTrustedSettingsSender(event, win, url), true);
  assert.equal(isTrustedSettingsSender({ ...event, sender: {} }, win, url), false);
  assert.equal(isTrustedSettingsSender({ ...event, senderFrame: { url } }, win, url), false);
  frame.url = 'https://untrusted.example';
  assert.equal(isTrustedSettingsSender(event, win, url), false);
  assert.equal(isTrustedSettingsSender(event, null, url), false);
});

test('explicit import encrypts supported keys and excludes auth tokens and arbitrary endpoints', t => {
  const store = vault(t);
  const result = store.importConfig({ api_keys: { google_api_key: 'import-google', cartesia_api_key: 'import-cartesia', deepseek_api_key: 'import-deepseek', dashscope_api_key: 'import-qwen' },
    auth_settings: { admin_token: 'never-import-admin' }, realtime_api_urls: { DashScope: 'wss://myworkspace.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime', Google: 'wss://untrusted.example' } });
  assert.equal(result.count, 5);
  assert.equal(store.getPrivate('cartesia').llmApiKey, 'import-deepseek');
  assert.equal(store.getPrivate('qwen').workspaceId, 'myworkspace');
  applyAIConfiguration(store);
  assert.equal(CLOUD_KEYS.dashscope_ws_url, 'wss://myworkspace.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime');
  assert.equal(CLOUD_KEYS.dashscope_base_url, 'https://myworkspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1');
  assert.equal(CLOUD_KEYS.google_ws_url, '');
  const file = fs.readFileSync(store.filePath, 'utf8');
  for (const value of ['import-google', 'import-cartesia', 'import-deepseek', 'never-import-admin', 'untrusted.example']) assert.ok(!file.includes(value));
});

test('saved Gemini 3.1 default upgrades through settings and engine options without losing credentials', t => {
  const store = vault(t);
  store.save({ provider: 'google', model: 'gemini-3.1-flash-live-preview', voice: 'Kore', secrets: { apiKey: 'migration-key' } });
  store.save({ provider: 'google-translate', model: 'gemini-3.5-live-translate-preview' });
  const before = JSON.parse(fs.readFileSync(store.filePath, 'utf8')).providers;
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(reloaded.getPrivate('google').model, 'gemini-3.8-live');
  assert.equal(reloaded.publicSettings().providers.find(p => p.id === 'google').model, 'gemini-3.8-live');
  assert.equal(engineOptions(reloaded, 'google').googleModel, 'gemini-3.8-live');
  assert.equal(reloaded.getPrivate('google').voice, 'Kore');
  assert.equal(reloaded.getPrivate('google').apiKey, 'migration-key');
  assert.deepEqual(reloaded.data.providers.google.secrets, before.google.secrets);
  assert.deepEqual(reloaded.data.providers['google-translate'], before['google-translate']);
  reloaded.save({ provider: 'google', voice: 'Puck' });
  const persisted = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(persisted.getPrivate('google').model, 'gemini-3.8-live');
});

test('Gemini migration preserves custom models and accepts the prefixed former default', t => {
  const store = vault(t);
  for (const [saved, expected] of [
    ['models/gemini-3.1-flash-live-preview', 'gemini-3.8-live'],
    ['custom-live-model', 'custom-live-model'],
    ['gemini-3.8-live', 'gemini-3.8-live'],
  ]) {
    store.save({ provider: 'google', model: saved });
    const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
    assert.equal(engineOptions(reloaded, 'google').googleModel, expected);
  }
});

test('legacy DeepSeek model migrates without changing its encrypted key', t => {
  const store = vault(t);
  store.save({ provider: 'deepseek', model: 'deepseek-chat', secrets: { apiKey: 'migration-key' } });
  const before = JSON.parse(fs.readFileSync(store.filePath, 'utf8')).providers.deepseek.secrets;
  const reloaded = new AISettingsStore({ filePath: store.filePath, safeStorage: encryption });
  assert.equal(reloaded.getPrivate('deepseek').model, 'deepseek-flash');
  assert.equal(reloaded.getPrivate('deepseek').apiKey, 'migration-key');
  assert.deepEqual(reloaded.data.providers.deepseek.secrets, before);
});

test('unavailable OS encryption fails closed without saving plaintext', t => {
  const store = vault(t, { isEncryptionAvailable: () => false });
  assert.throws(() => store.save({ provider: 'google', secrets: { apiKey: 'never-plaintext' } }), /加密不可用/);
  assert.ok(!fs.existsSync(store.filePath));
});

test('unreadable vault is preserved; unsafe provider/profile inputs are rejected', t => {
  const store = vault(t);
  fs.writeFileSync(store.filePath, '{broken');
  store.load();
  assert.throws(() => store.save({ provider: 'qwen' }), /无法读取/);
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), '{broken');
  const clean = vault(t);
  assert.throws(() => clean.save({ provider: '__proto__' }), /不支持/);
  assert.throws(() => clean.save({ provider: 'qwen', workspaceId: '../other' }), /格式/);
  assert.throws(() => clean.save({ provider: 'qwen', secrets: { apiKey: 'key\nheader' } }), /格式/);
});

test('environment credentials are never imported and missing keys never change providers', async t => {
  vault(t);
  const saved = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = 'environment-key';
  t.after(() => { if (saved === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = saved; });
  loadEnv();
  assert.equal(CLOUD_KEYS.gemini, '');
  for (const provider of ['qwen', 'doubao', 'google', 'cartesia']) {
    const engine = new CloudVoiceEngine({ provider, autoReconnect: false });
    const events = [];
    engine.on('status', event => events.push(event));
    await engine.connect();
    assert.equal(engine.provider, provider);
    assert.ok(events.some(event => event.status === 'error'));
    assert.equal(engine.ws, null);
    engine.disconnect();
  }
});

class FakeEngine extends EventEmitter {
  constructor(provider, action) { super(); this.provider = provider; this.action = action; this.closed = 0; }
  connect() { this.action?.(this); }
  disconnect() { this.closed++; }
}

test('connection test waits for Qwen configuration acceptance and always closes the temporary session', async () => {
  const engine = new FakeEngine('qwen', self => {
    self.emit('session_ready');
    setTimeout(() => self.emit('session_configured'), 5);
  });
  const result = await checkVoiceConnection(engine, { timeoutMs: 100 });
  assert.equal(result.ok, true);
  assert.equal(engine.closed, 1);
  assert.equal(engine.listenerCount('status'), 0);
});

test('rejected key, timeout and cancellation close sessions without retry', async () => {
  const rejected = new FakeEngine('google', self => self.emit('status', { status: 'error', error: 'HTTP 401 secret-provider-key' }));
  assert.deepEqual(await checkVoiceConnection(rejected), { ok: false, message: '密钥无效或已过期，请在 AI 设置中更换密钥。' });
  assert.equal(rejected.closed, 1);
  const stalled = new FakeEngine('google');
  assert.equal((await checkVoiceConnection(stalled, { timeoutMs: 5 })).ok, false);
  assert.equal(stalled.closed, 1);
  const controller = new AbortController();
  const cancelled = new FakeEngine('google', () => controller.abort());
  assert.equal((await checkVoiceConnection(cancelled, { signal: controller.signal })).message, '测试已取消，请重新测试。');
  assert.equal(cancelled.closed, 1);
});

test('text check validates a response and never returns provider credentials in errors', async () => {
  const result = await checkTextConnection({ apiKey: 'user-private', model: 'deepseek-chat' }, {
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer user-private');
      return { ok: false, status: 403, text: async () => 'denied user-private' };
    },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.message.includes('user-private'));
  assert.match(connectionError('Quota exceeded'), /额度/);
});

test('translation calls only the explicitly selected text provider', async t => {
  vault(t);
  configureCloudKeys({ dashscope: 'qwen-key', deepseek: 'deepseek-key', translation_provider: 'qwen' });
  const service = new TranslationService();
  const calls = [];
  service.callChatCompletions = async (url, key) => { calls.push(key); return null; };
  await service.callCloudLLMTranslation('撤退');
  assert.deepEqual(calls, ['qwen-key']);
  calls.length = 0;
  configureCloudKeys({ dashscope: 'qwen-key', deepseek: 'deepseek-key', translation_provider: 'deepseek' });
  await service.callCloudLLMTranslation('撤退');
  assert.deepEqual(calls, ['deepseek-key']);
});

test('text turns never fall through to Cartesia/DeepSeek from another provider', async () => {
  for (const provider of ['qwen', 'doubao', 'google', 'google-translate', 'cartesia']) {
    const engine = new CloudVoiceEngine({ provider, autoReconnect: false });
    let cartesiaTurns = 0;
    engine.startCartesiaTurn = async () => { cartesiaTurns++; };
    await engine.sendUserText('hello');
    assert.equal(cartesiaTurns, 0, `Disconnected ${provider} must never call an LLM`);
    engine.isConnected = true;
    engine.ws = { readyState: 1, send() { throw new Error('failed socket'); }, close() {} };
    await engine.sendUserText('hello');
    assert.equal(cartesiaTurns, provider === 'cartesia' ? 1 : 0);
    if (provider === 'doubao') {
      engine.ws.send = () => {};
      await engine.sendUserText('text context');
      assert.equal(cartesiaTurns, 0, 'Connected Doubao must not use the Cartesia LLM');
    }
    engine.disconnect();
  }
});

test('Qwen microphone readiness requires session configuration acceptance', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen', autoReconnect: false });
  engine.isConnecting = true;
  const sent = [];
  engine.ws = { readyState: 1, send: value => sent.push(JSON.parse(value)), close() {} };
  engine.sendSessionUpdate();
  assert.equal(sent[0].type, 'session.update');
  engine.handleQwenRealtimeEvent({ type: 'session.created', session: { id: 'new-session' } });
  assert.equal(engine.isConnected, false);
  engine.handleQwenRealtimeEvent({ type: 'session.updated' });
  assert.equal(engine.isConnected, true);
  assert.equal(engine.isConnecting, false);
  engine.disconnect();
});

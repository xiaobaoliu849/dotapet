import fs from 'node:fs';
import path from 'node:path';
import { normalizeConversationPreferences } from '../services/conversationPreferences.js';
import {
  DEFAULT_DASHSCOPE_REALTIME_MODEL, DEFAULT_DASHSCOPE_REALTIME_VOICE,
  DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL, DEFAULT_DOUBAO_REALTIME_VOICE, DOUBAO_REALTIME_VOICES,
  DEFAULT_GOOGLE_REALTIME_MODEL, DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL, GOOGLE_REALTIME_VOICES,
  DEFAULT_CARTESIA_MODEL, DEFAULT_CARTESIA_VOICE, QWEN_OMNI_38_REALTIME_VOICES,
} from '../services/cloudVoiceEngine.js';

export const AI_PROVIDERS = [
  { id: 'qwen', label: '阿里千问 / Qwen', model: DEFAULT_DASHSCOPE_REALTIME_MODEL, voice: DEFAULT_DASHSCOPE_REALTIME_VOICE, voices: QWEN_OMNI_38_REALTIME_VOICES, fields: [{ id: 'apiKey', label: 'DashScope API Key' }] },
  { id: 'doubao', label: '火山豆包 / Doubao', model: DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL, voice: DEFAULT_DOUBAO_REALTIME_VOICE, voices: DOUBAO_REALTIME_VOICES, fields: [{ id: 'apiKey', label: '豆包实时语音 API Key' }, { id: 'websearchKey', label: '豆包联网搜索 API Key（可选）', optional: true }] },
  { id: 'google', label: 'Google 实时对话 / Gemini Live', model: DEFAULT_GOOGLE_REALTIME_MODEL, voice: 'Puck', voices: GOOGLE_REALTIME_VOICES, fields: [{ id: 'apiKey', label: 'Google API Key' }] },
  { id: 'google-translate', label: 'Google 实时翻译 / Live Translate', model: DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL, voice: '', voices: [], fields: [{ id: 'apiKey', label: 'Google API Key' }] },
  { id: 'cartesia', label: 'Cartesia + DeepSeek 英语对练', model: DEFAULT_CARTESIA_MODEL, voice: DEFAULT_CARTESIA_VOICE, voices: [], fields: [{ id: 'apiKey', label: 'Cartesia API Key' }, { id: 'llmApiKey', label: 'DeepSeek API Key（对话必需）' }] },
  { id: 'deepseek', label: 'DeepSeek 文字 / 截图翻译', model: 'deepseek-flash', voice: '', voices: [], fields: [{ id: 'apiKey', label: 'DeepSeek API Key' }], textOnly: true },
];

// One saved key per account: features that bill the same account share it, so
// a key is pasted once no matter how many features use it.
const SHARED_ACCOUNTS = {
  'google.apiKey': 'google', 'google-translate.apiKey': 'google',
  'deepseek.apiKey': 'deepseek', 'cartesia.llmApiKey': 'deepseek',
};

export function credentialAccount(providerId, fieldId) {
  return SHARED_ACCOUNTS[`${providerId}.${fieldId}`] || `${providerId}.${fieldId}`;
}

/** Every [provider, field] pair that stores the same account's key. */
export function linkedCredentialFields(providerId, fieldId) {
  const account = credentialAccount(providerId, fieldId);
  return AI_PROVIDERS.flatMap(provider => provider.fields
    .filter(field => credentialAccount(provider.id, field.id) === account)
    .map(field => [provider.id, field.id]));
}

export function providerDefinition(id) {
  const provider = AI_PROVIDERS.find(item => item.id === id);
  if (!provider) throw new Error('不支持的服务商。');
  return provider;
}

function plainText(value, name, max = 160) {
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${name}格式不正确。`);
  return value.trim();
}

function validateProfile(id, saved) {
  const definition = providerDefinition(id);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('invalid profile');
  if (saved.model !== undefined && (!plainText(saved.model, '模型') || !/^[a-zA-Z0-9._/-]+$/.test(saved.model))) throw new Error('invalid model');
  if (saved.voice !== undefined) {
    plainText(saved.voice, '音色');
    if (definition.voices.length && !definition.voices.includes(saved.voice)) throw new Error('invalid voice');
  }
  if (id === 'qwen') {
    if (saved.workspaceId !== undefined && (plainText(saved.workspaceId, '工作空间 ID', 100) !== saved.workspaceId || (saved.workspaceId && !/^[a-zA-Z0-9-]+$/.test(saved.workspaceId)))) throw new Error('invalid workspace');
    if (saved.region !== undefined && !['beijing', 'singapore'].includes(saved.region)) throw new Error('invalid region');
  }
  if (saved.secrets !== undefined) {
    if (!saved.secrets || typeof saved.secrets !== 'object' || Array.isArray(saved.secrets)) throw new Error('invalid secrets');
    for (const [name, value] of Object.entries(saved.secrets)) {
      if (!definition.fields.some(field => field.id === name) || typeof value !== 'string' || value.length > 12288 || Buffer.from(value, 'base64').toString('base64') !== value) throw new Error('invalid encrypted secret');
    }
  }
}

/** Secrets only leave this class through getPrivate(), used by the main process. */
export class AISettingsStore {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.data = { version: 1, selectedProvider: 'qwen', translationProvider: 'qwen', providers: {} };
    this.error = '';
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed.version !== 1 || !parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) throw new Error('invalid settings');
      providerDefinition(parsed.selectedProvider);
      if (!['qwen', 'deepseek'].includes(parsed.translationProvider)) throw new Error('invalid translator');
      for (const [id, saved] of Object.entries(parsed.providers)) validateProfile(id, saved);
      parsed.conversation = normalizeConversationPreferences(parsed.conversation);
      this.data = parsed;
      if (this.data.providers.deepseek?.model === 'deepseek-chat') this.data.providers.deepseek.model = 'deepseek-flash';
      // Upgrade the former default in existing vaults; retain custom models,
      // voices and encrypted credentials, including the separate translator.
      if (['gemini-3.1-flash-live-preview', 'models/gemini-3.1-flash-live-preview'].includes(this.data.providers.google?.model)) {
        this.data.providers.google.model = DEFAULT_GOOGLE_REALTIME_MODEL;
      }
      this.shareSavedKeys(this.data);
    } catch {
      // Do not overwrite an unreadable vault with a new empty configuration.
      this.error = 'AI 设置文件无法读取，请备份后恢复文件。';
    }
  }

  /** Older vaults stored shared keys per feature; fill only the missing copies. */
  shareSavedKeys(data) {
    for (const definition of AI_PROVIDERS) {
      for (const field of definition.fields) {
        const value = data.providers[definition.id]?.secrets?.[field.id];
        if (!value) continue;
        for (const [providerId, fieldId] of linkedCredentialFields(definition.id, field.id)) {
          const saved = data.providers[providerId] ||= { secrets: {} };
          saved.secrets ||= {};
          saved.secrets[fieldId] ||= value;
        }
      }
    }
  }

  writeSecret(data, providerId, fieldId, encrypted) {
    for (const [linkedProvider, linkedField] of linkedCredentialFields(providerId, fieldId)) {
      const saved = data.providers[linkedProvider] ||= { secrets: {} };
      saved.secrets ||= {};
      if (encrypted) saved.secrets[linkedField] = encrypted;
      else delete saved.secrets[linkedField];
    }
  }

  ensureEncryption() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，无法保存密钥。');
    if (this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统安全存储不可用，无法保存密钥。');
  }

  decrypt(value) {
    if (!value) return '';
    this.ensureEncryption();
    try { return this.safeStorage.decryptString(Buffer.from(value, 'base64')); }
    catch { throw new Error('保存的密钥无法解密，请在 AI 设置中删除并重新填写。'); }
  }

  getPrivate(id) {
    if (this.error) throw new Error(this.error);
    const definition = providerDefinition(id);
    const saved = this.data.providers[id] || {};
    const result = { model: saved.model || definition.model, voice: saved.voice ?? definition.voice };
    if (id === 'qwen') { result.workspaceId = saved.workspaceId || ''; result.region = saved.region || 'beijing'; }
    for (const field of definition.fields) result[field.id] = this.decrypt(saved.secrets?.[field.id]);
    return result;
  }

  publicSettings() {
    return {
      selectedProvider: this.data.selectedProvider,
      translationProvider: this.data.translationProvider,
      conversation: normalizeConversationPreferences(this.data.conversation),
      encryptionAvailable: Boolean(this.safeStorage?.isEncryptionAvailable()) && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text',
      error: this.error,
      providers: AI_PROVIDERS.map(definition => {
        const saved = this.data.providers[definition.id] || {};
        let credentialError = '';
        if (!this.error) {
          try { this.getPrivate(definition.id); }
          catch (error) { credentialError = error.message; }
        }
        return { ...definition, model: saved.model || definition.model, voice: saved.voice ?? definition.voice,
          credentialError,
          workspaceId: saved.workspaceId || '', region: saved.region || 'beijing',
          fields: definition.fields.map(field => ({ ...field, account: credentialAccount(definition.id, field.id),
            configured: Boolean(saved.secrets?.[field.id]) })) };
      }),
    };
  }

  commit(next) {
    if (this.error) throw new Error(this.error);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    this.data = next;
    return this.publicSettings();
  }

  save(payload) {
    const definition = providerDefinition(payload?.provider);
    if (payload.purpose !== undefined && !['voice', 'translate'].includes(payload.purpose)) throw new Error('请选择有效的使用功能。');
    if (payload.purpose === 'translate' && !['qwen', 'deepseek'].includes(definition.id)) throw new Error('文字翻译请选择千问或 DeepSeek。');
    const next = structuredClone(this.data);
    // Translation saves never change voice-chat personalization.
    if (payload.purpose !== 'translate' && payload.conversation !== undefined) {
      next.conversation = normalizeConversationPreferences(payload.conversation);
    }
    const saved = next.providers[definition.id] || { secrets: {} };
    saved.secrets ||= {};
    if (definition.id === 'qwen') {
      if (payload.workspaceId !== undefined) {
        saved.workspaceId = plainText(payload.workspaceId, '工作空间 ID', 100);
        if (saved.workspaceId && !/^[a-zA-Z0-9-]+$/.test(saved.workspaceId)) throw new Error('工作空间 ID 格式不正确。');
      }
      if (payload.region !== undefined) {
        if (!['beijing', 'singapore'].includes(payload.region)) throw new Error('请选择支持的地区。');
        saved.region = payload.region;
      }
    }
    const sharedTranslation = payload.purpose === 'translate' && definition.id === 'qwen';
    if (payload.model !== undefined && !sharedTranslation) {
      saved.model = plainText(payload.model, '模型');
      if (!saved.model || !/^[a-zA-Z0-9._/-]+$/.test(saved.model)) throw new Error('请填写有效的模型名称。');
    }
    if (payload.voice !== undefined && !sharedTranslation) {
      saved.voice = plainText(payload.voice, '音色');
      if (definition.voices.length && !definition.voices.includes(saved.voice)) throw new Error('请选择支持的音色。');
    }
    for (const field of definition.fields) {
      const value = payload.secrets?.[field.id];
      // An empty UI field preserves the existing key. Deletion is explicit.
      if (value !== undefined && value !== '') {
        const secret = plainText(value, '密钥', 4096);
        if (!secret) continue;
        this.ensureEncryption();
        next.providers[definition.id] = saved;
        this.writeSecret(next, definition.id, field.id, this.safeStorage.encryptString(secret).toString('base64'));
      }
    }
    next.providers[definition.id] = saved;
    // Translation has its own selection; saving it must not replace voice setup.
    if (payload.purpose !== 'translate') next.selectedProvider = definition.id;
    if (payload.translationProvider !== undefined) {
      if (!['qwen', 'deepseek'].includes(payload.translationProvider)) throw new Error('不支持的文字翻译服务商。');
      next.translationProvider = payload.translationProvider;
    } else {
      // Translation follows whichever translation account already has a key.
      const hasKey = id => Boolean(next.providers[id]?.secrets?.apiKey);
      if (!hasKey(next.translationProvider)) next.translationProvider = ['qwen', 'deepseek'].find(hasKey) || next.translationProvider;
    }
    return this.commit(next);
  }

  /** Removes a key everywhere it is shared; without a field, all of the provider's keys. */
  deleteSecrets(id, fieldId) {
    const definition = providerDefinition(id);
    if (fieldId !== undefined && !definition.fields.some(field => field.id === fieldId)) throw new Error('不支持的密钥。');
    const next = structuredClone(this.data);
    for (const field of definition.fields) {
      if (fieldId === undefined || field.id === fieldId) this.writeSecret(next, id, field.id, '');
    }
    return this.commit(next);
  }

  /** Explicit import only: never scans Echo or automatically reads .env. */
  importConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('导入文件格式不正确。');
    const keys = config.api_keys || config;
    const mapping = { qwen: keys.dashscope_api_key, doubao: keys.doubao_api_key || keys.doubao_access_token,
      google: keys.google_api_key, 'google-translate': keys.google_api_key, deepseek: keys.deepseek_api_key, cartesia: keys.cartesia_api_key };
    const next = structuredClone(this.data);
    let count = 0;
    for (const [id, raw] of Object.entries(mapping)) {
      if (!raw) continue;
      const secret = plainText(raw, '导入密钥', 4096);
      this.ensureEncryption();
      const saved = next.providers[id] || { secrets: {} };
      saved.secrets ||= {};
      next.providers[id] = saved;
      this.writeSecret(next, id, 'apiKey', this.safeStorage.encryptString(secret).toString('base64'));
      if (id === 'qwen') {
        const endpoint = config.realtime_api_urls?.DashScope || '';
        const match = /^wss:\/\/([a-zA-Z0-9-]+)\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com(?:\/|$)/.exec(endpoint);
        if (match) { saved.workspaceId = match[1]; saved.region = match[2] === 'cn-beijing' ? 'beijing' : 'singapore'; }
      }
      count++;
    }
    if (!count) throw new Error('文件中没有可导入的服务商密钥。');
    return { settings: this.commit(next), count };
  }
}

import { credentialAccount, providerDefinition } from './aiSettingsStore.js';

/**
 * Trust only the top-level frame of the exact local settings document.
 * `target` is a window, or the web contents of one settings page.
 */
export function isTrustedSettingsSender(event, target, expectedURL) {
  // Check first: a destroyed window throws when its properties are read.
  if (!target || target.isDestroyed?.()) return false;
  const contents = target.webContents || target;
  return Boolean(contents
    && event.sender === contents
    && event.senderFrame === contents.mainFrame
    && event.senderFrame?.url === expectedURL);
}

/** Provider identifiers only; never accept a renderer-supplied external URL. */
export function aiKeyPage(provider) {
  const pages = new Map([
    ['qwen', 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key'],
    ['doubao', 'https://console.volcengine.com/speech/new/setting/apikeys'],
    ['google', 'https://aistudio.google.com/apikey'],
    ['google-translate', 'https://aistudio.google.com/apikey'],
    ['cartesia', 'https://play.cartesia.ai/keys'],
    ['deepseek', 'https://platform.deepseek.com/api_keys'],
  ]);
  if (!pages.has(provider)) throw new Error('请选择支持的服务商。');
  return pages.get(provider);
}

/** A translation-only change need not end an unrelated live voice session. */
export function settingsAffectVoice(store, payload, currentProvider) {
  if (payload?.purpose !== 'translate') return true;
  if (!currentProvider) return false;
  const voice = providerDefinition(currentProvider);
  const profile = store.getPrivate(currentProvider);
  // Keys are shared per account, so a translation key can be the live voice key.
  const keyChanged = Object.entries(payload.secrets || {}).some(([fieldId, value]) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const account = credentialAccount(payload.provider, fieldId);
    return voice.fields.some(field => credentialAccount(currentProvider, field.id) === account && value.trim() !== profile[field.id]);
  });
  return keyChanged || (payload.provider === currentProvider
    && ['region', 'workspaceId'].some(key => payload[key] !== undefined && payload[key] !== profile[key]));
}

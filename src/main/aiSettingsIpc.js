/** Trust only the top-level frame of the exact local settings document. */
export function isTrustedSettingsSender(event, window, expectedURL) {
  return Boolean(window && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
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
  if (!currentProvider || payload.provider !== currentProvider) return false;
  const profile = store.getPrivate(currentProvider);
  return Object.entries(payload.secrets || {}).some(([key, value]) => typeof value === 'string' && value.trim() && value.trim() !== profile[key])
    || ['region', 'workspaceId'].some(key => payload[key] !== undefined && payload[key] !== profile[key]);
}

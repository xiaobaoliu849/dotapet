import { configureCloudKeys, CloudVoiceEngine } from '../services/cloudVoiceEngine.js';
import { checkVoiceConnection, connectionError } from '../services/connectionCheck.js';
import { providerDefinition } from './aiSettingsStore.js';

function qwenTextBaseUrl(profile) {
  if (profile.workspaceId) return `https://${profile.workspaceId}.${profile.region === 'singapore' ? 'ap-southeast-1' : 'cn-beijing'}.maas.aliyuncs.com/compatible-mode/v1`;
  return `https://${profile.region === 'singapore' ? 'dashscope-intl' : 'dashscope'}.aliyuncs.com/compatible-mode/v1`;
}

export function applyAIConfiguration(store) {
  configureCloudKeys();
  if (store.error) throw new Error(store.error);
  // An unreadable credential disables only its own profile. Never keep an old
  // runtime key or let an unrelated damaged profile block a healthy provider.
  const profile = id => {
    try { return store.getPrivate(id); }
    catch { return {}; }
  };
  const qwen = profile('qwen');
  const deepseek = profile('deepseek');
  const cartesia = profile('cartesia');
  const doubao = profile('doubao');
  const region = qwen.region === 'singapore' ? 'ap-southeast-1' : 'cn-beijing';
  const wsHost = qwen.workspaceId ? `${qwen.workspaceId}.${region}.maas.aliyuncs.com`
    : qwen.region === 'singapore' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com';
  // Replace every key, including empty values: deletion must clear memory too.
  configureCloudKeys({ dashscope: qwen.apiKey, deepseek: deepseek.apiKey, cartesia: cartesia.apiKey,
    cartesia_llm_key: cartesia.llmApiKey, cartesia_voice_id: cartesia.voice, cartesia_model: cartesia.model,
    doubao_api_key: doubao.apiKey,
    doubao_websearch_key: doubao.websearchKey,
    dashscope_ws_url: `wss://${wsHost}/api-ws/v1/realtime`,
    dashscope_base_url: qwenTextBaseUrl(qwen),
    translation_model: 'qwen-flash',
    deepseek_model: deepseek.model, translation_provider: store.data.translationProvider,
  });
}

export function engineOptions(store, provider) {
  const profile = store.getPrivate(provider);
  return { provider, apiKey: profile.apiKey, model: profile.model, voice: profile.voice,
    doubaoVoice: profile.voice, googleVoice: profile.voice,
    googleModel: provider === 'google' ? profile.model : undefined,
    googleTranslateModel: provider === 'google-translate' ? profile.model : undefined,
    autoReconnect: false, autoVoice: false };
}

export async function checkTextConnection(profile, { signal, apiUrl = 'https://api.deepseek.com/v1/chat/completions', fetchImpl = fetch } = {}) {
  if (!profile.apiKey) return { ok: false, message: '翻译服务密钥未配置，请先保存密钥。' };
  try {
    const timeout = AbortSignal.timeout(15000);
    const response = await fetchImpl(apiUrl, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify({ model: profile.model || 'deepseek-flash', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 16,
        ...(/^deepseek/.test(profile.model || 'deepseek-flash') ? { thinking: { type: 'disabled' } } : {}) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, message: connectionError(`${response.status} ${body}`) };
    }
    const body = await response.json();
    if (!Array.isArray(body.choices) || !body.choices.length) return { ok: false, message: '服务商响应不完整，请重试。' };
    return { ok: true, message: '文字模型鉴权与调用成功。' };
  } catch (error) {
    return { ok: false, message: signal?.aborted ? '测试已取消，请重新测试。' : connectionError(error.name) };
  }
}

export async function testAIConnection(store, provider, { signal, textOnly = false, engineFactory = options => new CloudVoiceEngine(options) } = {}) {
  const definition = providerDefinition(provider);
  const profile = store.getPrivate(provider);
  if (definition.fields.some(field => !field.optional && !profile[field.id])) return { ok: false, message: '缺少所选服务商的密钥，请先填写并保存。' };
  if (textOnly && provider === 'qwen') {
    return checkTextConnection({ ...profile, model: 'qwen-flash' }, { signal, apiUrl: `${qwenTextBaseUrl(profile)}/chat/completions` });
  }
  if (textOnly && provider !== 'deepseek') return { ok: false, message: '文字翻译请选择千问或 DeepSeek。' };
  if (definition.textOnly) return checkTextConnection(profile, { signal });
  if (provider === 'cartesia') {
    const llm = await checkTextConnection({ apiKey: profile.llmApiKey, model: 'deepseek-flash' }, { signal });
    if (!llm.ok) return llm;
  }
  return checkVoiceConnection(engineFactory(engineOptions(store, provider)), { signal });
}

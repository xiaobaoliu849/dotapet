const api = window.electronAPI;
const byId = id => document.getElementById(id);
let settings;
let busy = false;
let generation = 0;
let testCancelled = false;
let lastStatus = { status: 'disconnected' };
let dirty = false;
const selectionByPurpose = {};
// Drafts stay only in this window and are shared by purpose for the same provider.
const drafts = new Map();
let renderedProvider = '';
const providerNames = { qwen: '阿里千问', doubao: '豆包', google: 'Gemini', cartesia: 'Cartesia', deepseek: 'DeepSeek' };
const providerDescriptions = { qwen: ['千', '聊天，也能翻译'], doubao: ['豆', '实时语音聊天'], google: ['✦', '聊天 / 语音翻译'], cartesia: ['C', '英语对练'], deepseek: ['D', '文字 / 截图翻译'] };
const simpleVoices = { qwen: ['Tina', 'Raymond', 'Jennifer'], doubao: ['zh_female_xiaohe_jupiter_bigtts', 'zh_female_vv_jupiter_bigtts', 'zh_male_yunzhou_jupiter_bigtts'], google: ['Puck', 'Kore', 'Aoede'] };
const translating = () => byId('usage')?.value === 'translate';
const voiceNames = { Tina: 'Tina · 温和女声', Jennifer: 'Jennifer · 英语女声', Puck: 'Puck · 活泼男声', Kore: 'Kore · 干练女声', Aoede: 'Aoede · 轻快女声', zh_female_xiaohe_jupiter_bigtts: '小何 · 甜美台腔', zh_female_vv_jupiter_bigtts: 'VV · 活泼女声', zh_male_yunzhou_jupiter_bigtts: '云舟 · 沉稳男声', zh_male_xiaotian_jupiter_bigtts: '小天 · 清爽男声', en_male_tim_uranus_bigtts: 'Tim · 美式英语', en_female_dacey_uranus_bigtts: 'Dacey · 美式英语', en_female_stokie_uranus_bigtts: 'Stokie · 美式英语' };

function feedback(message, kind = '') { byId('feedback').textContent = message; byId('feedback').dataset.kind = kind; }
function profile() {
  const id = byId('provider').value === 'google' ? byId('google-mode').value || 'google' : byId('provider').value;
  return settings?.providers.find(item => item.id === id);
}
function connectionState() {
  return !lastStatus.providerId || lastStatus.providerId === profile()?.id ? lastStatus.status : 'disconnected';
}
function updateConnectAction() {
  const state = connectionState();
  const connected = state === 'connected' && !dirty;
  const button = byId('connect');
  button.disabled = busy || translating() || Boolean(profile()?.textOnly) || state === 'connecting';
  button.className = state === 'connecting' ? 'primary is-connecting' : connected ? 'secondary' : 'primary';
  button.setAttribute('aria-busy', String(state === 'connecting'));
  button.textContent = state === 'connecting' ? '正在连接…' : connected ? '重新连接' : state === 'error' ? '重试连接 →' : profile()?.id === 'google-translate' ? '保存并开始语音翻译 →' : '保存并开始聊天 →';
}
function markDirty() {
  dirty = true; byId('finish').hidden = true; updateConnectAction();
  if (!translating() && connectionState() === 'connected') feedback('设置有更改，保存后重新连接即可生效。');
}
function focusCredential() {
  const field = profile().fields.find(item => !item.optional && !item.configured);
  if (field) byId(`secret-${field.id}`).focus?.();
}
function rememberDraft() {
  if (!renderedProvider) return;
  const item = settings.providers.find(item => item.id === renderedProvider);
  drafts.set(renderedProvider, { dirty, values: Object.fromEntries([
    ...item.fields.map(field => `secret-${field.id}`), 'model', 'voice', 'voice-custom', 'workspace', 'region',
  ].map(id => [id, byId(id).value])) });
}
function status(event) {
  if (event) lastStatus = event;
  if (translating()) { byId('connection-status').dataset.state = ''; byId('connection-status').textContent = '翻译无需开启麦克风。'; return; }
  const selected = !event?.providerId || event.providerId === profile()?.id;
  const state = selected ? event?.status || 'disconnected' : 'disconnected';
  const names = { disconnected: '连接后按 Alt+Q 说话，麦克风由你开启。', connecting: '正在连接，请稍等…', connected: '已连接！按 Alt+Q，就能和小伙伴说话。', error: '连接失败，请检查密钥后重试。' };
  byId('connection-status').dataset.state = state;
  byId('connection-status').textContent = `${names[state] || names.disconnected}${state === 'error' && event.error ? ` ${event.error}` : ''}`;
  byId('finish').hidden = state !== 'connected' || dirty;
  updateConnectAction();
  if (state === 'connected' && !dirty) feedback('', 'success');
  else if (state === 'error') feedback('检查密钥与网络后，点击「重试连接」。', 'error');
}
function setBusy(value, testing = false) {
  if (value) window.stopMicrophoneCheck?.();
  busy = value;
  for (const control of document.querySelectorAll('button, input, select')) control.disabled = value;
  byId('cancel').hidden = !testing;
  byId('cancel').disabled = false;
  if (!value && settings) {
    updateConnectAction();
    byId('delete').disabled = !profile()?.fields.some(field => field.configured);
  }
}
function renderProfile() {
  const item = profile();
  if (!item) return;
  dirty = false;
  byId('finish').hidden = true;
  for (const button of byId('provider-options').children) button.setAttribute('aria-pressed', String(button.dataset.provider === byId('provider').value));
  for (const purpose of ['voice', 'translate']) byId(`usage-${purpose}`).setAttribute('aria-pressed', String(byId('usage').value === purpose));
  byId('welcome-title').textContent = translating() ? '看懂聊天，轻松开黑' : '让小伙伴听见你';
  byId('welcome-description').textContent = '选一家服务商，粘贴密钥，就可以开始了。';
  byId('provider-caption').textContent = translating() ? '支持文字与截图翻译' : '用你已有的账户就好';
  byId('shared-credentials').textContent = item.id === 'qwen'
    ? '千问的 API 密钥和地区在语音与翻译间共用，只需保存一次；两种功能使用不同模型。'
    : '语音与文字 / 截图翻译可分别选择服务商；切换功能会保留未保存的输入。';
  const container = byId('secret-fields');
  container.className = item.id === 'cartesia' ? 'secret-fields two-keys' : 'secret-fields';
  container.replaceChildren();
  const optionalContainer = byId('optional-secret-fields');
  optionalContainer.replaceChildren();
  for (const field of item.fields) {
    const label = document.createElement('label');
    label.htmlFor = `secret-${field.id}`;
    const fieldName = field.id === 'apiKey' ? (item.id === 'cartesia' ? 'Cartesia 密钥' : 'API 密钥') : field.id === 'llmApiKey' ? 'DeepSeek 密钥' : field.label;
    label.textContent = `${fieldName}${field.configured ? ' · 已保存' : ''}`;
    if (field.configured) label.className = 'configured';
    const input = document.createElement('input');
    input.id = label.htmlFor; input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 4096;
    input.disabled = busy;
    input.addEventListener('input', markDirty);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !busy && !event.isComposing) {
        event.preventDefault(); (translating() ? byId('test') : byId('connect')).click();
      }
    });
    input.placeholder = field.configured ? '已保存，留空保留；也可粘贴新密钥' : '在这里粘贴 API Key';
    const heading = document.createElement('div'); heading.className = 'field-label'; heading.append(label);
    if (!field.optional) {
      const getKey = document.createElement('button'); getKey.className = 'key-link'; getKey.textContent = '获取密钥 ↗';
      getKey.setAttribute('aria-label', `获取 ${field.label}`); getKey.disabled = busy;
      getKey.addEventListener('click', () => action(async () => {
        const response = await api.openAIKeyPage(field.id === 'llmApiKey' ? 'deepseek' : item.id);
        if (!response.ok) throw new Error(response.error);
      }));
      heading.append(getKey);
    }
    const wrapper = document.createElement('div'); wrapper.className = 'secret-field'; wrapper.append(heading, input);
    (field.optional ? optionalContainer : container).append(wrapper);
  }
  byId('provider-help').textContent = item.id === 'cartesia' ? '需要 Cartesia 和 DeepSeek 两个密钥；声音已选好。'
    : item.textOnly ? '使用你的 DeepSeek 密钥，翻译文字和聊天截图。'
    : item.id === 'qwen' ? (translating() ? '使用阿里百炼的 API Key，可翻译文字和聊天截图。' : '使用阿里百炼的 API Key，模型和声音已替你选好。')
    : item.id === 'doubao' ? '使用火山引擎的实时语音 API Key，默认声音是小何。'
    : item.id === 'google-translate' ? '实时语音翻译模式；使用此模式单独保存的 Google 密钥。'
    : '使用 Google API Key；需具备对应的账户与网络条件。';
  byId('model').value = item.model;
  byId('workspace-fields').hidden = item.id !== 'qwen';
  byId('workspace').value = item.workspaceId || '';
  byId('region').value = item.region || 'beijing';
  byId('google-mode-fields').hidden = translating() || byId('provider').value !== 'google';
  byId('voice-fields').hidden = translating() || !item.voice;
  if (byId('model-fields')) byId('model-fields').hidden = translating() && item.id !== 'deepseek';
  byId('model-label').textContent = translating() ? '文字翻译模型' : '语音模型';
  if (byId('translator-fields')) byId('translator-fields').hidden = translating();
  const choices = item.voices.length ? [...new Set([...(simpleVoices[item.id] || item.voices.slice(0, 3)), item.voice])].filter(voice => item.voices.includes(voice)) : [item.voice];
  byId('voice').replaceChildren(...choices.map(voice => new Option(voiceNames[voice] || (item.id === 'cartesia' ? '当前音色' : voice) + (voice === item.voices[0] ? ' · 默认' : ''), voice)));
  byId('voice').value = item.voice;
  byId('voice-custom').value = item.voice;
  byId('all-voice-fields').hidden = translating() || !item.voices.length;
  byId('all-voices').replaceChildren(...item.voices.map(voice => new Option(voiceNames[voice] || voice, voice)));
  byId('all-voices').value = item.voice;
  byId('custom-voice-fields').hidden = translating() || !item.voice || Boolean(item.voices.length);
  byId('custom-voice-id').value = item.voice;
  byId('translator-summary').textContent = `文字 / 截图翻译：${providerNames[settings.translationProvider]}。${settings.translationProvider === 'qwen' ? '与千问语音共用密钥。' : '使用独立的 DeepSeek 密钥。'}`;
  byId('connect').hidden = translating();
  byId('disconnect').hidden = translating();
  byId('connect').disabled = busy || translating() || Boolean(item.textOnly);
  byId('test').hidden = !translating();
  byId('voice-test').hidden = translating();
  if (byId('microphone')) byId('microphone').hidden = translating();
  const note = document.querySelector?.('.connection-note');
  if (note) note.textContent = translating()
    ? '复制文字 → Alt+T；Win+Shift+S 框选聊天 → Alt+T 翻译截图。截图会发给所选服务商。'
    : '云端服务按服务商规则计费；麦克风由你主动开启。';
  updateConnectAction();
  byId('delete').disabled = busy || !item.fields.some(field => field.configured);
  selectionByPurpose[byId('usage').value] = item.id;
  renderedProvider = item.id;
  const draft = drafts.get(item.id);
  if (draft) {
    for (const [id, value] of Object.entries(draft.values)) byId(id).value = value;
    byId('custom-voice-id').value = byId('voice-custom').value;
    byId('all-voices').value = byId('voice').value;
    if (draft.dirty || item.fields.some(field => draft.values[`secret-${field.id}`])) markDirty();
  }
}
function render(next, selected) {
  const initial = !settings;
  settings = next;
  const selection = selected || settings.selectedProvider;
  if (initial && byId('usage')) {
    byId('usage').value = settings.providers.find(item => item.id === selection)?.textOnly ? 'translate' : 'voice';
  }
  const providers = (translating() ? ['qwen', 'deepseek'] : ['qwen', 'doubao', 'google', 'cartesia']).map(id => settings.providers.find(item => item.id === id)).filter(Boolean);
  const visibleSelection = selection === 'google-translate' ? 'google' : selection;
  byId('provider').replaceChildren(...providers.map(item => new Option(providerNames[item.id] || item.label, item.id)));
  byId('provider').value = providers.some(item => item.id === visibleSelection) ? visibleSelection : 'qwen';
  byId('google-mode').value = selection === 'google-translate' ? 'google-translate' : 'google';
  byId('provider-options').replaceChildren(...providers.map(item => {
    const button = document.createElement('button'); button.className = 'provider-option'; button.dataset.provider = item.id;
    const name = document.createElement('span'); name.className = 'provider-name';
    const mark = document.createElement('span'); mark.className = 'provider-mark'; mark.textContent = providerDescriptions[item.id][0]; mark.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.textContent = providerNames[item.id]; name.append(mark, title);
    const description = document.createElement('span'); description.className = 'provider-description'; description.textContent = translating() && item.id === 'qwen' ? '文字 / 截图翻译' : providerDescriptions[item.id][1];
    button.append(name, description);
    button.addEventListener('click', () => { if (busy || byId('provider').value === item.id) return; byId('provider').value = item.id; changeProvider(); });
    button.disabled = busy; return button;
  }));
  byId('provider-options').dataset.purpose = byId('usage').value;
  renderProfile();
}
function payload() {
  const item = profile();
  return { provider: item.id, purpose: translating() ? 'translate' : 'voice',
    ...(!translating() ? { model: byId('model').value, voice: item.voices.length ? byId('voice').value : byId('voice-custom').value }
      : item.id === 'deepseek' ? { model: byId('model').value } : {}),
    workspaceId: byId('workspace').value, region: byId('region').value,
    translationProvider: translating() ? item.id : settings.translationProvider,
    secrets: Object.fromEntries(item.fields.map(field => [field.id, byId(`secret-${field.id}`).value])) };
}
function clearInputs() { for (const input of document.querySelectorAll('input[type=password]')) input.value = ''; }
async function save() {
  rememberDraft();
  const data = payload();
  const response = await api.saveAISettings(data);
  if (!response.ok) throw new Error(response.error);
  clearInputs();
  // Keep unfinished voice choices when saving the shared Qwen key for translation.
  const draft = drafts.get(data.provider);
  if (translating() && data.provider === 'qwen' && draft) {
    for (const field of profile().fields) draft.values[`secret-${field.id}`] = '';
    const savedProfile = response.settings.providers.find(item => item.id === data.provider);
    draft.dirty = draft.values.model !== savedProfile.model || draft.values.voice !== savedProfile.voice;
  } else drafts.delete(data.provider);
  render(response.settings, data.provider);
  if (profile().credentialError) throw new Error(profile().credentialError);
  return data.provider;
}
async function action(task, testing = false) {
  if (busy) return;
  const current = ++generation;
  setBusy(true, testing);
  if (testing) testCancelled = false;
  try { await task(); }
  catch (error) { if (current === generation) feedback(error.message || '操作失败，请重试。', 'error'); }
  finally { if (current === generation) setBusy(false); }
}
function changeProvider() {
  rememberDraft(); window.stopMicrophoneCheck?.(); clearInputs();
  byId('google-mode').value = 'google';
  renderProfile(); status(lastStatus);
  feedback(profile().credentialError || '', profile().credentialError ? 'error' : '');
  focusCredential();
}
byId('provider').addEventListener('change', changeProvider);
function choosePurpose(purpose) {
  if (!settings || busy || !['voice', 'translate'].includes(purpose) || byId('usage').value === purpose) return;
  rememberDraft(); window.stopMicrophoneCheck?.(); clearInputs(); byId('usage').value = purpose;
  render(settings, selectionByPurpose[purpose] || (translating() ? settings.translationProvider : settings.selectedProvider));
  status(lastStatus);
}
api.onSettingsPurpose?.(choosePurpose);
for (const purpose of ['voice', 'translate']) byId(`usage-${purpose}`).addEventListener('click', () => {
  if (byId('usage').value === purpose) return;
  choosePurpose(purpose); feedback('');
});
byId('usage').addEventListener('change', () => {
  rememberDraft(); window.stopMicrophoneCheck?.(); clearInputs(); render(settings, translating() ? settings.translationProvider : settings.selectedProvider);
  status(lastStatus); feedback('');
});
byId('google-mode').addEventListener('change', () => {
  rememberDraft(); window.stopMicrophoneCheck?.(); clearInputs(); renderProfile(); status(lastStatus);
  feedback('已切换 Gemini 功能，请使用对应密钥。');
});
byId('voice').addEventListener('change', () => { byId('all-voices').value = byId('voice').value; markDirty(); });
byId('all-voices').addEventListener('change', () => {
  const voice = byId('all-voices').value;
  if (![...byId('voice').options].some(option => option.value === voice)) byId('voice').append(new Option(voiceNames[voice] || voice, voice));
  byId('voice').value = voice;
  markDirty();
});
byId('custom-voice-id').addEventListener('input', () => { byId('voice-custom').value = byId('custom-voice-id').value; markDirty(); });
for (const id of ['model', 'workspace']) byId(id).addEventListener('input', markDirty);
byId('region').addEventListener('change', markDirty);
byId('translator-config').addEventListener('click', () => choosePurpose('translate'));
function requireCredentials() {
  const missing = profile().fields.find(field => !field.optional && !field.configured && !byId(`secret-${field.id}`).value.trim());
  if (missing) throw new Error(`请先填写 ${missing.label}。`);
}
byId('save').addEventListener('click', () => action(async () => { await save(); feedback('设置已加密保存。', 'success'); }));
function testConnection() { return action(async () => {
  requireCredentials();
  const provider = await save(); feedback(translating() ? '正在测试文字模型，麦克风保持关闭…' : '正在测试语音连接，麦克风保持关闭…');
  if (testCancelled) { feedback('测试已取消，请重新测试。'); return; }
  const response = await (translating() ? api.testTextConnection(provider) : api.testAIConnection(provider));
  if (!response.ok) throw new Error(response.error);
  if (testCancelled) { feedback('测试已取消，请重新测试。'); return; }
  feedback(response.result.ok ? (translating() ? '翻译已就绪！复制文字后按 Alt+T。截图还需相应视觉模型权限。' : '测试通过，可以开始聊天了。') : response.result.message, response.result.ok ? 'success' : 'error');
  byId('finish').hidden = !response.result.ok || !translating();
}, true); }
byId('test').addEventListener('click', testConnection);
byId('voice-test').addEventListener('click', testConnection);
byId('connect').addEventListener('click', () => action(async () => {
  requireCredentials();
  const provider = await save(); const response = await api.connectAI(provider);
  if (!response.ok) throw new Error(response.error);
  status(response.status);
  feedback(response.status?.status === 'error' ? response.status.error : response.status?.status === 'connected' ? '' : '密钥已保存，正在连接…', response.status?.status === 'error' ? 'error' : response.status?.status === 'connected' ? 'success' : '');
}));
for (const id of ['finish', 'skip']) byId(id).addEventListener('click', () => action(async () => {
  window.stopMicrophoneCheck?.(); const response = await api.finishAISetup();
  if (!response.ok) throw new Error(response.error);
}));
byId('disconnect').addEventListener('click', () => action(async () => { const response = await api.disconnectAI(); if (!response.ok) throw new Error(response.error); status(response.status); feedback('已断开语音连接。'); }));
byId('cancel').addEventListener('click', () => {
  testCancelled = true;
  api.cancelAITest().catch(() => feedback('取消失败，请关闭设置窗口停止测试。', 'error'));
});
byId('delete').addEventListener('click', () => action(async () => {
  const id = profile().id; clearInputs();
  const response = await api.deleteAISecrets(id);
  if (!response.ok) throw new Error(response.error);
  drafts.delete(id);
  render(response.settings, id); feedback('此服务商的密钥已删除，当前语音已断开。', 'success');
}));
byId('import').addEventListener('click', () => action(async () => {
  clearInputs(); const response = await api.importAIConfig();
  if (!response.ok) throw new Error(response.error);
  if (response.cancelled) return;
  drafts.clear();
  render(response.settings); feedback(`已导入 ${response.count} 个配置并加密保存。请检查模型及音色后测试。`, 'success');
}));
api.onVoiceStatus(status);
setBusy(true);
api.getAISettings().then(response => {
  if (!response.ok) throw new Error(response.error);
  if (byId('settings-version')) byId('settings-version').textContent = response.version ? `· v${response.version}` : '';
  if (['aurora_wolf', 'donkey_courier', 'treant_sapling', 'mischievous_greevil', 'baby_roshan'].includes(response.companionPet)) {
    byId('welcome-pet').src = `assets/pets/${response.companionPet}/idle.svg`;
  }
  render(response.settings); status(response.status); setBusy(false);
  if (response.purpose) choosePurpose(response.purpose);
  focusCredential();
  if (settings.error) feedback(settings.error, 'error');
  else if (profile().credentialError) feedback(profile().credentialError, 'error');
  else if (!settings.encryptionAvailable) feedback('系统安全存储不可用，无法保存密钥。', 'error');
  else if (lastStatus.status !== 'connected') feedback('');
}).catch(error => feedback(error.message || '设置加载失败，请重新打开。', 'error'));

const api = window.electronAPI;
const byId = id => document.getElementById(id);
let settings;
let busy = false;
let generation = 0;
let testCancelled = false;
let lastStatus = { status: 'disconnected' };
let dirty = false;
let translator = 'qwen';
// The user picked a translator that still needs a key; keep it until saved.
let translatorPending = false;
let changingTranslateKey = false;
// Unsaved keys stay only in this window, one per account: a key shared by
// voice and translation is typed once and shows up everywhere it is used.
const keyDrafts = new Map();
// Unsaved model / voice choices, per voice provider.
const drafts = new Map();
let renderedProvider = '';
const voiceProviders = ['qwen', 'doubao', 'google', 'cartesia'];
const providerNames = { qwen: '阿里千问', doubao: '豆包', google: 'Gemini', cartesia: 'Cartesia', deepseek: 'DeepSeek' };
const providerDescriptions = { qwen: ['千', '语音 + 翻译 · 推荐'], doubao: ['豆', '自然的中文对话'], google: ['✦', '多语言 · 语音翻译'], cartesia: ['C', '英语口语对练'], deepseek: ['D', '文字 / 截图翻译'] };
const keyNames = { 'qwen.apiKey': '阿里百炼 API Key', 'doubao.apiKey': '火山引擎 API Key', 'doubao.websearchKey': '豆包联网搜索 Key（可选）', google: 'Google API Key', 'cartesia.apiKey': 'Cartesia API Key', deepseek: 'DeepSeek API Key' };
const keyPages = { 'qwen.apiKey': 'qwen', 'doubao.apiKey': 'doubao', google: 'google', 'cartesia.apiKey': 'cartesia', deepseek: 'deepseek' };
const simpleVoices = { qwen: ['Tina', 'Raymond', 'Jennifer'], doubao: ['zh_female_xiaohe_jupiter_bigtts', 'zh_female_vv_jupiter_bigtts', 'zh_male_yunzhou_jupiter_bigtts'], google: ['Puck', 'Kore', 'Aoede'] };
const voiceNames = { Tina: 'Tina · 温和女声', Raymond: 'Raymond · 沉稳男声', Jennifer: 'Jennifer · 英语女声', Puck: 'Puck · 活泼男声', Kore: 'Kore · 干练女声', Aoede: 'Aoede · 轻快女声', zh_female_xiaohe_jupiter_bigtts: '小何 · 甜美台腔', zh_female_vv_jupiter_bigtts: 'VV · 活泼女声', zh_male_yunzhou_jupiter_bigtts: '云舟 · 沉稳男声', zh_male_xiaotian_jupiter_bigtts: '小天 · 清爽男声', en_male_tim_uranus_bigtts: 'Tim · 美式英语', en_female_dacey_uranus_bigtts: 'Dacey · 美式英语', en_female_stokie_uranus_bigtts: 'Stokie · 美式英语' };

function feedback(message, kind = '', target = 'feedback') { byId(target).textContent = message; byId(target).dataset.kind = kind; }
function providerById(id) { return settings?.providers.find(item => item.id === id); }
function profile() {
  const id = byId('provider').value === 'google' ? byId('google-mode').value || 'google' : byId('provider').value;
  return providerById(id);
}
function translatorProfile() { return providerById(translator); }
function accountOf(providerId, fieldId) { return providerById(providerId)?.fields.find(field => field.id === fieldId)?.account || `${providerId}.${fieldId}`; }
function keyName(field) { return keyNames[field.account] || field.label; }
function connectionState() {
  return !lastStatus.providerId || lastStatus.providerId === profile()?.id ? lastStatus.status : 'disconnected';
}
function updateConnectAction() {
  const state = connectionState();
  const connected = state === 'connected' && !dirty;
  const button = byId('connect');
  button.disabled = busy || state === 'connecting';
  button.className = state === 'connecting' ? 'primary is-connecting' : connected ? 'secondary' : 'primary';
  button.setAttribute('aria-busy', String(state === 'connecting'));
  button.textContent = state === 'connecting' ? '正在连接…' : connected ? '重新连接' : state === 'error' ? '重试连接 →' : profile()?.id === 'google-translate' ? '保存并开始语音翻译 →' : '保存并开始聊天 →';
}
function markDirty() {
  dirty = true; byId('finish').hidden = true; updateConnectAction();
  if (connectionState() === 'connected') feedback('设置有更改，保存后重新连接即可生效。');
}
function focusCredential() {
  const field = profile().fields.find(item => !item.optional && !item.configured);
  if (field) byId(`secret-${field.id}`)?.focus?.();
}
function rememberDraft() {
  if (!renderedProvider) return;
  drafts.set(renderedProvider, { dirty, values: Object.fromEntries(['model', 'voice', 'voice-custom'].map(id => [id, byId(id).value])) });
}
function status(event) {
  if (event) lastStatus = event;
  const selected = !event?.providerId || event.providerId === profile()?.id;
  const state = selected ? event?.status || 'disconnected' : 'disconnected';
  const names = { disconnected: '麦克风只在你按下 Alt+Q 时打开。', connecting: '正在连接，请稍等…', connected: '已连接！按 Alt+Q 和小伙伴说话。', error: '连接失败，请检查密钥与网络后重试。' };
  byId('connection-status').dataset.state = state;
  byId('connection-status').textContent = state === 'error' && event.error ? `连接失败：${event.error}` : names[state] || names.disconnected;
  byId('finish').hidden = state !== 'connected' || dirty;
  updateConnectAction();
  // The status line already explains connection results.
  if ((state === 'connected' && !dirty) || state === 'error') feedback('');
}
function setBusy(value, testing = false) {
  if (value) window.stopMicrophoneCheck?.();
  busy = value;
  for (const control of document.querySelectorAll('button, input, select')) control.disabled = value;
  byId('cancel').hidden = !testing;
  byId('cancel').disabled = false;
  if (!value && settings) updateConnectAction();
}

/** One key input. Its value is the account draft, so shared keys stay in sync. */
function keyField(item, field, { id, submit }) {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = keyName(field);
  const heading = document.createElement('div'); heading.className = 'field-label'; heading.append(label);
  if (field.configured) {
    const saved = document.createElement('span'); saved.className = 'saved-badge'; saved.textContent = '✓ 已保存';
    const remove = document.createElement('button'); remove.className = 'key-link key-remove'; remove.textContent = '移除';
    remove.setAttribute('aria-label', `移除 ${keyName(field)}`); remove.disabled = busy;
    // Two clicks: a key used by voice and translation should not vanish by accident.
    remove.addEventListener('click', () => {
      if (remove.dataset.confirm !== 'true') {
        remove.dataset.confirm = 'true'; remove.textContent = '确认移除？';
        setTimeout(() => { remove.dataset.confirm = ''; remove.textContent = '移除'; }, 4000);
        return;
      }
      deleteKey(item.id, field);
    });
    heading.append(saved, remove);
  } else if (!field.optional) {
    const getKey = document.createElement('button'); getKey.className = 'key-link'; getKey.textContent = '获取密钥 ↗';
    getKey.setAttribute('aria-label', `获取 ${keyName(field)}`); getKey.disabled = busy;
    getKey.addEventListener('click', () => action(async () => {
      const response = await api.openAIKeyPage(keyPages[field.account] || item.id);
      if (!response.ok) throw new Error(response.error);
    }));
    heading.append(getKey);
  }
  const input = document.createElement('input');
  input.id = id; input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 4096; input.spellcheck = false;
  input.disabled = busy;
  input.value = keyDrafts.get(field.account) || '';
  input.placeholder = field.configured ? '已保存，留空保持不变' : '在这里粘贴 API Key';
  input.addEventListener('input', () => {
    keyDrafts.set(field.account, input.value);
    if (submit === 'connect') markDirty();
    updateTranslateAction();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !busy && !event.isComposing) { event.preventDefault(); byId(submit).click(); }
  });
  const wrapper = document.createElement('div'); wrapper.className = 'secret-field'; wrapper.append(heading, input);
  return wrapper;
}

function renderProfile() {
  const item = profile();
  if (!item) return;
  dirty = false;
  byId('finish').hidden = true;
  for (const button of byId('provider-options').children) button.setAttribute('aria-pressed', String(button.dataset.provider === byId('provider').value));
  const container = byId('secret-fields');
  container.className = item.fields.filter(field => !field.optional).length > 1 ? 'secret-fields two-keys' : 'secret-fields';
  container.replaceChildren();
  byId('optional-secret-fields').replaceChildren();
  for (const field of item.fields) {
    (field.optional ? byId('optional-secret-fields') : container).append(keyField(item, field, { id: `secret-${field.id}`, submit: 'connect' }));
  }
  byId('provider-help').textContent = item.id === 'qwen' ? '一个阿里百炼密钥，语音聊天和翻译都能用。'
    : item.id === 'doubao' ? '使用火山引擎「端到端实时语音」的 API Key，默认声音是小何。'
    : item.id === 'cartesia' ? 'Cartesia 负责声音，DeepSeek 负责对话；这个 DeepSeek 密钥也能用来翻译。'
    : item.id === 'google-translate' ? '实时语音翻译：你说中文，它用外语说出来。与 Gemini 聊天共用同一个密钥。'
    : 'Google AI Studio 的 API Key，Gemini 聊天和实时语音翻译共用；需具备相应网络条件。';
  byId('model').value = item.model;
  byId('google-mode-fields').hidden = byId('provider').value !== 'google';
  byId('voice-fields').hidden = !item.voice;
  const choices = item.voices.length ? [...new Set([...(simpleVoices[item.id] || item.voices.slice(0, 3)), item.voice])].filter(voice => item.voices.includes(voice)) : [item.voice];
  byId('voice').replaceChildren(...choices.map(voice => new Option(voiceNames[voice] || (item.id === 'cartesia' ? '当前音色' : voice), voice)));
  byId('voice').value = item.voice;
  byId('voice-custom').value = item.voice;
  byId('all-voice-fields').hidden = !item.voices.length;
  byId('all-voices').replaceChildren(...item.voices.map(voice => new Option(voiceNames[voice] || voice, voice)));
  byId('all-voices').value = item.voice;
  byId('custom-voice-fields').hidden = !item.voice || Boolean(item.voices.length);
  byId('custom-voice-id').value = item.voice;
  renderedProvider = item.id;
  const draft = drafts.get(item.id);
  if (draft) {
    // A draft can choose a voice outside the three simple defaults.
    const voice = draft.values.voice;
    if (item.voices.includes(voice) && ![...byId('voice').options].some(option => option.value === voice)) {
      byId('voice').append(new Option(voiceNames[voice] || voice, voice));
    }
    for (const [id, value] of Object.entries(draft.values)) byId(id).value = value;
    byId('custom-voice-id').value = byId('voice-custom').value;
    byId('all-voices').value = byId('voice').value;
  }
  if (draft?.dirty || item.fields.some(field => keyDrafts.get(field.account))) markDirty();
  updateConnectAction();
  renderTranslator();
}

/** The translation card reuses a key already shown above instead of asking again. */
function renderTranslator() {
  const item = translatorProfile();
  if (!item) return;
  const field = item.fields[0];
  const name = /^[ -~]+$/.test(providerNames[item.id]) ? ` ${providerNames[item.id]} ` : providerNames[item.id];
  for (const button of byId('translator-options').children) button.setAttribute('aria-pressed', String(button.dataset.provider === item.id));
  const sharedWithVoice = profile()?.fields.some(voiceField => voiceField.account === field.account);
  const container = byId('translate-key');
  container.replaceChildren();
  let state;
  if (sharedWithVoice) {
    state = field.configured ? `已就绪 · 与语音共用${name}密钥` : `会直接使用上方的${name}密钥，不用再填一次。`;
  } else if (field.configured && !changingTranslateKey) {
    state = `已就绪 · ${name}密钥已保存`;
  } else {
    state = field.configured ? `粘贴新的${name}密钥，保存后替换旧的。` : `粘贴${name}密钥就能用。`;
    container.append(keyField(item, field, { id: 'translate-secret', submit: 'test' }));
  }
  byId('translate-state').textContent = state;
  byId('translate-state').dataset.ready = String(Boolean(field.configured && !translatorPending));
  byId('translate-change').hidden = sharedWithVoice || !field.configured || changingTranslateKey;
  byId('translate-model-fields').hidden = item.id !== 'deepseek';
  byId('translate-model').value = item.model;
  // Region and workspace belong to the Qwen account, whichever feature uses it.
  byId('workspace-fields').hidden = profile()?.id !== 'qwen' && item.id !== 'qwen';
  updateTranslateAction();
}
function updateTranslateAction() {
  const field = translatorProfile()?.fields[0];
  if (!field) return;
  const draft = Boolean(keyDrafts.get(field.account)?.trim());
  const shared = profile()?.fields.some(voiceField => voiceField.account === field.account);
  const pending = draft || translatorPending || !field.configured;
  // A key shared with the voice card is saved by its main button; stay quiet until there is something to do.
  byId('test').hidden = shared && !field.configured && !draft;
  byId('test').textContent = !pending ? '测试翻译' : shared ? '只启用翻译' : '保存并启用翻译';
  byId('test').className = pending && !shared ? 'primary compact' : 'secondary';
}

function render(next, selected) {
  settings = next;
  if (!translatorPending) translator = settings.translationProvider;
  const selection = selected || settings.selectedProvider;
  const providers = voiceProviders.map(id => providerById(id)).filter(Boolean);
  const visibleSelection = selection === 'google-translate' ? 'google' : selection;
  byId('provider').replaceChildren(...providers.map(item => new Option(providerNames[item.id] || item.label, item.id)));
  byId('provider').value = providers.some(item => item.id === visibleSelection) ? visibleSelection : 'qwen';
  byId('google-mode').value = selection === 'google-translate' ? 'google-translate' : 'google';
  byId('workspace').value = providerById('qwen')?.workspaceId || '';
  byId('region').value = providerById('qwen')?.region || 'beijing';
  byId('provider-options').replaceChildren(...providers.map(item => {
    const button = document.createElement('button'); button.className = 'provider-option'; button.dataset.provider = item.id;
    const name = document.createElement('span'); name.className = 'provider-name';
    const mark = document.createElement('span'); mark.className = 'provider-mark'; mark.textContent = providerDescriptions[item.id][0]; mark.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.textContent = providerNames[item.id]; name.append(mark, title);
    const description = document.createElement('span'); description.className = 'provider-description'; description.textContent = providerDescriptions[item.id][1];
    button.append(name, description);
    if (item.fields.some(field => !field.optional && field.configured)) {
      const ready = document.createElement('span'); ready.className = 'provider-ready'; ready.textContent = '已保存密钥'; button.append(ready);
    }
    button.addEventListener('click', () => { if (busy || byId('provider').value === item.id) return; byId('provider').value = item.id; changeProvider(); });
    button.disabled = busy; return button;
  }));
  byId('translator-options').replaceChildren(...['qwen', 'deepseek'].map(id => {
    const button = document.createElement('button'); button.dataset.provider = id; button.textContent = providerNames[id];
    button.addEventListener('click', () => chooseTranslator(id));
    button.disabled = busy; return button;
  }));
  renderProfile();
}

function voicePayload() {
  const item = profile();
  return { provider: item.id, purpose: 'voice', model: byId('model').value,
    voice: item.voices.length ? byId('voice').value : byId('voice-custom').value,
    ...(item.id === 'qwen' ? { workspaceId: byId('workspace').value, region: byId('region').value } : {}),
    secrets: Object.fromEntries(item.fields.map(field => [field.id, keyDrafts.get(field.account) || ''])) };
}
function translatePayload() {
  const item = translatorProfile();
  return { provider: item.id, purpose: 'translate', translationProvider: item.id,
    ...(item.id === 'qwen' ? { workspaceId: byId('workspace').value, region: byId('region').value } : { model: byId('translate-model').value }),
    secrets: { apiKey: keyDrafts.get(item.fields[0].account) || '' } };
}
async function store(data) {
  const response = await api.saveAISettings(data);
  if (!response.ok) throw new Error(response.error);
  // Saved keys leave this window; failed saves keep them for correction.
  for (const [fieldId, value] of Object.entries(data.secrets || {})) if (value) keyDrafts.delete(accountOf(data.provider, fieldId));
  return response.settings;
}
async function saveVoice() {
  rememberDraft();
  const data = voicePayload();
  let next = await store(data);
  drafts.delete(data.provider);
  // A translator picked below is saved by the same click once its key exists.
  if (translatorPending) {
    const field = next.providers.find(item => item.id === translator).fields[0];
    if (field.configured || keyDrafts.get(field.account)?.trim()) { next = await store(translatePayload()); translatorPending = false; }
  }
  render(next, data.provider);
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
  rememberDraft(); window.stopMicrophoneCheck?.();
  byId('google-mode').value = 'google';
  renderProfile(); status(lastStatus);
  feedback(profile().credentialError || '', profile().credentialError ? 'error' : '');
  focusCredential();
}
byId('provider').addEventListener('change', changeProvider);
function chooseTranslator(id) {
  if (!settings || busy || id === translator) return;
  translator = id; changingTranslateKey = false;
  const item = translatorProfile();
  feedback('', '', 'translate-feedback');
  if (!item.fields[0].configured) {
    translatorPending = true; renderTranslator();
    byId('translate-secret')?.focus?.();
    return;
  }
  // The key is already saved: switching takes effect at once.
  action(async () => {
    rememberDraft();
    const next = await store({ provider: id, purpose: 'translate', translationProvider: id });
    translatorPending = false;
    render(next, renderedProvider);
    feedback(`翻译已改用${providerNames[id]}。`, 'success', 'translate-feedback');
  });
}
/** Main asks for a purpose when a feature needs setup; bring that card forward. */
function choosePurpose(purpose) {
  if (!settings || !['voice', 'translate'].includes(purpose)) return;
  const card = byId(purpose === 'translate' ? 'translate-card' : 'voice-card');
  card.scrollIntoView?.({ block: 'center' });
  card.classList?.add('attention');
  setTimeout(() => card.classList?.remove('attention'), 1600);
  if (purpose === 'translate') (byId('translate-secret') || byId('test')).focus?.();
  else focusCredential();
}
api.onSettingsPurpose?.(choosePurpose);
byId('google-mode').addEventListener('change', () => {
  rememberDraft(); window.stopMicrophoneCheck?.(); renderProfile(); status(lastStatus);
  feedback(byId('google-mode').value === 'google-translate' ? '已切换为实时语音翻译，密钥与 Gemini 聊天共用。' : '已切换为 Gemini 语音聊天。');
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
byId('translate-change').addEventListener('click', () => { changingTranslateKey = true; renderTranslator(); byId('translate-secret')?.focus?.(); });
byId('open-phrases').addEventListener('click', () => action(async () => {
  const response = await api.openPhrases();
  if (!response.ok) throw new Error(response.error);
}));
function requireCredentials(item = profile()) {
  const missing = item.fields.find(field => !field.optional && !field.configured && !keyDrafts.get(field.account)?.trim());
  if (missing) throw new Error(`请先粘贴 ${keyName(missing)}。`);
}
byId('save').addEventListener('click', () => action(async () => { await saveVoice(); feedback('设置已加密保存。', 'success'); }));
byId('voice-test').addEventListener('click', () => action(async () => {
  requireCredentials();
  const provider = await saveVoice(); feedback('正在测试语音连接，麦克风保持关闭…');
  if (testCancelled) { feedback('测试已取消，请重新测试。'); return; }
  const response = await api.testAIConnection(provider);
  if (!response.ok) throw new Error(response.error);
  if (testCancelled) { feedback('测试已取消，请重新测试。'); return; }
  feedback(response.result.ok ? '测试通过，可以开始聊天了。' : response.result.message, response.result.ok ? 'success' : 'error');
}, true));
byId('test').addEventListener('click', () => action(async () => {
  try {
    requireCredentials(translatorProfile());
    rememberDraft();
    const next = await store(translatePayload());
    translatorPending = false; changingTranslateKey = false;
    render(next, renderedProvider);
    feedback('正在测试翻译…', '', 'translate-feedback');
    if (testCancelled) { feedback('测试已取消，请重新测试。', '', 'translate-feedback'); return; }
    const response = await api.testTextConnection(translator);
    if (!response.ok) throw new Error(response.error);
    if (testCancelled) { feedback('测试已取消，请重新测试。', '', 'translate-feedback'); return; }
    feedback(response.result.ok ? '翻译已就绪！复制文字后按 Alt+T。截图翻译还需要视觉模型权限。' : response.result.message,
      response.result.ok ? 'success' : 'error', 'translate-feedback');
  } catch (error) { feedback(error.message || '操作失败，请重试。', 'error', 'translate-feedback'); }
}, true));
byId('connect').addEventListener('click', () => action(async () => {
  requireCredentials();
  const provider = await saveVoice(); const response = await api.connectAI(provider);
  if (!response.ok) throw new Error(response.error);
  status(response.status);
  if (!['error', 'connected'].includes(response.status?.status)) feedback('密钥已保存，正在连接…');
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
function deleteKey(providerId, field) {
  return action(async () => {
    const response = await api.deleteAISecrets(providerId, field.id);
    if (!response.ok) throw new Error(response.error);
    keyDrafts.delete(field.account);
    rememberDraft();
    render(response.settings, renderedProvider);
    feedback(`${keyName(field)} 已移除，用到它的功能都已停用。`, 'success');
  });
}
byId('import').addEventListener('click', () => action(async () => {
  const response = await api.importAIConfig();
  if (!response.ok) throw new Error(response.error);
  if (response.cancelled) return;
  keyDrafts.clear();
  drafts.clear();
  render(response.settings); feedback(`已导入 ${response.count} 个密钥并加密保存。`, 'success');
}));
api.onVoiceStatus(status);
setBusy(true);
api.getAISettings().then(response => {
  if (!response.ok) throw new Error(response.error);
  if (byId('settings-version')) byId('settings-version').textContent = response.version ? `· v${response.version}` : '';
  if (['aurora_wolf', 'donkey_courier', 'treant_sapling', 'mischievous_greevil', 'baby_roshan'].includes(response.companionPet)) {
    byId('welcome-pet').src = `assets/pets/${response.companionPet}/idle.svg`;
  }
  const saved = response.settings.selectedProvider;
  render(response.settings, voiceProviders.includes(saved) || saved === 'google-translate' ? saved : 'qwen');
  status(response.status); setBusy(false);
  focusCredential();
  if (response.purpose) choosePurpose(response.purpose);
  if (settings.error) feedback(settings.error, 'error');
  else if (profile().credentialError) feedback(profile().credentialError, 'error');
  else if (!settings.encryptionAvailable) feedback('系统安全存储不可用，无法保存密钥。', 'error');
  else if (lastStatus.status !== 'connected') feedback('');
}).catch(error => feedback(error.message || '设置加载失败，请重新打开。', 'error'));

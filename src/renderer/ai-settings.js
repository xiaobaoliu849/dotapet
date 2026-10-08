const api = window.electronAPI;
const byId = id => document.getElementById(id);
let settings;
let busy = false;
let generation = 0;
let testCancelled = false;
let lastStatus = { status: 'disconnected' };
const providerNames = { qwen: '阿里千问 · 国内通用', doubao: '豆包 · 国内语音', google: 'Gemini · 海外实时对话', 'google-translate': 'Gemini · 海外实时翻译', cartesia: 'Cartesia · 海外英语对练', deepseek: 'DeepSeek · 国内文字 / 截图' };
const overseasProviders = ['google', 'google-translate', 'cartesia'];
const translating = () => byId('usage')?.value === 'translate';
const voiceNames = { zh_female_xiaohe_jupiter_bigtts: '小何 · 甜美台腔', zh_female_vv_jupiter_bigtts: 'VV · 活泼女声', zh_male_yunzhou_jupiter_bigtts: '云舟 · 沉稳男声', zh_male_xiaotian_jupiter_bigtts: '小天 · 清爽男声', en_male_tim_uranus_bigtts: 'Tim · 美式英语', en_female_dacey_uranus_bigtts: 'Dacey · 美式英语', en_female_stokie_uranus_bigtts: 'Stokie · 美式英语' };

function feedback(message, kind = '') { byId('feedback').textContent = message; byId('feedback').dataset.kind = kind; }
function profile() { return settings.providers.find(item => item.id === byId('provider').value); }
function status(event) {
  if (event) lastStatus = event;
  if (translating()) { byId('connection-status').textContent = '按需翻译即可，无需连接语音或开启麦克风。'; return; }
  const names = { disconnected: '还没有连接，先安顿好小伙伴吧', connecting: '正在为小伙伴接通声音…', connected: '声音已就绪，回到桌宠打个招呼吧', error: '暂时没连上，我们可以再试一次' };
  byId('connection-status').dataset.state = event?.status || 'disconnected';
  byId('connection-status').textContent = `${names[event?.status] || names.disconnected}${event?.status === 'error' ? `：${event.error}` : ''}`;
}
function setBusy(value, testing = false) {
  if (value) window.stopMicrophoneCheck?.();
  busy = value;
  for (const control of document.querySelectorAll('button, input, select')) control.disabled = value;
  byId('cancel').hidden = !testing;
  byId('cancel').disabled = false;
  if (!value && settings) {
    byId('connect').disabled = translating() || Boolean(profile()?.textOnly);
    byId('delete').disabled = !profile()?.fields.some(field => field.configured);
  }
}
function renderProfile() {
  const item = profile();
  if (!item) return;
  const container = byId('secret-fields');
  container.replaceChildren();
  const optionalContainer = byId('optional-secret-fields');
  optionalContainer.replaceChildren();
  for (const field of item.fields) {
    const label = document.createElement('label');
    label.htmlFor = `secret-${field.id}`;
    label.textContent = `${field.label}${field.configured ? ' · 已保存' : ''}`;
    if (field.configured) label.className = 'configured';
    const input = document.createElement('input');
    input.id = label.htmlFor; input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 4096;
    input.placeholder = field.configured ? '留空保留已有密钥；输入新密钥可替换' : '粘贴你自己的 API Key';
    (field.optional ? optionalContainer : container).append(label, input);
  }
  byId('provider-help').textContent = item.id === 'cartesia' ? '带上 Cartesia 和 DeepSeek 两把密钥，一起练练英语。'
    : item.textOnly ? '支持文字与截图翻译。图片识别会使用 DeepSeek Flash；语音聊天请选千问或豆包。'
    : item.id === 'qwen' ? '使用你自己的百炼密钥。地区与工作空间可在「更多设置」中调整。'
    : item.id === 'google-translate' ? '让小伙伴实时翻译你的语音。此模式的 Google 密钥单独保存。'
    : '使用你自己的服务商密钥。模型和音色需要在账户中可用。';
  byId('model').value = item.model;
  byId('workspace-fields').hidden = item.id !== 'qwen';
  byId('workspace').value = item.workspaceId || '';
  byId('region').value = item.region || 'beijing';
  byId('voice-fields').hidden = translating() || !item.voice;
  if (byId('model-fields')) byId('model-fields').hidden = translating();
  if (byId('translator-fields')) byId('translator-fields').hidden = translating();
  byId('voice').hidden = !item.voices.length;
  byId('voice-custom').hidden = Boolean(item.voices.length);
  byId('voice').replaceChildren(...item.voices.map(voice => new Option(voiceNames[voice] || voice, voice)));
  byId('voice').value = item.voice;
  byId('voice-custom').value = item.voice;
  byId('translator').value = settings.translationProvider;
  byId('connect').hidden = translating();
  byId('disconnect').hidden = translating();
  byId('connect').disabled = busy || translating() || Boolean(item.textOnly);
  byId('test').className = translating() ? 'primary' : '';
  byId('test').textContent = translating() ? '保存并测试文字翻译' : '保存并测试语音';
  if (byId('microphone')) byId('microphone').hidden = translating();
  if (byId('connection-title')) byId('connection-title').textContent = translating() ? '测试后，按快捷键翻译' : '测试后，连接语音';
  const note = document.querySelector?.('.connection-note');
  if (note) note.textContent = translating()
    ? 'Win+Shift+S 框选聊天 → Alt+T 翻译截图；复制文字 → Alt+T；自己输入中文 → F8 翻成英文。截图会发送给你选择的服务商，可能产生用量。'
    : '先测试，再连接；回到桌宠点麦克风或按 Alt+Q 讲话，再按一次关闭。测试不会开启麦克风，可能产生少量用量。';
  byId('connect').textContent = item.textOnly ? '这是文字翻译模式' : '连接语音 ↗';
  byId('delete').disabled = busy || !item.fields.some(field => field.configured);
}
function render(next, selected) {
  const initial = !settings;
  settings = next;
  const selection = selected || settings.selectedProvider;
  if (initial && byId('usage')) {
    byId('usage').value = settings.providers.find(item => item.id === selection)?.textOnly || !settings.providers.some(item => item.fields.some(field => field.configured)) ? 'translate' : 'voice';
    if (byId('overseas')) byId('overseas').checked = overseasProviders.includes(selection) && settings.providers.find(item => item.id === selection)?.fields.some(field => field.configured);
  }
  const providers = settings.providers.filter(item => translating() ? ['qwen', 'deepseek'].includes(item.id) : !item.textOnly && (!overseasProviders.includes(item.id) || byId('overseas')?.checked));
  byId('provider').replaceChildren(...providers.map(item => new Option(providerNames[item.id] || item.label, item.id)));
  byId('provider').value = providers.some(item => item.id === selection) ? selection : 'qwen';
  renderProfile();
}
function payload() {
  const item = profile();
  return { provider: item.id, model: byId('model').value, voice: item.voices.length ? byId('voice').value : byId('voice-custom').value,
    workspaceId: byId('workspace').value, region: byId('region').value,
    translationProvider: translating() ? item.id : byId('translator').value,
    secrets: Object.fromEntries(item.fields.map(field => [field.id, byId(`secret-${field.id}`).value])) };
}
function clearInputs() { for (const input of document.querySelectorAll('input[type=password]')) input.value = ''; }
async function save() {
  const data = payload();
  clearInputs();
  const response = await api.saveAISettings(data);
  if (!response.ok) throw new Error(response.error);
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
byId('provider').addEventListener('change', () => { renderProfile(); feedback(profile().credentialError || '选好啦。填上密钥，准备好了再连接。', profile().credentialError ? 'error' : ''); });
function choosePurpose(purpose) {
  if (!settings || busy || !['voice', 'translate'].includes(purpose)) return;
  window.stopMicrophoneCheck?.(); clearInputs(); byId('usage').value = purpose;
  render(settings, translating() ? settings.translationProvider : byId('provider').value);
  status(lastStatus);
}
api.onSettingsPurpose?.(choosePurpose);
for (const id of ['usage', 'overseas']) byId(id)?.addEventListener('change', () => {
  window.stopMicrophoneCheck?.(); clearInputs(); render(settings, translating() ? settings.translationProvider : byId('provider').value);
  status(lastStatus); feedback('已切换功能。未保存的密钥已清空，已保存的密钥会保留。');
});
byId('save').addEventListener('click', () => action(async () => { await save(); feedback('密钥已加密保存。' + (translating() ? '点击测试，随后按快捷键翻译。' : '点击测试，随后连接语音。'), 'success'); }));
byId('test').addEventListener('click', () => action(async () => {
  const provider = await save(); feedback(translating() ? '正在测试文字模型，麦克风保持关闭…' : '正在测试语音连接，麦克风保持关闭…');
  if (testCancelled) { feedback('测试已取消，请重新测试。'); return; }
  const response = await (translating() ? api.testTextConnection(provider) : api.testAIConnection(provider));
  if (!response.ok) throw new Error(response.error);
  feedback(response.result.message + (response.result.ok && translating() ? ' 现在可复制文字按 Alt+T，或框选聊天截图后按 Alt+T。截图能力取决于视觉模型权限。' : ''), response.result.ok ? 'success' : 'error');
}, true));
byId('connect').addEventListener('click', () => action(async () => {
  const provider = await save(); const response = await api.connectAI(provider);
  if (!response.ok) throw new Error(response.error);
  status(response.status);
  feedback(response.status?.status === 'error' ? response.status.error : '正在接通。声音准备好后，回到桌宠开启麦克风吧。', response.status?.status === 'error' ? 'error' : '');
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
  render(response.settings, id); feedback('此服务商的密钥已删除，当前语音已断开。', 'success');
}));
byId('import').addEventListener('click', () => action(async () => {
  clearInputs(); const response = await api.importAIConfig();
  if (!response.ok) throw new Error(response.error);
  if (response.cancelled) return;
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
  if (settings.error) feedback(settings.error, 'error');
  else if (profile().credentialError) feedback(profile().credentialError, 'error');
  else if (!settings.encryptionAvailable) feedback('系统安全存储不可用，无法保存密钥。', 'error');
  else feedback(translating() ? '填写自己的密钥后，点击「保存并测试文字翻译」。无需开启语音。' : '填写自己的密钥后，先测试，再连接语音。');
}).catch(error => feedback(error.message || '设置加载失败，请重新打开。', 'error'));

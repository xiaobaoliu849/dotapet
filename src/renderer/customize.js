import { APPEARANCE_STYLES, normalizeProfile, resolveAppearance, applyImageAppearance, applyBackground } from '../services/appearance.js';

const api = window.customizationAPI;
const $ = id => document.getElementById(id);
let data = null, key = null, draft = normalizeProfile(), previewState = 'idle', busy = false, importRole = 'appearance';
let refreshSequence = 0, deleteId = null;
const drafts = new Map();
const character = () => data?.characters.find(item => item.key === key);
const option = (select, value, text) => { const item = document.createElement('option'); item.value = value; item.textContent = text; select.append(item); };
const message = (text, error = false) => { $('feedback').textContent = text; $('feedback').dataset.error = String(error); };
const isDirty = () => JSON.stringify(draft) !== JSON.stringify(normalizeProfile(data?.profiles[key]));
const onDesktop = () => Boolean(data) && data.activeKey === key;
/** One main action: apply edits and, for another companion, put it on the desktop. */
function draftStatus() {
  const dirty = isDirty(), active = onDesktop();
  $('draft-status').textContent = dirty ? '有改动未应用 · 目前只在预览中' : active ? '已应用 · 桌面伙伴正在使用这套外观' : '已保存 · 还没有换到桌面上';
  $('apply').textContent = active ? (dirty ? '应用到桌面伙伴' : '已应用') : dirty ? '应用并换上此伙伴' : '换上此伙伴';
  // Nothing to do for the companion already on the desktop with no edits.
  $('apply').disabled = busy || !data || (active && !dirty);
  $('desk-status').textContent = active ? '✓ 正在桌面上' : '不在桌面上，应用后会换上它';
  $('desk-status').dataset.active = String(active);
}
async function call(operation, success) {
  if (busy) return null;
  busy = true;
  $('editor').inert = true;
  $('editor').setAttribute('aria-busy', 'true');
  draftStatus();
  try {
    const result = await operation();
    if (!result?.ok) throw new Error(result?.error || '操作未完成，请重试。');
    if (result.state) acceptData(result.state);
    if (!result.cancelled && success) message(success);
    return result;
  } catch (error) { message(error.message, true); return null; }
  finally { busy = false; $('editor').inert = false; $('editor').setAttribute('aria-busy', 'false'); draftStatus(); }
}
function acceptData(value) {
  data = value;
  for (const profile of [draft, ...drafts.values()]) {
    for (const part of ['appearance', 'background']) if (profile[part].assetId && !data.assets.some(a => a.id === profile[part].assetId)) {
      profile[part].assetId = null;
      if (part === 'background') profile.background.mode = 'transparent';
    }
  }
  if (!key) key = data.characters.some(c => c.key === data.activeKey) ? data.activeKey : data.characters[0]?.key;
  $('active-name').textContent = `桌面伙伴：${data.characters.find(c => c.key === data.activeKey)?.name || '自由对话'}`;
  const selected = key;
  $('character').replaceChildren();
  for (const group of [['宠物', 'pet:'], ['英雄', 'hero:']]) {
    const optgroup = document.createElement('optgroup'); optgroup.label = group[0];
    for (const c of data.characters.filter(c => c.key.startsWith(group[1]))) option(optgroup, c.key, c.name);
    $('character').append(optgroup);
  }
  $('character').value = selected;
  $('character').disabled = false;
  renderLibrary(); renderPresets(); renderSources(); renderPreview(); draftStatus();
}
async function refresh() {
  const sequence = ++refreshSequence;
  const result = await api.get();
  if (sequence !== refreshSequence) return;
  if (!result?.ok) { message(result?.error || '自定义设置加载失败。', true); return; }
  if (!data) {
    key = result.state.characters.some(c => c.key === result.state.activeKey) ? result.state.activeKey : result.state.characters[0]?.key;
    draft = normalizeProfile(result.state.profiles[key]);
    acceptData(result.state); fillControls();
  } else {
    // Metadata changes never discard an unapplied draft. Deleted assets are reset.
    for (const part of ['appearance', 'background']) {
      if (draft[part].assetId && !result.state.assets.some(a => a.id === draft[part].assetId)) {
        draft[part].assetId = null;
        if (part === 'background') draft.background.mode = 'transparent';
      }
    }
    acceptData(result.state); fillControls();
  }
}
function renderSources() {
  const source = $('appearance-source'); source.replaceChildren();
  option(source, 'default', '内置默认形象');
  for (const look of character()?.options || []) if (look.kind === 'appearance') option(source, `builtin:${look.id}`, look.name);
  for (const asset of data.assets) option(source, asset.id, `${asset.name} · ${asset.animated ? '动图' : '图片'}`);
  source.value = draft.appearance.assetId || (draft.appearance.builtinId ? `builtin:${draft.appearance.builtinId}` : 'default');
  if (!source.value) source.value = 'default';
  const bg = $('background-asset'); bg.replaceChildren(); option(bg, '', '请选择图片');
  for (const asset of data.assets) option(bg, asset.id, asset.name);
  bg.value = draft.background.assetId || '';
  renderAccents();
}
/** A radio styled as a chip; the swatch shows what picking it looks like. */
function chip(name, value, text, swatch) {
  const label = document.createElement('label'); label.className = 'chip';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = name; radio.value = value;
  const dot = document.createElement('span'); dot.className = 'swatch'; Object.assign(dot.style, swatch);
  label.append(radio, dot, text);
  return label;
}
const defaultAccent = () => character()?.themeColor || '#f59e0b';
const accentLooks = () => (character()?.options || []).filter(look => look.kind === 'theme' && /^#[0-9a-f]{6}$/i.test(look.themeColor || ''));
/** Character default, the character's color-only looks, then a free pick. */
function renderAccents() {
  const looks = accentLooks();
  $('accent-choices').replaceChildren(chip('accent', 'default', '角色默认', { background: defaultAccent() }),
    ...looks.map(look => chip('accent', look.id, look.name, { background: look.themeColor })), $('accent-custom'));
  const accent = draft.accent?.toLowerCase();
  const choice = !accent ? 'default' : looks.find(look => look.themeColor.toLowerCase() === accent)?.id || 'custom';
  for (const radio of $('accent-choices').querySelectorAll('input[type=radio]')) radio.checked = radio.value === choice;
}
function fillControls() {
  renderSources();
  const a = draft.appearance, b = draft.background;
  for (const radio of $('appearance-style').querySelectorAll('input')) radio.checked = radio.value === a.style;
  $('appearance-fit').value = a.fit;
  $('appearance-scale').value = a.scale * 100; $('appearance-x').value = a.x; $('appearance-y').value = a.y;
  $('accent').value = draft.accent || defaultAccent();
  for (const field of ['mode', 'scope', 'color', 'fit']) $(`background-${field}`).value = b[field];
  $('background-opacity').value = b.opacity * 100; $('background-dim').value = b.dim * 100;
  renderPreview(); draftStatus();
}
function renderPreview() {
  if (!character()) return;
  const builtins = Object.fromEntries(character().options.map(look => [look.id, look]));
  const resolved = resolveAppearance(draft, data.assets, character().sprites[previewState] || character().sprites.idle, builtins, previewState);
  applyImageAppearance($('preview-image'), resolved);
  $('preview-image').classList.toggle('default-portrait', !resolved.imported && !/\.svg(?:$|\?)/i.test(resolved.src || ''));
  applyBackground($('preview-background'), draft, data.assets);
  $('preview-status').textContent = { idle: '待命', speaking: '说话', action: '互动' }[previewState];
  const asset = data.assets.find(a => a.id === draft.appearance.assetId);
  $('appearance-note').textContent = asset ? asset.animated ? '动图形象：使用图片本身的动画；不同状态共用此文件。' : '静态形象：待命、说话和互动共用这张图片。' : '内置形象：可以预览不同状态。';
  $('background-note').textContent = draft.background.scope === 'panel' ? '背景只显示在自定义面板；桌面伙伴保持透明。' : '应用后，背景会出现在桌面伙伴的场景中。';
  $('preview-status').style.border = `2px solid ${draft.accent || defaultAccent()}`;
  $('scale-value').textContent = `${Math.round(draft.appearance.scale * 100)}%`;
  $('opacity-value').textContent = `${Math.round(draft.background.opacity * 100)}%`;
  $('dim-value').textContent = `${Math.round(draft.background.dim * 100)}%`;
  $('background-image-controls').hidden = draft.background.mode !== 'image';
  $('background-color-controls').hidden = draft.background.mode !== 'color';
  $('background-options').hidden = draft.background.mode === 'transparent';
}
function edit(operation) { operation(); draft = normalizeProfile(draft); drafts.set(key, structuredClone(draft)); renderPreview(); draftStatus(); message(''); }
function selectAsset(id, role) {
  edit(() => {
    if (role === 'appearance') { draft.appearance.assetId = id; draft.appearance.builtinId = null; }
    else { draft.background.assetId = id; draft.background.mode = 'image'; }
  });
  fillControls();
}
function button(text, action, title) { const b = document.createElement('button'); b.textContent = text; if (title) b.title = title; b.addEventListener('click', action); return b; }
function renderLibrary() {
  $('asset-library').replaceChildren();
  const assets = data.assets.filter(asset => !$('favorites-only').checked || asset.favorite).sort((a,b) => Number(b.favorite) - Number(a.favorite));
  if (!assets.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = $('favorites-only').checked ? '还没有收藏的图片。' : '导入一张图片，开始你的第一套搭配。'; $('asset-library').append(p); }
  for (const asset of assets) {
    const card = document.createElement('article'); card.className = 'asset-card'; card.dataset.assetId = asset.id;
    const image = document.createElement('img'); image.src = asset.url; image.alt = asset.name;
    const name = document.createElement('input'); name.className = 'name'; name.value = asset.name; name.maxLength = 80; name.setAttribute('aria-label', '图片名称');
    name.addEventListener('change', () => call(() => api.updateAsset({ id: asset.id, changes: { name: name.value } }), '图片已重命名。'));
    const type = document.createElement('small'); type.textContent = asset.animated ? '动图 · 可重复使用' : '图片 · 可重复使用';
    const actions = document.createElement('div'); actions.className = 'asset-actions';
    const favorite = button(asset.favorite ? '★' : '☆', () => call(() => api.updateAsset({ id: asset.id, changes: { favorite: !asset.favorite } })), '收藏图片'); favorite.setAttribute('aria-pressed', String(asset.favorite));
    actions.append(button('用作形象', () => selectAsset(asset.id, 'appearance')), button('用作背景', () => selectAsset(asset.id, 'background')), favorite,
      button('删除', () => { deleteId = asset.id; $('delete-dialog').showModal(); }));
    card.append(image, name, type, actions); $('asset-library').append(card);
  }
}
function renderPresets() {
  $('preset-list').replaceChildren();
  if (!data.presets.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '保存喜欢的搭配，下次一键载入。'; $('preset-list').append(p); }
  for (const preset of data.presets) {
    const row = document.createElement('div'); row.className = 'preset-row';
    const name = document.createElement('span'); name.textContent = preset.name;
    row.append(name, button('预览', () => {
      draft = normalizeProfile(preset.profile);
      if (draft.appearance.builtinId && !character().options.some(look => look.id === draft.appearance.builtinId && look.kind === 'appearance')) draft.appearance.builtinId = null;
      drafts.set(key, structuredClone(draft)); fillControls(); message('已载入预设预览，满意后点击右下角按钮应用。');
    }), button('导出', () => call(() => api.exportPreset(preset.id), '预设已导出。')),
    button('删除', () => call(() => api.removePreset(preset.id), '预设已删除。')));
    $('preset-list').append(row);
  }
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { message('图片不能超过 12 MB。', true); return; }
  const role = importRole;
  await call(async () => {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(file);
    });
    // Decode before importing so corrupt images cannot become an applied appearance.
    await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth <= 8192 && image.naturalHeight <= 8192 ? resolve() : reject(new Error('图片尺寸不能超过 8192 像素。')); image.onerror = () => reject(new Error('图片无法读取。')); image.src = dataUrl; });
    return api.importImage({ dataUrl, name: file.name.replace(/\.[^.]+$/, '') });
  }).then(result => { if (result?.asset) { selectAsset(result.asset.id, role); message('图片已加入共享图库，满意后点击右下角按钮应用。'); } });
  $('image-file').value = '';
}

// Each swatch is the same rainbow seen through that style's filter.
for (const [id, style] of Object.entries(APPEARANCE_STYLES)) $('appearance-style').append(chip('appearance-style', id, style.name, { filter: style.filter }));
$('appearance-style').addEventListener('change', event => edit(() => { draft.appearance.style = event.target.value; }));
$('character').addEventListener('change', () => { drafts.set(key, structuredClone(draft)); key = $('character').value; draft = normalizeProfile(drafts.get(key) || data.profiles[key]); fillControls(); message(''); });
$('appearance-source').addEventListener('change', () => edit(() => { const value = $('appearance-source').value; draft.appearance.assetId = value.startsWith('asset_') ? value : null; draft.appearance.builtinId = value.startsWith('builtin:') ? value.slice(8) : null; }));
for (const [control, field, numeric] of [['appearance-fit','fit'],['appearance-scale','scale',100],['appearance-x','x',1],['appearance-y','y',1]]) {
  $(control).addEventListener('input', () => edit(() => { draft.appearance[field] = numeric ? Number($(control).value) / numeric : $(control).value; }));
}
$('accent-choices').addEventListener('change', event => {
  if (event.target.type !== 'radio') return;
  const choice = event.target.value;
  edit(() => { draft.accent = choice === 'default' ? null : choice === 'custom' ? $('accent').value : accentLooks().find(look => look.id === choice)?.themeColor || null; });
  // The 自选 swatch always shows the current color, so choosing it changes nothing until a new pick.
  $('accent').value = draft.accent || defaultAccent();
});
// Opening the picker is choosing 自选, even if the color shown is kept.
const chooseCustomAccent = () => { $('accent-custom').querySelector('input[type=radio]').checked = true; edit(() => { draft.accent = $('accent').value; }); };
$('accent').addEventListener('click', chooseCustomAccent);
$('accent').addEventListener('input', chooseCustomAccent);
// Only the settings column scrolls (the whole editor in one-column windows); the page never does.
const settingsColumn = document.querySelector('.settings'), editorArea = $('editor');
const scroller = () => getComputedStyle(settingsColumn).overflowY === 'visible' ? editorArea : settingsColumn;
document.addEventListener('scroll', () => { document.body.dataset.scrolled = String(scroller().scrollTop > 0); }, { capture: true, passive: true });
// The wheel over the still parts (character column, header, footer) scrolls the settings, never them.
document.addEventListener('wheel', event => {
  const target = scroller(), column = document.querySelector('aside');
  if (event.ctrlKey || target.contains(event.target) || document.querySelector('dialog[open]')) return;
  if (column.contains(event.target) && column.scrollHeight > column.clientHeight) return;
  const step = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? target.clientHeight : 1;
  target.scrollBy({ top: event.deltaY * step, behavior: 'smooth' });
}, { passive: true });
for (const field of ['mode','scope','fit','color','asset','opacity','dim']) {
  $(`background-${field}`).addEventListener('input', () => edit(() => { const value = $(`background-${field}`).value; draft.background[field === 'asset' ? 'assetId' : field] = ['opacity','dim'].includes(field) ? Number(value) / 100 : value || null; }));
}
for (const b of document.querySelectorAll('[data-state]')) b.addEventListener('click', () => { previewState = b.dataset.state; for (const item of document.querySelectorAll('[data-state]')) item.setAttribute('aria-pressed', String(item === b)); renderPreview(); });
$('restore').addEventListener('click', () => { draft = normalizeProfile(); drafts.set(key, structuredClone(draft)); fillControls(); message('已预览默认外观，点击右下角按钮完成恢复。'); });
/** The desktop switches asynchronously; wait until it reports the new companion. */
async function waitForDesktop(target) {
  for (let i = 0; i < 40; i++) {
    const result = await api.get();
    if (result?.ok && result.state.activeKey === target) return result;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  return { ok: false, error: '桌面伙伴没有响应，请稍后再试。' };
}
$('apply').addEventListener('click', async () => {
  if (draft.background.mode === 'image' && !draft.background.assetId) { message('请先选择背景图片。', true); return; }
  const target = key, name = character().name, dirty = isDirty(), switching = !onDesktop();
  if (dirty) {
    const result = await call(() => api.saveProfile({ key: target, profile: draft }));
    if (!result) return;
    drafts.delete(target); draft = normalizeProfile(result.state.profiles[target]); fillControls();
  }
  if (switching) {
    const switched = await call(async () => {
      const response = await api.activate(target);
      return response?.ok ? waitForDesktop(target) : response;
    });
    if (!switched) return;
  }
  message(switching ? `已换上${name}${dirty ? '，外观已应用' : ''}。` : '外观已应用到桌面伙伴。');
});
for (const role of ['appearance','background']) $(`import-${role}`).addEventListener('click', () => { importRole = role; $('image-file').click(); });
$('image-file').addEventListener('change', event => importFile(event.target.files[0]));
$('favorites-only').addEventListener('change', renderLibrary);
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); importRole = $('import-role').value; importFile(event.dataTransfer.files[0]); });
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
$('confirm-delete').addEventListener('click', async () => { $('delete-dialog').close(); const id = deleteId; await call(() => api.removeAsset(id), '图片已删除，使用它的角色与预设已恢复默认。'); await refresh(); });
$('save-preset').addEventListener('click', async () => {
  const name = $('preset-name').value.trim(); if (!name) { message('请给预设起一个名字。', true); $('preset-name').focus(); return; }
  const result = await call(() => api.savePreset({ name, profile: draft }), '预设已保存，可用于其他伙伴。'); if (result) $('preset-name').value = '';
});
$('import-preset').addEventListener('click', () => call(() => api.importPreset(), '预设已导入，点击「预览」查看搭配。'));
$('preview-image').addEventListener('error', () => {
  if ($('preview-image').getAttribute('src') !== character()?.sprites.idle) { $('preview-image').src = character()?.sprites.idle || ''; message('所选图片无法读取，当前显示默认形象。', true); }
});
api.onChanged(() => refresh().catch(error => message(error.message, true)));
refresh().catch(error => message(error.message, true));

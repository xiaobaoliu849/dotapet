// ==========================================================================
// Quick Phrases Editor — standalone window page (F6 Native Desktop
// Replacement). Lives outside the pet window so the 860px layout renders
// at full width instead of being crushed into the 300px pet HUD.
// ==========================================================================

const SIMPLIFIED_PRESETS = [
  { label: '【战术】快推中路别刷了', cn: '快推中路别刷了，一波带走', en: 'Push mid now, end the game.' },
  { label: '【战术】集合开雾打肉山', cn: '集合开雾打肉山，别单走', en: 'Smoke and rosh now, stick together.' },
  { label: '【战术】没买活稳点别送', cn: '没买活稳点，别单走送了', en: "No buyback, play safe and don't get caught." },
  { label: '【战术】TP救一下打反手', cn: 'TP救一下，反打他们！', en: 'TP help! Counter-initiate now!' },
  { label: '【战术】先手秒后排辅助', cn: '先手秒辅助，别集火前排', en: 'Focus backline supports first, ignore tank.' },
  { label: '【战术】控符！智慧符/赏金符', cn: '控符！智慧符和赏金符刷了', en: 'Check runes! Wisdom and bounty are up.' },
  { label: '【战术】守高地稳住等失误', cn: '守高地稳住，等他们失误', en: 'Defend high ground, wait for mistakes.' },
  { label: '【嘲讽】键盘拴条狗都比你强', cn: '键盘上拴条狗都比你玩得好', en: 'A dog on keyboard plays better than you.' },
  { label: '【嘲讽】超级兵都比你值钱', cn: '超级兵死了给钱，你死了只值举报', en: 'Mega creeps give gold, you only give reports.' },
  { label: '【嘲讽】野区采灵芝？出来打团', cn: '在野区采灵芝？出来打团', en: 'AFK jungle forever? Join the fight.' },
  { label: '【嘲讽】脑子不用可以捐了', cn: '脑子不用可以捐给有用的人', en: 'Donate your brain if you never use it.' },
  { label: '【嘲讽】退了吧四打五随便赢', cn: '你退了吧，四打五随便赢', en: 'Just abandon, 4v5 is easier without you.' },
  { label: '【嘲讽】买个眼插在天灵盖上', cn: '买个眼插你头上吧，一点视野都没有', en: 'Buy a ward and plant it on your head.' },
  { label: '【友善】打得漂亮兄弟们！', cn: '打得漂亮，兄弟们冲！', en: "Well played boys, let's keep going!" },
  { label: '【友善】我的我的技能放歪了', cn: '我的我的，这波技能放歪了', en: 'My bad, missed my skill timing.' },
];

let loadedPhrases = [];
let savedRevision = -1;
const dirtyBases = new Map();
let conflictRows = [];
// Inside the settings center there is no window of our own to close.
const embedded = document.documentElement.dataset.embedded === 'true';
// Rows edited here and not yet saved; a save in the other editor never replaces them.
const dirtyRows = new Set();
const rowRevisions = new Map();
let rowsGeneration = 0;
function touchRow(index) {
  index = Number(index);
  rowRevisions.set(index, (rowRevisions.get(index) || 0) + 1);
}
function updateDraftStatus() {
  const status = document.getElementById('phrases-draft-status');
  if (status) status.textContent = dirtyRows.size ? `${dirtyRows.size} 行有未保存改动${conflictRows.length ? '；存在保存冲突' : ''}` : '无未保存改动';
  btnSave.textContent = conflictRows.length ? '确认覆盖冲突并保存' : '💾 保存并生效';
}
function markDirty(index) {
  index = Number(index);
  if (!dirtyRows.has(index)) dirtyBases.set(index, { ...(loadedPhrases[index] || { cn: '', en: '' }) });
  dirtyRows.add(index);
  touchRow(index);
  updateDraftStatus();
}

const rowsContainer = document.getElementById('phrases-rows-container');
const btnImportPreset = document.getElementById('btn-import-preset');
const btnTranslateAll = document.getElementById('btn-translate-all-phrases');
const btnResetDefault = document.getElementById('btn-reset-default-phrases');
const btnSave = document.getElementById('btn-save-phrases');
const btnCancel = document.getElementById('btn-cancel-phrases');
const selectPresetTemplate = document.getElementById('select-preset-template');
const selectPresetTargetRow = document.getElementById('select-preset-target-row');
const hudToast = document.getElementById('hud-toast');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;
function showToast(message) {
  if (!hudToast) return;
  hudToast.textContent = message;
  hudToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hudToast.classList.add('hidden'), 2400);
}

function closeEditor() {
  if (!embedded) window.close();
}

// Hold both values and a revision: changing a row and changing it back also
// invalidates an older request. A reset creates new rows, invalidating all.
function snapshotRow(row) {
  const index = Number(row.dataset.index);
  return { row, index, generation: rowsGeneration, revision: rowRevisions.get(index) || 0,
    cn: row.querySelector('.phrase-cn').value, en: row.querySelector('.phrase-en').value };
}
function rowUnchanged(snapshot) {
  return rowsContainer.contains(snapshot.row) && snapshot.generation === rowsGeneration &&
    snapshot.revision === (rowRevisions.get(snapshot.index) || 0) &&
    snapshot.cn === snapshot.row.querySelector('.phrase-cn').value &&
    snapshot.en === snapshot.row.querySelector('.phrase-en').value;
}

function rememberSaved(state) {
  const phrases = Array.isArray(state) ? state : state?.phrases;
  if (!Array.isArray(phrases)) return false;
  const revision = state?.revision;
  if (Number.isInteger(revision)) {
    if (revision < savedRevision) return false;
    savedRevision = revision;
  }
  loadedPhrases = phrases.map(row => ({ cn: row?.cn || '', en: row?.en || '' }));
  return true;
}

function syncSavedRows() {
  rowsContainer?.querySelectorAll('.phrase-row-item').forEach((row) => {
    const index = Number(row.dataset.index);
    if (dirtyRows.has(index)) return;
    const phrase = loadedPhrases[index] || { cn: '', en: '' };
    const changed = row.querySelector('.phrase-cn').value !== phrase.cn || row.querySelector('.phrase-en').value !== phrase.en;
    if (changed) touchRow(index);
    row.querySelector('.phrase-cn').value = phrase.cn;
    row.querySelector('.phrase-en').value = phrase.en;
  });
}

function renderPhrasesRows(phrasesList = []) {
  if (!rowsContainer) return;
  rowsGeneration++;
  rowsContainer.innerHTML = '';

  for (let i = 0; i < 10; i++) {
    const phrase = phrasesList[i] || { cn: '', en: '' };
    const digitLabel = i === 9 ? '0' : String(i + 1);

    const rowEl = document.createElement('div');
    rowEl.className = 'phrase-row-item';
    rowEl.dataset.index = i;

    rowEl.innerHTML = `
      <div class="phrase-row-num">${digitLabel}</div>
      <input type="text" class="phrase-input phrase-cn" data-index="${i}" aria-label="第 ${digitLabel} 行中文短语" placeholder="输入中文短语 (局内 Ctrl+${digitLabel})" value="${escapeHtml(phrase.cn || '')}" />
      <input type="text" class="phrase-input phrase-en" data-index="${i}" aria-label="第 ${digitLabel} 行英文短语" placeholder="输入英文短语 (局内 Alt+${digitLabel})" value="${escapeHtml(phrase.en || '')}" />
      <div class="phrase-row-actions">
        <button class="btn-phrase-trans" data-index="${i}" title="使用设置中选择的翻译服务商翻译此行">⚡ 译</button>
        <button class="btn-phrase-copy" data-index="${i}" data-type="en" aria-label="复制第 ${digitLabel} 行英文短语" title="复制英文短语">复制英文</button>
        <button class="btn-phrase-copy" data-index="${i}" data-type="cn" aria-label="复制第 ${digitLabel} 行中文短语" title="复制中文短语">复制中文</button>
      </div>
    `;

    const btnTrans = rowEl.querySelector('.btn-phrase-trans');
    btnTrans?.addEventListener('click', async () => {
      const cnInput = rowEl.querySelector('.phrase-cn');
      const enInput = rowEl.querySelector('.phrase-en');
      const cnText = (cnInput?.value || '').trim();
      if (!cnText) {
        showToast('请先输入中文短语');
        return;
      }
      btnTrans.textContent = '...';
      btnTrans.disabled = true;
      const snapshot = snapshotRow(rowEl);
      try {
        const res = await window.electronAPI?.translatePhraseText?.(cnText);
        if (!rowUnchanged(snapshot)) {
          showToast('此行已有新改动，已保留；可重新翻译');
        } else if (res && res.translated) {
          enInput.value = res.translated;
          markDirty(i);
          showToast(`⚡ 第 ${digitLabel} 行 AI 翻译成功: "${res.translated}"`);
        } else {
          showToast('翻译返回为空');
        }
      } catch (err) {
        showToast(`翻译异常: ${err.message}`);
      } finally {
        btnTrans.textContent = '⚡ 译';
        btnTrans.disabled = false;
      }
    });

    rowEl.querySelectorAll('.btn-phrase-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const input = rowEl.querySelector(type === 'cn' ? '.phrase-cn' : '.phrase-en');
        const text = (input?.value || '').trim();
        if (text) {
          window.electronAPI?.copyToClipboard?.(text);
          showToast(`📋 已复制到剪贴板: "${text}"`);
        } else {
          showToast('内容为空');
        }
      });
    });

    rowsContainer.appendChild(rowEl);
  }
}

function populatePresetDropdown() {
  if (!selectPresetTemplate) return;
  selectPresetTemplate.innerHTML = '';
  SIMPLIFIED_PRESETS.forEach((preset, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${preset.label} → "${preset.cn}"`;
    selectPresetTemplate.appendChild(opt);
  });
}

function importSelectedPreset() {
  const presetIdx = parseInt(selectPresetTemplate?.value || '0', 10);
  const targetDigit = selectPresetTargetRow?.value || '1';
  const targetIndex = targetDigit === '0' ? 9 : parseInt(targetDigit, 10) - 1;

  if (presetIdx >= 0 && presetIdx < SIMPLIFIED_PRESETS.length) {
    const preset = SIMPLIFIED_PRESETS[presetIdx];
    const rowEl = rowsContainer?.querySelector(`.phrase-row-item[data-index="${targetIndex}"]`);
    if (rowEl) {
      const cnInput = rowEl.querySelector('.phrase-cn');
      const enInput = rowEl.querySelector('.phrase-en');
      if (cnInput) cnInput.value = preset.cn;
      if (enInput) enInput.value = preset.en;
      markDirty(targetIndex);
      showToast(`💡 已导入 ${preset.label} 到第 ${targetDigit} 行`);
    }
  }
}

async function translateAllEmptyRows() {
  if (!rowsContainer) return;
  const rowEls = rowsContainer.querySelectorAll('.phrase-row-item');
  let count = 0;
  let attempted = 0;
  let preserved = 0;
  btnTranslateAll.textContent = '⚡ AI 翻译中...';
  btnTranslateAll.disabled = true;

  try {
    for (const row of rowEls) {
      if (!rowsContainer.contains(row)) break;
      const cnInput = row.querySelector('.phrase-cn');
      const enInput = row.querySelector('.phrase-en');
      const cnText = (cnInput?.value || '').trim();
      const enText = (enInput?.value || '').trim();

      if (cnText && !enText) {
        const snapshot = snapshotRow(row);
        attempted++;
        const res = await window.electronAPI?.translatePhraseText?.(cnText);
        if (!rowUnchanged(snapshot)) {
          preserved++;
        } else if (res && res.translated) {
          enInput.value = res.translated;
          markDirty(row.dataset.index);
          count++;
        }
      }
    }
    showToast(preserved ? `已完成 ${count} 行翻译；${preserved} 行有新改动，已保留` :
      count ? `⚡ 已完成 ${count} 行智能翻译！` : attempted ? '翻译返回为空，请重试' : '没有需要补全的中文行');
  } catch (err) {
    showToast(`批量翻译异常: ${err.message}`);
  } finally {
    btnTranslateAll.textContent = '⚡ AI 补全空白英文';
    btnTranslateAll.disabled = false;
  }
}

function resetDefaultPhrases() {
  renderPhrasesRows(SIMPLIFIED_PRESETS.slice(0, 10));
  for (let i = 0; i < 10; i++) markDirty(i);
  showToast('🔄 已重置为精简模板 (确认无误后请点击保存)');
}

async function savePhrasesFromUI() {
  if (!rowsContainer || btnSave.disabled) return;
  const rowEls = rowsContainer.querySelectorAll('.phrase-row-item');
  const phrases = [];
  const snapshots = Array.from(rowEls, snapshotRow);
  const changedRows = [...dirtyRows];
  const basePhrases = snapshots.map(snapshot => ({ ...(dirtyBases.get(snapshot.index) ||
    loadedPhrases[snapshot.index] || { cn: '', en: '' }) }));

  rowEls.forEach((row) => {
    const cnInput = row.querySelector('.phrase-cn');
    const enInput = row.querySelector('.phrase-en');
    phrases.push({
      cn: (cnInput?.value || '').trim(),
      en: (enInput?.value || '').trim(),
    });
  });

  btnSave.disabled = true;
  try {
    const res = await window.electronAPI?.savePhrasesConfig?.({ phrases, changedRows, basePhrases });
    if (res && res.success) {
      rememberSaved({ phrases: res.phrases || phrases, revision: res.revision });
      for (const snapshot of snapshots) {
        if (!changedRows.includes(snapshot.index)) continue;
        if (rowUnchanged(snapshot)) {
          dirtyRows.delete(snapshot.index);
          dirtyBases.delete(snapshot.index);
        } else {
          // New edits made during this save are now based on our committed row.
          dirtyBases.set(snapshot.index, { ...(res.phrases?.[snapshot.index] || phrases[snapshot.index]) });
        }
      }
      conflictRows = [];
      syncSavedRows();
      updateDraftStatus();
      showToast(dirtyRows.size ? '💾 提交的短语已保存；新改动仍未保存，请再次保存' :
        '💾 快捷短语已保存并即时生效！可在局内按 Ctrl+1~0 / Alt+1~0');
    } else if (res?.conflicts?.length && res.phrases) {
      rememberSaved(res);
      conflictRows = res.conflicts;
      for (const index of conflictRows) dirtyBases.set(index, { ...res.phrases[index] });
      syncSavedRows();
      updateDraftStatus();
      showToast(`${res.error}；草稿已保留，再次保存会覆盖这些行`);
    } else {
      showToast(`保存失败: ${res?.error || '未知错误'}`);
    }
  } catch (err) {
    showToast(`保存异常: ${err.message}`);
  } finally {
    btnSave.disabled = false;
  }
}

async function init() {
  const actions = [btnImportPreset, btnTranslateAll, btnResetDefault, btnSave];
  actions.forEach(button => { if (button) button.disabled = true; });
  try {
    const config = await window.electronAPI?.getPhrasesConfig?.();
    rememberSaved(config);
  } catch (e) {
    console.warn('[Phrases] Failed to fetch config, using fallback:', e);
  }

  renderPhrasesRows(loadedPhrases);
  populatePresetDropdown();
  updateDraftStatus();
  actions.forEach(button => { if (button) button.disabled = false; });
}

rowsContainer?.addEventListener('input', (event) => {
  const row = event.target.closest?.('.phrase-row-item');
  if (row) markDirty(row.dataset.index);
});
// The other editor (F6 panel or settings page) saved: take its rows, except the ones being edited here.
window.electronAPI?.onPhrasesChanged?.((state) => {
  if (!rememberSaved(state)) return;
  syncSavedRows();
  if (dirtyRows.size) showToast('另一处保存的短语已同步；你正在改的行保持不变');
});
btnImportPreset?.addEventListener('click', () => importSelectedPreset());
btnTranslateAll?.addEventListener('click', () => translateAllEmptyRows());
btnResetDefault?.addEventListener('click', () => resetDefaultPhrases());
btnSave?.addEventListener('click', () => savePhrasesFromUI());
btnCancel?.addEventListener('click', () => closeEditor());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeEditor();
});

init();

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
  window.close();
}

function renderPhrasesRows(phrasesList = []) {
  if (!rowsContainer) return;
  rowsContainer.innerHTML = '';

  for (let i = 0; i < 10; i++) {
    const phrase = phrasesList[i] || { cn: '', en: '' };
    const digitLabel = i === 9 ? '0' : String(i + 1);

    const rowEl = document.createElement('div');
    rowEl.className = 'phrase-row-item';
    rowEl.dataset.index = i;

    rowEl.innerHTML = `
      <div class="phrase-row-num">${digitLabel}</div>
      <input type="text" class="phrase-input phrase-cn" data-index="${i}" placeholder="输入中文短语 (局内 Ctrl+${digitLabel})" value="${escapeHtml(phrase.cn || '')}" />
      <input type="text" class="phrase-input phrase-en" data-index="${i}" placeholder="输入英文短语 (局内 Alt+${digitLabel})" value="${escapeHtml(phrase.en || '')}" />
      <div class="phrase-row-actions">
        <button class="btn-phrase-trans" data-index="${i}" title="使用 Qwen-Flash 极速翻译此行">⚡ 译</button>
        <button class="btn-phrase-copy" data-index="${i}" data-type="en" title="复制英文短语">📋 EN</button>
        <button class="btn-phrase-copy" data-index="${i}" data-type="cn" title="复制中文短语">📋 CN</button>
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
      try {
        const res = await window.electronAPI?.translatePhraseText?.(cnText);
        if (res && res.translated) {
          enInput.value = res.translated;
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
      showToast(`💡 已导入 ${preset.label} 到第 ${targetDigit} 行`);
    }
  }
}

async function translateAllEmptyRows() {
  if (!rowsContainer) return;
  const rowEls = rowsContainer.querySelectorAll('.phrase-row-item');
  let count = 0;
  btnTranslateAll.textContent = '⚡ AI 翻译中...';
  btnTranslateAll.disabled = true;

  try {
    for (const row of rowEls) {
      const cnInput = row.querySelector('.phrase-cn');
      const enInput = row.querySelector('.phrase-en');
      const cnText = (cnInput?.value || '').trim();
      const enText = (enInput?.value || '').trim();

      if (cnText && !enText) {
        const res = await window.electronAPI?.translatePhraseText?.(cnText);
        if (res && res.translated) {
          enInput.value = res.translated;
          count++;
        }
      }
    }
    showToast(count > 0 ? `⚡ 已完成 ${count} 行智能翻译！` : '所有中文行已有英文翻译');
  } catch (err) {
    showToast(`批量翻译异常: ${err.message}`);
  } finally {
    btnTranslateAll.textContent = '⚡ 一键 AI 翻译补全 (Qwen-Flash)';
    btnTranslateAll.disabled = false;
  }
}

function resetDefaultPhrases() {
  renderPhrasesRows(SIMPLIFIED_PRESETS.slice(0, 10));
  showToast('🔄 已重置为精简模板 (确认无误后请点击保存)');
}

async function savePhrasesFromUI() {
  if (!rowsContainer) return;
  const rowEls = rowsContainer.querySelectorAll('.phrase-row-item');
  const phrases = [];

  rowEls.forEach((row) => {
    const cnInput = row.querySelector('.phrase-cn');
    const enInput = row.querySelector('.phrase-en');
    phrases.push({
      cn: (cnInput?.value || '').trim(),
      en: (enInput?.value || '').trim(),
    });
  });

  try {
    const res = await window.electronAPI?.savePhrasesConfig?.(phrases);
    if (res && res.success) {
      loadedPhrases = phrases;
      showToast('💾 快捷短语已保存并即时生效！可在局内按 Ctrl+1~0 / Alt+1~0');
      setTimeout(closeEditor, 900);
    } else {
      showToast(`保存失败: ${res?.error || '未知错误'}`);
    }
  } catch (err) {
    showToast(`保存异常: ${err.message}`);
  }
}

async function init() {
  try {
    const config = await window.electronAPI?.getPhrasesConfig?.();
    if (Array.isArray(config) && config.length > 0) {
      loadedPhrases = config;
    }
  } catch (e) {
    console.warn('[Phrases] Failed to fetch config, using fallback:', e);
  }

  renderPhrasesRows(loadedPhrases);
  populatePresetDropdown();
}

btnImportPreset?.addEventListener('click', () => importSelectedPreset());
btnTranslateAll?.addEventListener('click', () => translateAllEmptyRows());
btnResetDefault?.addEventListener('click', () => resetDefaultPhrases());
btnSave?.addEventListener('click', () => savePhrasesFromUI());
btnCancel?.addEventListener('click', () => closeEditor());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeEditor();
});

init();

const hub = window.controlCenter;
const items = [...document.querySelectorAll('.nav-item')];
const nativePages = { help: document.getElementById('page-help') };
const toggle = document.getElementById('sidebar-toggle');
let collapsed = new URLSearchParams(location.search).get('sidebar') === 'collapsed', narrow = false, sliding = false;
if (collapsed) { document.body.dataset.compact = 'true'; document.documentElement.style.setProperty('--sidebar', '64px'); }

function render(state) {
  if (!state) return;
  document.body.dataset.compact = String(Boolean(state.compact));
  collapsed = Boolean(state.collapsed); narrow = Boolean(state.narrow);
  const label = narrow ? '窗口较窄，侧栏已自动收起' : collapsed ? '展开侧栏' : '收起侧栏';
  toggle.title = label; toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-expanded', String(!state.compact));
  toggle.setAttribute('aria-disabled', String(narrow));
  // A running fold owns the width until its last frame.
  if (!sliding) document.documentElement.style.setProperty('--sidebar', `${state.sidebar}px`);
  document.documentElement.style.setProperty('--top', `${state.top}px`);
  for (const item of items) {
    item.hidden = !state.pages.includes(item.dataset.page);
    if (item.dataset.page === state.active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  for (const [page, element] of Object.entries(nativePages)) element.hidden = page !== state.active;
}

for (const item of items) {
  item.addEventListener('click', async () => {
    const response = await hub.navigate(item.dataset.page);
    if (response?.ok) render(response.state);
  });
}
const ease = t => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
/**
 * A fold runs on this document's display-synced frames: each frame sets the sidebar width here and
 * sends main the page view's edge. The two cannot land on exactly the same frame, so the sidebar's
 * edge stays tucked under the view: folding it trails the view by a few frames, unfolding it leads
 * by one, and no gap opens between them. Resizing follows the window edge at once, like the page view.
 */
function runSlide({ from, to, duration }) {
  const offset = to < from ? -48 : 16;
  let start = null, sent = from;
  const frame = now => {
    start ??= now;
    const elapsed = now - start;
    const x = elapsed >= duration ? to : Math.round(from + (to - from) * ease(elapsed / duration));
    if (x !== sent) hub.slide(sent = x);
    document.documentElement.style.setProperty('--sidebar', `${from + (to - from) * ease((elapsed + offset) / duration)}px`);
    if (elapsed < duration - Math.min(0, offset)) return requestAnimationFrame(frame);
    sliding = false;
    // The labels' fade may still be finishing.
    setTimeout(() => document.body.classList.remove('animating'), 80);
    hub.state().then(response => { if (response?.ok) render(response.state); });
  };
  requestAnimationFrame(frame);
}
// Not disabled when narrow, so the tooltip still explains why it does nothing.
// A click during a fold is ignored: the fold is short, and restarting it would jump.
toggle.addEventListener('click', async () => {
  if (narrow || sliding) return;
  // Set before asking: main announces the new state before it answers, and the labels fade with it.
  sliding = true;
  document.body.classList.add('animating');
  const response = await hub.setSidebarCollapsed(!collapsed).catch(() => null);
  if (!response?.slide) { sliding = false; setTimeout(() => document.body.classList.remove('animating'), 260); }
  if (response?.ok) render(response.state);
  if (response?.slide) runSlide(response.slide);
});
// Arrow keys move between pages, as in other Windows sidebars.
document.getElementById('sidebar').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const visible = items.filter(item => !item.hidden);
  const index = visible.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  visible[(index + (event.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length].focus();
});

// Each language is listed in its own name (left untranslated) so anyone can find theirs.
const languageSelect = document.getElementById('language');
const { choice = 'system', languages = [] } = window.dotapetI18n || {};
languageSelect.append(new Option('跟随系统', 'system'), ...languages.map(language => {
  const option = new Option(language.name, language.id);
  option.translate = false;
  return option;
}));
languageSelect.value = choice;
languageSelect.addEventListener('change', async () => {
  languageSelect.disabled = true;
  const response = await hub.setLanguage(languageSelect.value).catch(() => null);
  if (!response?.ok) { languageSelect.value = choice; languageSelect.disabled = false; }
});

hub.onState(render);
hub.state().then(response => { if (response?.ok) render(response.state); });

// --- Customizable Shortcuts Editor ---
const shortcutsEditor = document.getElementById('shortcuts-editor');
const resetShortcutsBtn = document.getElementById('btn-reset-shortcuts');
const shortcutsFeedback = document.getElementById('shortcuts-feedback');

let shortcutConfig = null;
let activeRecordingId = null;
let feedbackTimer = null;

function showFeedback(message, type = 'success') {
  if (!shortcutsFeedback) return;
  clearTimeout(feedbackTimer);
  shortcutsFeedback.textContent = message;
  shortcutsFeedback.className = `shortcuts-feedback ${type}`;
  shortcutsFeedback.hidden = false;
  feedbackTimer = setTimeout(() => {
    shortcutsFeedback.hidden = true;
  }, 3200);
}

function renderKbd(acc) {
  if (!acc) return '<span class="shortcut-unbound">未设置 (点击设置)</span>';
  return acc.split('+').map(part => `<kbd>${part}</kbd>`).join('+');
}

function renderShortcuts() {
  if (!shortcutsEditor || !shortcutConfig?.actions) return;
  shortcutsEditor.innerHTML = '';
  for (const action of shortcutConfig.actions) {
    const key = shortcutConfig.shortcuts?.[action.id] || '';
    const row = document.createElement('div');
    row.className = 'shortcut-row';

    const info = document.createElement('div');
    info.className = 'shortcut-info';
    info.innerHTML = `<span class="shortcut-label">${action.label}</span><span class="shortcut-desc">${action.description}</span>`;

    const control = document.createElement('div');
    control.className = 'shortcut-control';

    const isRec = activeRecordingId === action.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `shortcut-btn${isRec ? ' recording' : ''}${!key && !isRec ? ' disabled' : ''}`;
    btn.innerHTML = isRec ? '请按下按键...' : renderKbd(key);
    btn.title = isRec ? '正在录制，请按下组合键；按 Esc 取消' : '点击修改此快捷键';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeRecordingId === action.id) {
        cancelRecording();
      } else {
        startRecording(action.id);
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'shortcut-clear';
    clearBtn.title = '禁用 / 清除此快捷键';
    clearBtn.innerHTML = '×';
    clearBtn.disabled = !key;
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (activeRecordingId) cancelRecording();
      await updateShortcut(action.id, '');
    });

    control.appendChild(btn);
    control.appendChild(clearBtn);
    row.appendChild(info);
    row.appendChild(control);
    shortcutsEditor.appendChild(row);
  }
}

function cancelRecording() {
  activeRecordingId = null;
  window.removeEventListener('keydown', handleRecordingKeydown, true);
  window.removeEventListener('click', cancelRecording, true);
  renderShortcuts();
}

function startRecording(actionId) {
  activeRecordingId = actionId;
  renderShortcuts();
  window.addEventListener('keydown', handleRecordingKeydown, true);
  setTimeout(() => {
    window.addEventListener('click', cancelRecording, { once: true, capture: true });
  }, 50);
}

const SPECIAL_CODE_MAP = {
  Escape: 'Escape',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  PrintScreen: 'PrintScreen',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

function handleRecordingKeydown(e) {
  if (!activeRecordingId) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') {
    cancelRecording();
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    const target = activeRecordingId;
    cancelRecording();
    updateShortcut(target, '');
    return;
  }

  // Modifiers alone
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
    const btn = shortcutsEditor?.querySelector('.shortcut-btn.recording');
    if (btn) btn.innerHTML = `${mods.join('+')}+ ...`;
    return;
  }

  let baseKey = '';
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(e.key)) {
    baseKey = e.key.toUpperCase();
  } else if (e.code.startsWith('Key')) {
    baseKey = e.code.slice(3).toUpperCase();
  } else if (e.code.startsWith('Digit')) {
    baseKey = e.code.slice(5);
  } else if (e.code.startsWith('Numpad') && /^[0-9]$/.test(e.code.slice(6))) {
    baseKey = e.code.slice(6);
  } else if (SPECIAL_CODE_MAP[e.code]) {
    baseKey = SPECIAL_CODE_MAP[e.code];
  } else if (e.key && e.key.length === 1) {
    baseKey = e.key.toUpperCase();
  }

  if (!baseKey) return;

  const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(baseKey);
  const isSpecialStandalone = ['PrintScreen'].includes(baseKey);
  const hasModifiers = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;

  if (!hasModifiers && !isFKey && !isSpecialStandalone) {
    showFeedback('字母、数字与符号键必须搭配 Ctrl、Alt 或 Shift 组合使用', 'error');
    return;
  }

  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(baseKey);
  const accelerator = parts.join('+');

  const conflict = shortcutConfig?.actions?.find(
    a => a.id !== activeRecordingId && (shortcutConfig.shortcuts?.[a.id] || '').toLowerCase() === accelerator.toLowerCase()
  );

  if (conflict) {
    showFeedback(`快捷键「${accelerator}」已被「${conflict.label}」使用，请更换`, 'error');
    return;
  }

  const targetId = activeRecordingId;
  cancelRecording();
  updateShortcut(targetId, accelerator);
}

async function updateShortcut(actionId, accelerator) {
  if (!shortcutConfig || !hub?.saveShortcuts) return;
  const next = { ...shortcutConfig.shortcuts, [actionId]: accelerator };
  const res = await hub.saveShortcuts(next).catch(err => ({ ok: false, error: err.message }));
  if (res?.ok) {
    shortcutConfig.shortcuts = res.shortcuts;
    renderShortcuts();
    showFeedback(accelerator ? `已更新快捷键: ${accelerator}` : '已禁用该快捷键', 'success');
  } else {
    showFeedback(res?.error || '保存快捷键失败', 'error');
  }
}

if (resetShortcutsBtn) {
  resetShortcutsBtn.addEventListener('click', async () => {
    if (!hub?.resetShortcuts) return;
    const res = await hub.resetShortcuts().catch(err => ({ ok: false, error: err.message }));
    if (res?.ok) {
      shortcutConfig.shortcuts = res.shortcuts;
      renderShortcuts();
      showFeedback('已恢复所有默认快捷键', 'success');
    } else {
      showFeedback(res?.error || '重置快捷键失败', 'error');
    }
  });
}

if (hub?.getShortcuts) {
  hub.getShortcuts().then(res => {
    if (res?.ok) {
      shortcutConfig = res;
      renderShortcuts();
    }
  }).catch(() => {});

  if (hub?.onShortcutsChanged) {
    hub.onShortcutsChanged(data => {
      if (data?.shortcuts && shortcutConfig) {
        shortcutConfig.shortcuts = data.shortcuts;
        renderShortcuts();
      }
    });
  }
}

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
  document.getElementById('hub-version').textContent = state.version ? `· v${state.version}` : '';
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

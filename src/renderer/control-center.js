const hub = window.controlCenter;
const items = [...document.querySelectorAll('.nav-item')];
const nativePages = { help: document.getElementById('page-help') };
const toggle = document.getElementById('sidebar-toggle');
let collapsed = new URLSearchParams(location.search).get('sidebar') === 'collapsed', narrow = false;
if (collapsed) { document.body.dataset.compact = 'true'; document.documentElement.style.setProperty('--sidebar', '64px'); }

function render(state) {
  if (!state) return;
  document.body.dataset.compact = String(Boolean(state.compact));
  collapsed = Boolean(state.collapsed); narrow = Boolean(state.narrow);
  const label = narrow ? '窗口较窄，侧栏已自动收起' : collapsed ? '展开侧栏' : '收起侧栏';
  toggle.title = label; toggle.setAttribute('aria-label', label);
  toggle.querySelector('.nav-label').textContent = label;
  toggle.setAttribute('aria-expanded', String(!state.compact));
  toggle.setAttribute('aria-disabled', String(narrow));
  document.documentElement.style.setProperty('--sidebar', `${state.sidebar}px`);
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
// Not disabled when narrow, so the tooltip still explains why it does nothing.
toggle.addEventListener('click', async () => {
  if (narrow) return;
  const response = await hub.setSidebarCollapsed(!collapsed);
  if (response?.ok) render(response.state);
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

hub.onState(render);
hub.state().then(response => { if (response?.ok) render(response.state); });

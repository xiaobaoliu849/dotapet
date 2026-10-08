const hub = window.controlCenter;
const items = [...document.querySelectorAll('.nav-item')];
const nativePages = { phrases: document.getElementById('page-phrases'), help: document.getElementById('page-help') };

function render(state) {
  if (!state) return;
  document.body.dataset.compact = String(Boolean(state.compact));
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
// Arrow keys move between pages, as in other Windows sidebars.
document.getElementById('sidebar').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const visible = items.filter(item => !item.hidden);
  const index = visible.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  visible[(index + (event.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length].focus();
});

const openPhrases = document.getElementById('open-phrases');
openPhrases.addEventListener('click', async () => {
  const feedback = document.getElementById('phrases-feedback');
  openPhrases.disabled = true;
  try {
    const response = await hub.openPhrases();
    feedback.textContent = response?.ok ? '' : '面板没有打开，请按 F6 再试一次。';
  } catch { feedback.textContent = '面板没有打开，请按 F6 再试一次。'; }
  finally { openPhrases.disabled = false; }
});

hub.onState(render);
hub.state().then(response => { if (response?.ok) render(response.state); });

const $ = id => document.getElementById(id);
let state = { phase: 'idle' };
const views = {
  idle: ['保持新鲜', '让陪伴更好一点', '自动检查新版本，一键更新并重新打开桌宠。', '检查更新'],
  checking: ['正在检查', '看看有没有新版本', '正在连接发布页，请稍候。', '检查中…'],
  current: ['已是最新', '你的桌宠已准备好', '当前已是最新发布版本，继续享受陪伴吧。', '再次检查'],
  available: ['新版本已发布', '有一点新变化', '点击后下载并自动重启。关闭设置中心可保留下载，稍后安装。', '更新并重启'],
  downloading: ['正在下载', '马上就准备好了', '下载完成并校验后自动重启。关闭设置中心可稍后安装。', '正在下载…'],
  ready: ['已下载', '新版本准备好了', '更新包已校验，点击后安装并重新打开桌宠。', '安装并重启'],
  installing: ['正在安装', '很快再见', '桌宠将关闭，安装完成后自动重新打开。', '正在重启…'],
  error: ['暂时未完成', '稍后再试也没关系', '', '重试检查'],
  disabled: ['开发模式', '更新用于安装版', '请安装发布页上的 Windows 安装包，之后即可在应用内更新。', '查看安装包'],
};
function render(next) {
  state = next;
  const [badge, title, description, action] = views[state.phase] || views.idle;
  $('version').textContent = state.currentVersion ? `当前版本 v${state.currentVersion}` : '应用更新';
  $('badge').textContent = ['available', 'downloading', 'ready'].includes(state.phase) ? `新版本 v${state.version}` : badge;
  $('title').textContent = title;
  $('description').textContent = state.error || (state.phase === 'downloading' && !state.restartRequested ? '继续在后台下载，完成后由你决定何时安装。' : description);
  $('primary').textContent = action;
  $('primary').disabled = ['checking', 'downloading', 'installing'].includes(state.phase);
  $('download').hidden = !['downloading', 'ready'].includes(state.phase);
  $('progress').value = state.percent || 0;
  $('percent').textContent = `${Math.round(state.percent || 0)}% · 下载后会校验更新包`;
  $('postpone').hidden = state.phase !== 'downloading' || !state.restartRequested;
  $('details').hidden = !state.notes;
  $('notes').textContent = state.notes || '';
}
async function action(name) {
  try {
    const reply = await window.petUpdates.action(name);
    if (reply.state) render(reply.state);
    else if (!reply.ok) render({ ...state, phase: 'error', error: '暂时无法操作，请重新打开设置中心。' });
  } catch { render({ ...state, phase: 'error', error: '暂时无法操作，请重新打开设置中心。' }); }
}
$('primary').addEventListener('click', () => action(['available', 'ready'].includes(state.phase) ? 'install' : state.phase === 'disabled' ? 'releases' : 'check'));
$('postpone').addEventListener('click', () => action('postpone'));
$('releases').addEventListener('click', () => action('releases'));
$('github').addEventListener('click', () => action('github'));
// The QR is the last thing on the page; bring it into view when opened.
$('sponsor').addEventListener('toggle', event => { if (event.target.open) event.target.scrollIntoView({ block: 'end', behavior: 'smooth' }); });
window.petUpdates.onState(render);
action('state');

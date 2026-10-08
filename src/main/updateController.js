import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';
import { RELEASES_URL } from './updateService.js';

export function createUpdateController({ electron, service, rendererDirectory, icon, onState = () => {}, smokeTest = false }) {
  const { BrowserWindow, ipcMain, shell, Notification } = electron;
  const url = pathToFileURL(path.join(rendererDirectory, 'update.html')).href;
  let window = null;
  let notifiedVersion = '';
  let notification = null;
  function open() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return window; }
    const created = new BrowserWindow({
      width: 600, height: 610, minWidth: 500, minHeight: 540, icon,
      title: '刀塔宠物 · 应用更新', autoHideMenuBar: true, show: false, backgroundColor: '#f7f8f4',
      webPreferences: { preload: path.join(rendererDirectory, '../preload/update.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    window = created;
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.once('ready-to-show', () => { if (!smokeTest && !created.isDestroyed()) created.show(); });
    created.on('close', () => service.postpone());
    created.on('closed', () => { if (window === created) window = null; });
    created.loadFile(path.join(rendererDirectory, 'update.html'));
    if (['idle', 'current', 'error'].includes(service.state.phase)) void service.check();
    return created;
  }
  const publish = state => {
    if (window && !window.isDestroyed()) window.webContents.send('update:state', state);
    onState(state);
    if (!smokeTest && state.phase === 'available' && state.version !== notifiedVersion && Notification?.isSupported()) {
      notifiedVersion = state.version;
      try {
        notification = new Notification({ title: '刀塔宠物 有新版本', body: `v${state.version} 已发布，点击查看并一键更新。`, icon });
        notification.on('click', open);
        notification.show();
      } catch { /* The tray entry remains available when Windows suppresses notifications. */ }
    }
  };
  service.on('state', publish);
  ipcMain.handle('update:action', async (event, action) => {
    if (!isTrustedSettingsSender(event, window, url)) return { ok: false };
    if (action === 'state') return { ok: true, state: service.snapshot() };
    if (action === 'check') void service.check();
    else if (action === 'install') void service.updateAndRestart();
    else if (action === 'postpone') service.postpone();
    else if (action === 'releases') {
      try { await shell.openExternal(RELEASES_URL); } catch { return { ok: false }; }
    } else return { ok: false };
    return { ok: true, state: service.snapshot() };
  });
  return { open, dispose() { service.off('state', publish); service.dispose(); notification?.close(); ipcMain.removeHandler('update:action'); } };
}

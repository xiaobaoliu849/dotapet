import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';
import { RELEASES_URL } from './updateService.js';

/** The updater is the settings center's 关于与更新 page; `hub` hosts it. */
export function createUpdateController({ electron, service, rendererDirectory, hub, icon, onState = () => {}, smokeTest = false }) {
  const { ipcMain, shell, Notification } = electron;
  const url = pathToFileURL(path.join(rendererDirectory, 'update.html')).href;
  const page = () => hub.contents('update');
  let notifiedVersion = '';
  let notification = null;
  hub.register('update', {
    file: 'update.html', preload: '../preload/update.js', background: '#f7f8f4', backgroundThrottling: false,
    // Visiting the page asks for a fresh answer; concurrent checks are coalesced.
    onShow() { if (['idle', 'current', 'error'].includes(service.state.phase)) void service.check(); },
    // Closing the settings center means "later": keep a download, never restart unasked.
    onHubClose() { service.postpone(); },
  });
  function open() { return hub.open('update'); }
  const publish = state => {
    page()?.send('update:state', state);
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
    if (!isTrustedSettingsSender(event, page(), url)) return { ok: false };
    if (action === 'state') return { ok: true, state: service.snapshot() };
    if (action === 'check') void service.check();
    else if (action === 'install') void service.updateAndRestart();
    else if (action === 'postpone') service.postpone();
    else if (action === 'releases') {
      try { await shell.openExternal(RELEASES_URL); } catch { return { ok: false }; }
    } else return { ok: false };
    return { ok: true, state: service.snapshot() };
  });
  return { open, dispose() {
    service.off('state', publish); service.dispose(); notification?.close();
    ipcMain.removeHandler('update:action'); hub.unregister('update');
  } };
}

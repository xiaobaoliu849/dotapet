import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { UpdateService } from './updateService.js';
import { createUpdateController } from './updateController.js';
import { captureHub, pageLoaded } from './controlCenterSmoke.js';

/** Real settings page/preload/IPC, simulated release server; never install or restart in smoke mode. */
export async function runUpdateSmoke({ electron, rendererDirectory, controlCenter, icon, outputDirectory }) {
  const updater = new EventEmitter();
  let installs = 0, downloads = 0, finishDownload;
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.3.0', releaseNotes: '更轻松地设置语音\n改善桌宠陪伴体验' });
  };
  updater.downloadUpdate = () => new Promise(resolve => {
    downloads++;
    updater.emit('download-progress', { percent: 42 });
    finishDownload = () => { updater.emit('update-downloaded', { version: '0.3.0' }); resolve(); };
  });
  updater.quitAndInstall = () => { installs++; };
  const service = new UpdateService({ updater, currentVersion: electron.app.getVersion(), enabled: true });
  const controller = createUpdateController({ electron, service, rendererDirectory, hub: controlCenter, icon, smokeTest: true });
  let win = controller.open();
  let page = controlCenter.contents('update');
  if (win !== controlCenter.window || !page) throw new Error('Updater did not open as a settings page');
  await pageLoaded(win.webContents);
  await win.webContents.executeJavaScript(`(async () => {
    const item = document.querySelector('.nav-item[data-page=update]');
    for (let i=0; i<100 && item.getAttribute('aria-current') !== 'page'; i++) await new Promise(r=>setTimeout(r,20));
    if (item.hidden || item.getAttribute('aria-current') !== 'page') throw new Error('Sidebar does not show the update page');
    // Occasional: pinned to the bottom of the sidebar, below the everyday pages.
    const sidebar = document.getElementById('sidebar').getBoundingClientRect();
    const help = document.querySelector('.nav-item[data-page=help]').getBoundingClientRect();
    if (sidebar.bottom - item.getBoundingClientRect().bottom > 16 || item.getBoundingClientRect().top - help.bottom < 40) throw new Error('Update entry is not at the bottom of the sidebar');
  })()`);
  const ready = async () => {
    await pageLoaded(page);
    await page.executeJavaScript(`(async () => {
      for (let i=0;i<100&&!document.getElementById('badge').textContent.includes('0.3.0');i++) await new Promise(r=>setTimeout(r,20));
      if(document.getElementById('primary').textContent!=='更新并重启') throw new Error('Missing one-click update action');
      if('getAISettings' in window.petUpdates) throw new Error('Updater exposes vault');
    })()`);
  };
  const capture = async name => {
    await page.capturePage();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(outputDirectory, name), (await page.capturePage()).toPNG());
  };
  try {
    await ready();
    await capture('update-available.png');
    fs.writeFileSync(path.join(outputDirectory, 'update-sidebar.png'), (await captureHub(controlCenter, electron.nativeImage)).toPNG());
    await page.executeJavaScript(`document.getElementById('primary').click(); document.getElementById('primary').click();`);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (downloads !== 1 || installs) throw new Error('Updater duplicated download or installed early');
    await page.executeJavaScript(`if(document.getElementById('progress').value!==42||!document.getElementById('primary').disabled) throw new Error('Download progress missing');`);
    await capture('update-downloading.png');
    const pending = service.downloading;
    const closed = new Promise(resolve => win.once('closed', resolve));
    win.close();
    if (service.state.restartRequested) throw new Error('Close did not defer restart');
    finishDownload(); await pending;
    await closed;
    if (service.state.phase !== 'ready' || installs) throw new Error('Deferred download installed');
    win = controller.open(); page = controlCenter.contents('update');
    await pageLoaded(page);
    await page.executeJavaScript(`(async () => {
      for(let i=0;i<100&&document.getElementById('primary').textContent!=='安装并重启';i++) await new Promise(r=>setTimeout(r,20));
      if(document.getElementById('primary').textContent!=='安装并重启') throw new Error('Deferred install action missing');
      if(document.documentElement.scrollWidth>innerWidth||document.getElementById('primary').getBoundingClientRect().bottom>innerHeight) throw new Error('Update page overflows');
    })()`);
    await capture('update-ready.png');
    // The settings center's minimum size; the page sits beside the compact sidebar.
    win.setSize(620, 640);
    await new Promise(resolve => setTimeout(resolve, 150));
    await page.executeJavaScript(`if(document.documentElement.scrollWidth>innerWidth||document.getElementById('primary').getBoundingClientRect().bottom>innerHeight) throw new Error('Narrow update page overflows');`);
    await page.executeJavaScript(`document.getElementById('primary').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (installs !== 1) throw new Error('Install command did not reach updater');
    service.fail(new Error('SHA512 mismatch'));
    await page.executeJavaScript(`(async () => {
      for(let i=0;i<100&&!document.getElementById('description').textContent.includes('校验失败');i++) await new Promise(r=>setTimeout(r,20));
      if(document.getElementById('primary').textContent!=='重试检查') throw new Error('Updater lacks retry');
    })()`);
    await capture('update-error.png');
    return { progress: true, deferredRestart: true, singleDownload: true, simulatedInstall: installs, noNetwork: true };
  } finally { if (!win?.isDestroyed()) win?.close(); controller.dispose(); }
}

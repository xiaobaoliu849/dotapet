import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { UpdateService } from './updateService.js';
import { createUpdateController } from './updateController.js';

/** Real window/preload/IPC, simulated release server; never install or restart in smoke mode. */
export async function runUpdateSmoke({ electron, rendererDirectory, icon, outputDirectory }) {
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
  const controller = createUpdateController({ electron, service, rendererDirectory, icon, smokeTest: true });
  let win = controller.open();
  const ready = async () => {
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await win.webContents.executeJavaScript(`(async () => {
      for (let i=0;i<100&&!document.getElementById('badge').textContent.includes('0.3.0');i++) await new Promise(r=>setTimeout(r,20));
      if(document.getElementById('primary').textContent!=='更新并重启') throw new Error('Missing one-click update action');
      if('getAISettings' in window.petUpdates) throw new Error('Updater exposes vault');
    })()`);
  };
  const capture = async name => {
    await win.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(outputDirectory, name), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await ready();
    await capture('update-available.png');
    await win.webContents.executeJavaScript(`document.getElementById('primary').click(); document.getElementById('primary').click();`);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (downloads !== 1 || installs) throw new Error('Updater duplicated download or installed early');
    await win.webContents.executeJavaScript(`if(document.getElementById('progress').value!==42||!document.getElementById('primary').disabled) throw new Error('Download progress missing');`);
    await capture('update-downloading.png');
    const pending = service.downloading;
    const closed = new Promise(resolve => win.once('closed', resolve));
    win.close();
    if (service.state.restartRequested) throw new Error('Close did not defer restart');
    finishDownload(); await pending;
    await closed;
    if (service.state.phase !== 'ready' || installs) throw new Error('Deferred download installed');
    win = controller.open();
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await win.webContents.executeJavaScript(`(async () => {
      for(let i=0;i<100&&document.getElementById('primary').textContent!=='安装并重启';i++) await new Promise(r=>setTimeout(r,20));
      if(document.getElementById('primary').textContent!=='安装并重启') throw new Error('Deferred install action missing');
      if(document.documentElement.scrollWidth>innerWidth||document.getElementById('primary').getBoundingClientRect().bottom>innerHeight) throw new Error('Update page overflows');
    })()`);
    await capture('update-ready.png');
    win.setSize(500, 540);
    await new Promise(resolve => setTimeout(resolve, 150));
    await win.webContents.executeJavaScript(`if(document.documentElement.scrollWidth>innerWidth||document.getElementById('primary').getBoundingClientRect().bottom>innerHeight) throw new Error('Narrow update page overflows');`);
    await win.webContents.executeJavaScript(`document.getElementById('primary').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (installs !== 1) throw new Error('Install command did not reach updater');
    service.fail(new Error('SHA512 mismatch'));
    await win.webContents.executeJavaScript(`(async () => {
      for(let i=0;i<100&&!document.getElementById('description').textContent.includes('校验失败');i++) await new Promise(r=>setTimeout(r,20));
      if(document.getElementById('primary').textContent!=='重试检查') throw new Error('Updater lacks retry');
    })()`);
    await capture('update-error.png');
    return { progress: true, deferredRestart: true, singleDownload: true, simulatedInstall: installs, noNetwork: true };
  } finally { win?.close(); controller.dispose(); }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { UpdateService, updateError } from '../src/main/updateService.js';
import { createUpdateController } from '../src/main/updateController.js';

function fixture(enabled = true) {
  const updater = new EventEmitter();
  let checks = 0, downloads = 0, installs = 0;
  updater.checkForUpdates = async () => {
    checks++; updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.2.1', releaseNotes: '<p>A better pet</p>' });
  };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 58 }); updater.emit('update-downloaded', { version: '0.2.1' }); };
  updater.quitAndInstall = (...args) => { assert.deepEqual(args, [true, true]); installs++; };
  const service = new UpdateService({ updater, enabled, currentVersion: '0.2.0' });
  return { updater, service, counts: () => ({ checks, downloads, installs }) };
}

test('background checks never download; one click verifies and requests one silent install with relaunch', async () => {
  const { updater, service, counts } = fixture();
  await Promise.all([service.check(), service.check()]);
  assert.deepEqual(counts(), { checks: 1, downloads: 0, installs: 0 });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(service.state.notes, 'A better pet');
  await Promise.all([service.updateAndRestart(), service.updateAndRestart(), service.check()]);
  assert.deepEqual(counts(), { checks: 1, downloads: 1, installs: 1 });
  await service.updateAndRestart();
  assert.equal(counts().installs, 1);
});

test('postponing during download keeps verified package ready without restarting', async () => {
  const { updater, service, counts } = fixture();
  let finish;
  updater.downloadUpdate = () => new Promise(resolve => { finish = () => { updater.emit('update-downloaded', { version: '0.2.1' }); resolve(); }; });
  await service.check();
  const pending = service.updateAndRestart();
  await Promise.resolve();
  service.postpone();
  finish(); await pending;
  assert.equal(service.state.phase, 'ready');
  assert.equal(counts().installs, 0);
  await service.check();
  assert.equal(service.state.phase, 'ready');
  await service.updateAndRestart();
  assert.equal(counts().installs, 1);
});

test('checksum failure never installs; retry checks again before downloading', async () => {
  const { updater, service, counts } = fixture();
  await service.check();
  updater.downloadUpdate = async () => { throw new Error('SHA512 checksum mismatch'); };
  await service.updateAndRestart();
  assert.equal(service.state.phase, 'error');
  assert.match(service.state.error, /校验失败/);
  assert.equal(service.state.restartRequested, false);
  assert.equal(counts().installs, 0);
  await service.updateAndRestart();
  assert.equal(counts().installs, 0);
  await service.check();
  assert.equal(service.state.phase, 'available');
});

test('download resolving without a verified event never invokes installer', async () => {
  const { updater, service, counts } = fixture();
  updater.downloadUpdate = async () => {};
  await service.check(); await service.updateAndRestart();
  assert.equal(counts().installs, 0);
  assert.equal(service.state.phase, 'error');
});

test('offline and unpublished release errors are readable and do not expose request details', async () => {
  const { updater, service, counts } = fixture();
  updater.checkForUpdates = async () => { throw new Error('ECONNRESET https://secret:token@example.com'); };
  await service.check();
  assert.equal(service.state.phase, 'error');
  assert.match(service.state.error, /网络/);
  assert.ok(!service.state.error.includes('token'));
  assert.match(updateError({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }), /发布页/);
  assert.equal(counts().installs, 0);
});

test('development sessions never check or install and disposal clears scheduled checks', async () => {
  const { service, counts } = fixture(false);
  service.start(); await service.check(); await service.updateAndRestart();
  assert.equal(service.state.phase, 'disabled');
  assert.deepEqual(counts(), { checks: 0, downloads: 0, installs: 0 });
  const normal = fixture(); normal.service.start();
  assert.ok(normal.service.startupTimer); assert.ok(normal.service.interval);
  normal.service.dispose();
  assert.equal(normal.updater.listenerCount('update-available'), 0);
});

test('update commands require exact local top-level window and closing it postpones restart', async () => {
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = () => {}; }
    isDestroyed() { return false; }
    loadFile(file) { this.webContents.mainFrame.url = new URL(`file:///${file.replaceAll('\\', '/')}`).href; }
  }
  let handler;
  const { service } = fixture(false);
  const controller = createUpdateController({ service, rendererDirectory: 'D:/Projects/dotapet/src/renderer', smokeTest: true, electron: {
    BrowserWindow: Window, ipcMain: { handle(_channel, value) { handler = value; }, removeHandler() {} }, shell: { openExternal() { throw new Error('must not open'); } },
  } });
  const win = controller.open();
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal((await handler(event, 'state')).ok, true);
  assert.equal((await handler({ ...event, senderFrame: { url: event.senderFrame.url } }, 'install')).ok, false);
  assert.equal((await handler({ ...event, sender: {} }, 'install')).ok, false);
  assert.equal((await handler(event, 'https://example.com')).ok, false);
  service.publish({ restartRequested: true });
  win.emit('close');
  assert.equal(service.state.restartRequested, false);
  controller.dispose();
});

test('release workflow publishes updater metadata with installer and publishes a production channel', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const builder = fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/^\s+release\/latest.yml$/gm) || []).length, 2);
  assert.equal((workflow.match(/release\/\*\.blockmap/g) || []).length, 2);
  assert.match(workflow, /prerelease: false/);
  assert.match(builder, /provider: github/);
  assert.match(builder, /deleteAppDataOnUninstall: false/);
});

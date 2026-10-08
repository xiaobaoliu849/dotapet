import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';

export class WelcomeStore {
  constructor(directory) {
    this.filePath = path.join(directory, 'welcome.json');
    this.state = { dismissed: false };
    if (fs.existsSync(this.filePath)) {
      // Preserve a damaged file; never overwrite it at startup.
      try { this.state.dismissed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')).dismissed === true; }
      catch { this.state.dismissed = true; }
    }
  }
  dismiss(version) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ dismissed: true, version }, null, 2));
    fs.renameSync(temporary, this.filePath);
    this.state.dismissed = true;
  }
}

export function createWelcomeController({ electron, rendererDirectory, icon, openSettings, openCustomization, getMainWindow, smokeTest }) {
  const { app, BrowserWindow, ipcMain, shell } = electron;
  const store = new WelcomeStore(app.getPath('userData'));
  const url = pathToFileURL(path.join(rendererDirectory, 'welcome.html')).href;
  let window = null;
  const dismiss = () => store.dismiss(app.getVersion());
  function open() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return window; }
    window = new BrowserWindow({
      width: 760, height: 730, minWidth: 620, minHeight: 650, icon,
      title: '刀塔Pet · 欢迎', autoHideMenuBar: true, show: false,
      backgroundColor: '#faf6ef',
      webPreferences: { preload: path.join(rendererDirectory, '../preload/welcome.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.once('ready-to-show', () => { if (!smokeTest) window?.show(); });
    window.on('closed', () => {
      window = null;
      try { dismiss(); } catch (error) { console.warn('[Welcome] Could not save preference:', error.message); }
    });
    window.loadFile(path.join(rendererDirectory, 'welcome.html'));
    return window;
  }
  ipcMain.handle('welcome:action', async (event, action) => {
    if (!isTrustedSettingsSender(event, window, url)) return { ok: false, error: '请从欢迎窗口操作。' };
    try {
      if (action === 'info') return { ok: true, version: app.getVersion() };
      if (action === 'settings') openSettings();
      else if (action === 'mic-privacy') await shell.openExternal('ms-settings:privacy-microphone');
      else if (action === 'customize') openCustomization();
      else if (action === 'finish') {
        dismiss();
        const pet = getMainWindow();
        pet?.show();
        window.close();
      } else return { ok: false, error: '未知操作。' };
      return { ok: true };
    } catch { return { ok: false, error: '暂时无法完成，请重试。' }; }
  });
  // First launch goes straight to the actual setup, without a separate wizard.
  // The guide stays available from the tray whenever the user wants help.
  return { open, store, showOnFirstRun() { if (!store.state.dismissed) return openSettings('voice', { firstRun: true }); } };
}

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';
import { BlackCaptureError, isMostlyBlack, normalizeRegion } from './chatCapture.js';

/**
 * Alt+Shift+T: freeze the screen, show it full size on the game's display and
 * let the player drag a box around the chat. Only the box, relative to the
 * display, is kept; the screenshot itself is never saved.
 */
export function createChatRegionPicker({ electron, rendererDirectory, chatCapture, saveRegion, notify = () => {} }) {
  const { BrowserWindow, ipcMain } = electron;
  const file = path.join(rendererDirectory, 'chat-region.html');
  const url = pathToFileURL(file).href;
  let window = null;
  let image = null;

  const alive = () => Boolean(window && !window.isDestroyed());
  const trusted = event => isTrustedSettingsSender(event, window, url);
  ipcMain.handle('chat-region:load', event => trusted(event) ? { image, region: chatCapture.region() } : null);
  ipcMain.handle('chat-region:finish', (event, value) => {
    if (!trusted(event)) return { ok: false };
    const region = value === null ? null : normalizeRegion(value);
    if (region) {
      saveRegion(region);
      notify({ original: '', meaningZh: '✅ 聊天区域已保存。回到 DOTA 2 后按 Alt+T 即可直接翻译聊天。', intent: 'info', suggestions: [] });
    }
    window.close();
    return { ok: true };
  });

  return {
    async open() {
      if (alive()) { window.focus(); return; }
      let display;
      try {
        const captured = await chatCapture.captureDisplay();
        if (isMostlyBlack(captured.image.toBitmap())) throw new BlackCaptureError();
        display = captured.display;
        image = captured.image.toDataURL();
      } catch (err) {
        notify({ original: '', meaningZh: `❌ ${err.message}`, intent: 'info', suggestions: [] });
        return;
      }
      window = new BrowserWindow({
        // Fullscreen on the game's display, so the frozen screenshot maps 1:1 onto it (taskbar included).
        ...display.bounds, frame: false, fullscreen: true, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#000000',
        webPreferences: { preload: path.join(rendererDirectory, '../preload/chat-region.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      const created = window;
      created.setAlwaysOnTop(true, 'screen-saver');
      created.webContents.on('will-navigate', event => event.preventDefault());
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      created.once('ready-to-show', () => { created.show(); created.focus(); });
      created.on('blur', () => { if (!created.isDestroyed()) created.close(); });
      created.on('closed', () => { if (window === created) { window = null; image = null; } });
      created.loadFile(file);
    },
    close() { if (alive()) window.close(); },
  };
}

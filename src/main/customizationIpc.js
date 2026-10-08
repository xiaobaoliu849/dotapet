import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CustomizationStore } from './customizationStore.js';
import { classifySkin, validCharacterKey } from '../services/appearance.js';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';

/** The editor is the settings center's 形象与背景 page; `hub` hosts it. */
export function createCustomizationController({ electron, rendererDirectory, hub, getMainWindow, getHeroesConfig, getCompanionHero, getActiveKey }) {
  const { app, ipcMain, dialog, nativeImage } = electron;
  const editorURL = pathToFileURL(path.join(rendererDirectory, 'customize.html')).href;
  const desktopURL = pathToFileURL(path.join(rendererDirectory, 'index.html')).href;
  const store = new CustomizationStore(app.getPath('userData'), {
    validateImage(bytes, mime) {
      if (mime === 'image/svg+xml') return;
      // nativeImage decodes PNG/JPEG. Animated formats are decoded by Chromium
      // in the editor; read their canvas sizes here without flattening frames.
      if (mime === 'image/gif' || mime === 'image/webp') {
        let width = 0, height = 0;
        if (mime === 'image/gif' && bytes.length >= 13) {
          width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
        } else if (bytes.length >= 30 && bytes.subarray(12, 16).toString() === 'VP8X') {
          width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1;
        } else if (bytes.length >= 30 && bytes.subarray(12, 16).toString() === 'VP8 ') {
          width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
        } else if (bytes.length >= 25 && bytes.subarray(12, 16).toString() === 'VP8L') {
          width = 1 + ((bytes[21] | bytes[22] << 8) & 0x3fff);
          height = 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 0x3fff);
        }
        if (!width || !height || width > 8192 || height > 8192) throw new Error('动图无法读取，或尺寸超过 8192 像素。');
        return;
      }
      const image = nativeImage.createFromBuffer(bytes);
      const size = image.getSize();
      if (image.isEmpty() || size.width > 8192 || size.height > 8192) throw new Error('图片无法读取，或尺寸超过 8192 像素。');
    },
  });
  const editor = () => hub?.contents('appearance') || null;
  hub?.register('appearance', { file: 'customize.html', preload: '../preload/customize.js', background: '#faf6ef' });
  const assetURL = src => !src || /^(https?:|data:|file:)/.test(src) ? src : pathToFileURL(path.join(rendererDirectory, src)).href;
  const sprites = value => Object.fromEntries(Object.entries(value || {}).map(([key, src]) => [key, assetURL(src)]));
  function characters() {
    const heroes = [getCompanionHero(), ...Object.values(getHeroesConfig()?.heroes || {})].filter(Boolean).map(hero => ({
      key: `hero:${hero.id}`, name: hero.nameZh || hero.nameEn, themeColor: hero.themeColor,
      sprites: sprites(hero.sprites || { idle: hero.photoUrl }),
      // Generated catalog placeholders have neither bespoke artwork nor a specific identity.
      options: Object.values(hero.skins || {}).filter(skin => skin.id !== 'classic' && !/_(immortal_masterpiece|collectors_cache|ti_championship_set)$/.test(skin.id)).map(skin => ({
        id: skin.id, name: skin.nameZh || skin.name || skin.id, kind: classifySkin(hero, skin),
        themeColor: skin.themeColor || hero.themeColor, sprites: sprites(skin.sprites),
      })),
    }));
    const pets = fs.readdirSync(path.join(rendererDirectory, 'assets/pets'), { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(rendererDirectory, 'assets/pets', entry.name, 'pet.json'), 'utf8'));
        const src = state => {
          const definition = manifest.states?.[state] || manifest.states?.idle;
          return assetURL(`assets/pets/${entry.name}/${definition.svg || definition.image || definition.frames?.[0]}`);
        };
        return [{ key: `pet:${manifest.name}`, name: manifest.displayName, themeColor: manifest.themeColor,
          sprites: { idle: src('idle'), speaking: src('speak'), action: src('special') }, options: [] }];
      } catch (error) { console.warn('[Customize] Pet catalog:', error.message); return []; }
    });
    return [...pets, ...heroes];
  }
  function snapshot() { return { ...store.snapshot(), activeKey: getActiveKey(), characters: characters() }; }
  function publish() {
    const desktop = getMainWindow();
    if (desktop && !desktop.isDestroyed()) desktop.webContents.send('customization:changed');
    editor()?.send('customization:changed');
  }
  function open() { return hub.open('appearance'); }
  // File dialogs stay attached to the settings center while it is open.
  const withParent = (method, options) => hub?.window ? dialog[method](hub.window, options) : dialog[method](options);
  const handler = (operation, desktopAllowed = false) => async (event, payload) => {
    const trusted = isTrustedSettingsSender(event, editor(), editorURL)
      || (desktopAllowed && isTrustedSettingsSender(event, getMainWindow(), desktopURL));
    if (!trusted) return { ok: false, error: '此窗口无权访问自定义设置。' };
    try { return { ok: true, ...await operation(payload) }; }
    catch (error) { return { ok: false, error: error.message }; }
  };
  const changed = operation => async payload => { const result = await operation(payload); publish(); return { state: snapshot(), ...result }; };
  ipcMain.handle('customization:open', handler(() => { open(); return {}; }, true));
  ipcMain.handle('customization:get', handler(() => ({ state: snapshot() }), true));
  ipcMain.handle('customization:migrate', handler(changed(entries => ({ warnings: store.migrateLegacy(Array.isArray(entries) ? entries.map(entry => ({
    ...entry, themeColor: getHeroesConfig()?.heroes?.[entry.heroId]?.skins?.[entry.activeSkinId]?.themeColor,
    builtinId: classifySkin(getHeroesConfig()?.heroes?.[entry.heroId] || {}, getHeroesConfig()?.heroes?.[entry.heroId]?.skins?.[entry.activeSkinId]) === 'appearance' ? entry.activeSkinId : null,
  })) : entries) })), true));
  ipcMain.handle('customization:import-image', handler(changed(payload => ({ asset: store.importImage(payload) }))));
  ipcMain.handle('customization:save-profile', handler(changed(payload => {
    if (!characters().some(character => character.key === payload?.key)) throw new Error('角色不存在。');
    store.saveProfile(payload.key, payload.profile);
  })));
  ipcMain.handle('customization:activate', handler(payload => {
    if (!validCharacterKey(payload) || !characters().some(character => character.key === payload)) throw new Error('角色不存在。');
    getMainWindow()?.webContents.send('customization:activate', payload);
    return {};
  }));
  ipcMain.handle('customization:update-asset', handler(changed(payload => store.updateAsset(payload.id, payload.changes || {}))));
  ipcMain.handle('customization:remove-asset', handler(changed(id => store.removeAsset(id))));
  ipcMain.handle('customization:save-preset', handler(changed(payload => ({ preset: store.savePreset(payload.name, payload.profile) }))));
  ipcMain.handle('customization:remove-preset', handler(changed(id => store.removePreset(id))));
  ipcMain.handle('customization:export-preset', handler(async id => {
    const bundle = store.exportPreset(id);
    const selected = await withParent('showSaveDialog', { title: '导出外观预设', defaultPath: 'companion-preset.json', filters: [{ name: '伙伴外观预设', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return { cancelled: true };
    fs.writeFileSync(selected.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    return {};
  }));
  ipcMain.handle('customization:import-preset', handler(async () => {
    const selected = await withParent('showOpenDialog', { title: '导入外观预设', properties: ['openFile'], filters: [{ name: '伙伴外观预设', extensions: ['json'] }] });
    if (selected.canceled) return { cancelled: true };
    if (fs.statSync(selected.filePaths[0]).size > 40 * 1024 * 1024) throw new Error('预设文件不能超过 40 MB。');
    const preset = store.importPreset(JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf8')));
    publish();
    return { state: snapshot(), preset };
  }));
  return { open, publish, snapshot, store };
}

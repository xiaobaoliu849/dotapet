import electron from 'electron';
const { app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage, screen, powerMonitor, safeStorage, dialog, session, shell } = electron;
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { registerShortcuts, unregisterShortcuts } from './shortcuts.js';
import { VoiceSpiritClient } from '../services/voiceSpiritClient.js';
import { FREE_CHAT_HERO_ID } from '../services/cloudVoiceEngine.js';
import { buildPetPseudoHero } from '../services/petPersona.js';
import { AhkMigratedEngine } from './ahkMigratedEngine.js';
import { DesktopRoamEngine } from './roamEngine.js';
import { GSIServer } from './gsi/gsiServer.js';
import { checkGsiInstalled, installGsiConfig } from './gsi/gsiInstaller.js';
import { AISettingsStore, providerDefinition } from './aiSettingsStore.js';
import { applyAIConfiguration, engineOptions, testAIConnection } from './aiConfiguration.js';
import { connectionError } from '../services/connectionCheck.js';
import { isTrustedSettingsSender, aiKeyPage, settingsAffectVoice } from './aiSettingsIpc.js';
import { createCustomizationController } from './customizationIpc.js';
import { runCustomizationSmoke } from './customizationSmoke.js';
import { createWelcomeController } from './welcomeController.js';
import { presentSettingsWhenReady, settingsWindowBounds } from './settingsPresentation.js';
import { UpdateService } from './updateService.js';
import { createUpdateController } from './updateController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const aiSettingsURL = pathToFileURL(path.join(__dirname, '../renderer/ai-settings.html')).href;
const appIcon = path.join(__dirname, '../renderer/assets/app-icon.png');

// Isolated smoke tests never touch a user's vault, running companion, or GSI port.
const smokeTest = process.argv.includes('--companion-smoke-test');
if (smokeTest && app?.setPath) {
  const argument = process.argv.find(value => value.startsWith('--companion-data-dir='));
  if (!argument) throw new Error('Smoke tests require an isolated data directory.');
  app.setPath('userData', path.resolve(argument.slice('--companion-data-dir='.length)));
} else if (app?.setPath) {
  // Repository/package branding changes must not orphan existing encrypted keys.
  app.setPath('userData', path.join(app.getPath('appData'), 'dota2-voicespirit-companion'));
}

// EPIPE guard: on Windows, closing the terminal that launched this app breaks the
// stdout/stderr pipes; every later console.log would then throw EPIPE and pop the
// "A JavaScript error occurred in the main process" dialog. Swallow pipe write
// failures instead of crashing.
for (const stdStream of [process.stdout, process.stderr]) {
  if (stdStream && typeof stdStream.on === 'function') {
    stdStream.on('error', (err) => {
      if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED' || err?.code === 'ERR_STREAM_WRITE_AFTER_END') return;
      throw err;
    });
  }
}
process.on('uncaughtException', (err) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED' || err?.code === 'ERR_STREAM_WRITE_AFTER_END') return;
  console.error('[App] Uncaught exception in main process:', err);
});

// Transparent-window reliability: with GPU compositing, the layered window
// silently stops presenting after being demoted by a fullscreen app or
// dragged around — the window stays hit-testable (its native tooltips even
// work) but every pixel goes invisible. Software rendering of this small
// 340x440 surface is cheap and immune to that failure mode.
app?.disableHardwareAcceleration?.();

// Hardware Acceleration & Transparent Window Flicker Prevention Switches
if (app?.commandLine) {
  app.commandLine.appendSwitch('disable-features', 'PaintHolding,CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

// Single Instance Lock: Prevent multiple Electron instances from locking cache & shortcuts
const gotTheLock = app?.requestSingleInstanceLock ? app.requestSingleInstanceLock() : true;
if (!gotTheLock) {
  console.log('[App] Another instance of DotaPet is already running. Focusing existing window.');
  app?.quit?.();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let voiceClient = null;
let ahkEngine = null;
let roamEngine = null;
let gsiServer = null;
let heroesConfig = null;
let aiSettingsStore = null;
let aiSettingsWindow = null;
let connectionTest = null;
let customizationController = null;
let welcomeController = null;
let updateController = null;
let updateService = null;
let lastVoiceStatus = { status: 'disconnected', provider: '未连接' };

function publishVoiceStatus(data) {
  lastVoiceStatus = data?.status === 'error' ? { ...data, error: connectionError(data.error) } : data;
  for (const win of [mainWindow, aiSettingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('voice:status', lastVoiceStatus);
  }
}

function cancelConnectionTest() {
  connectionTest?.abort();
  connectionTest = null;
}

function stopVoiceForSettings() {
  cancelConnectionTest();
  voiceClient?.disconnect();
  if (voiceClient?.cloudEngine) voiceClient.cloudEngine.apiKey = null;
  currentVoiceProvider = null;
  updateTrayMenu();
  publishVoiceStatus({ status: 'disconnected', provider: '设置已更新，请手动连接' });
}

let settingsPurpose = '';
let settingsFirstRun = false;
function openAISettings(purpose = '', { firstRun = false } = {}) {
  settingsPurpose = ['voice', 'translate'].includes(purpose) ? purpose : '';
  settingsFirstRun ||= firstRun;
  if (aiSettingsWindow && !aiSettingsWindow.isDestroyed()) {
    if (settingsPurpose) aiSettingsWindow.webContents.send('settings:purpose', settingsPurpose);
    if (!smokeTest) { if (aiSettingsWindow.isMinimized()) aiSettingsWindow.restore(); aiSettingsWindow.show(); aiSettingsWindow.focus(); aiSettingsWindow.moveTop(); }
    return aiSettingsWindow;
  }
  aiSettingsWindow = new BrowserWindow({
    icon: appIcon,
    ...settingsWindowBounds(screen.getPrimaryDisplay().workArea),
    title: '刀塔宠物 · 翻译与语音设置', titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f7f8f4', symbolColor: '#52604f', height: 48 },
    autoHideMenuBar: true, show: false, backgroundColor: '#f7f8f4',
    parent: mainWindow || undefined,
    webPreferences: { preload: path.join(__dirname, '../preload/ai-settings.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  aiSettingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  aiSettingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  presentSettingsWhenReady(aiSettingsWindow, { smokeTest });
  aiSettingsWindow.on('closed', () => {
    cancelConnectionTest(); aiSettingsWindow = null;
    if (settingsFirstRun) {
      try { welcomeController.store.dismiss(app.getVersion()); }
      catch (error) { console.warn('[Settings] Could not save first-run preference:', error.message); }
    }
    settingsFirstRun = false;
  });
  aiSettingsWindow.loadFile(path.join(__dirname, '../renderer/ai-settings.html'));
  return aiSettingsWindow;
}

async function runCompanionSmokeTest() {
  if (mainWindow.getTitle() !== '刀塔宠物 · DotaPet') throw new Error('Desktop still shows legacy branding');
  const firstSetup = welcomeController.showOnFirstRun();
  if (!firstSetup || firstSetup !== aiSettingsWindow) throw new Error('First launch did not open configuration directly');
  const firstSetupClosed = new Promise(resolve => firstSetup.once('closed', resolve));
  await new Promise(resolve => firstSetup.webContents.once('did-finish-load', resolve));
  firstSetup.setSize(620, 640);
  await new Promise(resolve => setTimeout(resolve, 150));
  await firstSetup.webContents.executeJavaScript(`(async () => {
    for (let i=0; i<100 && document.getElementById('provider').disabled; i++) await new Promise(resolve=>setTimeout(resolve,40));
    if(document.querySelectorAll('.provider-option').length !== 4) throw new Error('First launch did not show all four services');
    if(document.getElementById('usage').value !== 'voice') throw new Error('First launch hid voice services');
    if(document.getElementById('advanced').open) throw new Error('First launch opened advanced controls');
    const skip=document.getElementById('skip').getBoundingClientRect(), primary=document.getElementById('connect').getBoundingClientRect();
    if(skip.bottom > innerHeight || primary.bottom > document.querySelector('footer').getBoundingClientRect().top) throw new Error('First setup action outside viewport: '+JSON.stringify({ width:innerWidth,height:innerHeight,skip:skip.bottom,primary:primary.bottom }));
    document.getElementById('skip').click();
  })()`);
  await firstSetupClosed;
  if (!welcomeController.store.state.dismissed || welcomeController.showOnFirstRun()) throw new Error('First setup dismissal was not persisted');
  const welcome = welcomeController.open();
  await new Promise(resolve => welcome.webContents.once('did-finish-load', resolve));
  const onboarding = await welcome.webContents.executeJavaScript(`(async () => {
    const waitFor = async predicate => { for(let i=0;i<350;i++){ if(predicate()) return; await new Promise(r=>setTimeout(r,40)); } throw new Error('Welcome UI timed out: '+predicate.toString()+' / '+document.getElementById('mic-status').textContent+' / '+document.getElementById('guide-feedback').textContent); };
    const get = id => document.getElementById(id);
    await waitFor(()=>get('app-version').textContent.includes('v'));
    if ('sendAudioChunk' in window.welcomeAPI) throw new Error('Guide exposes audio upload');
    const acquired=[]; const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);acquired.push(stream);return stream;};
    get('guide-next').click();
    if(get('step-1').hidden) throw new Error('Guide did not advance');
    get('mic-start').click();
    // Hosted Windows runners can open Chromium's fake device but have no active
    // audio output clock. Both detected sound and a clean silent result are valid;
    // signal classification is covered separately by the microphone unit tests.
    await waitFor(()=>get('mic-status').textContent.includes('麦克风已关闭'));
    const detectedSound=get('mic-status').textContent.includes('检查通过');
    if(!detectedSound && !get('mic-status').textContent.includes('设备已打开，但没有检测到明显声音')) throw new Error('Unexpected microphone result');
    if(acquired.some(stream=>stream.getTracks().some(track=>track.readyState!=='ended'))) throw new Error('Check left microphone open');
    get('mic-start').click(); await waitFor(()=>acquired.length===2);
    get('guide-next').click();
    if(acquired.some(stream=>stream.getTracks().some(track=>track.readyState!=='ended'))) throw new Error('Step change left microphone open');
    if(document.documentElement.scrollWidth>document.documentElement.clientWidth) throw new Error('Welcome overflows');
    return { localMicrophone:true, detectedSound, stoppedOnNavigation:true };
  })()`);
  const outputArgument = process.argv.find(value => value.startsWith('--companion-smoke-output='));
  if (outputArgument) {
    const outputDirectory = path.dirname(path.resolve(outputArgument.slice('--companion-smoke-output='.length)));
    await welcome.webContents.executeJavaScript("document.querySelector('[data-step=\"0\"]').click()");
    await welcome.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(outputDirectory, 'welcome.png'), (await welcome.webContents.capturePage()).toPNG());
    welcome.setSize(620, 730);
    await new Promise(resolve => setTimeout(resolve, 150));
    await welcome.webContents.executeJavaScript("if(document.documentElement.scrollWidth>document.documentElement.clientWidth) throw new Error('Narrow welcome overflows'); document.querySelector('[data-step=\"1\"]').click()");
    await welcome.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(outputDirectory, 'welcome-microphone.png'), (await welcome.webContents.capturePage()).toPNG());
  }
  await welcome.webContents.executeJavaScript("document.getElementById('guide-skip').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!welcomeController.store.state.dismissed) throw new Error('Skip did not persist welcome preference');
  aiSettingsStore.save({ provider: 'google', secrets: { apiKey: 'smoke-encrypted-key' } });
  if (fs.readFileSync(aiSettingsStore.filePath, 'utf8').includes('smoke-encrypted-key')) throw new Error('Vault contains plaintext');
  const reloaded = new AISettingsStore({ filePath: aiSettingsStore.filePath, safeStorage });
  if (reloaded.getPrivate('google').apiKey !== 'smoke-encrypted-key') throw new Error('Encrypted key did not survive reload');
  aiSettingsStore.deleteSecrets('google');
  const win = openAISettings();
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const waitFor = async predicate => {
      for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error('Settings UI timed out');
    };
    const get = id => document.getElementById(id);
    await waitFor(() => !get('provider').disabled);
    if (get('provider').options.length !== 4 || get('usage').value !== 'voice' || !window.electronAPI) throw new Error('Four-provider voice setup missing');
    if (document.querySelectorAll('.provider-option').length !== 4 || get('voice').options.length !== 3) throw new Error('Simple provider or voice choices missing');
    get('usage-translate').click();
    if (get('provider').options.length !== 2 || !get('connect').hidden) throw new Error('Text translation setup missing');
    get('usage-voice').click();
    if (get('provider').options.length !== 4) throw new Error('Voice tab hid providers');
    if ('copyToClipboard' in window.electronAPI || 'sendAudioChunk' in window.electronAPI) throw new Error('Settings preload exposes unrelated app controls');
    if (get('advanced').open) throw new Error('Advanced setup should be collapsed initially');
    get('provider').value = 'google'; get('provider').dispatchEvent(new Event('change'));
    get('all-voices').value = 'Charon'; get('all-voices').dispatchEvent(new Event('change'));
    get('usage-translate').click(); get('usage-voice').click();
    if(get('voice').value !== 'Charon') throw new Error('Switching tabs lost the draft voice');
    get('secret-apiKey').value = 'smoke-google-key'; get('save').click();
    await waitFor(() => !get('save').disabled);
    if (get('secret-apiKey').value || !get('secret-apiKey').placeholder.includes('保留')) throw new Error('Key was not cleared or saved');
    get('provider').value = 'qwen'; get('provider').dispatchEvent(new Event('change'));
    if (get('secret-apiKey').value) throw new Error('Key leaked across provider switch');
    get('provider').value = 'google'; get('provider').dispatchEvent(new Event('change'));
    get('advanced').open = true;
    get('delete').click(); await waitFor(() => !get('save').disabled);
    if (get('secret-apiKey').placeholder.includes('保留')) throw new Error('Key was not deleted');
    get('provider').value = 'qwen'; get('provider').dispatchEvent(new Event('change'));
    get('advanced').open = false;
    const state = await window.electronAPI.getAISettings();
    if (JSON.stringify(state).includes('smoke-google-key')) throw new Error('Public IPC leaked a key');
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport) throw new Error('Settings page overflows horizontally');
    const primary = get('connect').getBoundingClientRect();
    if (primary.bottom > innerHeight) throw new Error('Primary setup action requires scrolling');
    return { providerCount: state.settings.providers.length, visibleVoiceProviders: 4, directFirstSetup: true, encryptedStorage: state.settings.encryptionAvailable };
  })()`);
  const vault = fs.readFileSync(aiSettingsStore.filePath, 'utf8');
  if (vault.includes('smoke-google-key')) throw new Error('Vault contains plaintext');
  const outputArg = process.argv.find(value => value.startsWith('--companion-smoke-output='));
  if (outputArg) {
    const capture = async () => {
      // A hidden native window can return the previous compositor frame first.
      // Prime capture, then wait for two renderer frames before saving the image.
      await win.webContents.capturePage();
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      return win.webContents.capturePage();
    };
    const image = await capture();
    if (image.isEmpty()) throw new Error('Settings screenshot is empty');
    const output = path.resolve(outputArg.slice('--companion-smoke-output='.length));
    fs.writeFileSync(output, image.toPNG());
    for (const state of ['connecting', 'connected', 'error']) {
      win.webContents.send('voice:status', { status: state, providerId: 'qwen', ...(state === 'error' ? { error: '请检查密钥与网络后重试。' } : {}) });
      await win.webContents.executeJavaScript(`(async () => {
        for (let i=0; i<100 && document.getElementById('connection-status').dataset.state !== '${state}'; i++) await new Promise(resolve=>setTimeout(resolve,20));
        if (document.getElementById('connection-status').dataset.state !== '${state}') throw new Error('Connection state did not update');
        if ('${state}' === 'connecting' && !document.getElementById('connect').disabled) throw new Error('Connecting allowed duplicate starts');
        if ('${state}' === 'connected' && document.getElementById('finish').hidden) throw new Error('Connected setup did not offer completion');
      })()`);
      fs.writeFileSync(output.replace(/\.png$/, `-${state}.png`), (await capture()).toPNG());
    }
    win.webContents.send('voice:status', { status: 'disconnected', providerId: 'qwen' });
    await win.webContents.executeJavaScript("document.getElementById('feedback').textContent = ''; document.getElementById('feedback').dataset.kind = ''");
    await win.webContents.executeJavaScript("document.getElementById('advanced').open = true; window.scrollTo(0, document.body.scrollHeight)");
    fs.writeFileSync(output.replace(/\.png$/, '-actions.png'), (await capture()).toPNG());
    await win.webContents.executeJavaScript("document.getElementById('advanced').open = false; document.getElementById('provider').value = 'doubao'; document.getElementById('provider').dispatchEvent(new Event('change')); window.scrollTo(0,0)");
    fs.writeFileSync(output.replace(/\.png$/, '-doubao.png'), (await capture()).toPNG());
    win.setSize(620, 730);
    await new Promise(resolve => setTimeout(resolve, 150));
    const overflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth');
    if (overflow) throw new Error('Narrow settings page overflows horizontally');
    fs.writeFileSync(output.replace(/\.png$/, '-narrow.png'), (await capture()).toPNG());
    win.setSize(940, 820);
    await win.webContents.executeJavaScript("document.getElementById('usage').value = 'translate'; document.getElementById('usage').dispatchEvent(new Event('change')); window.scrollTo(0,0)");
    fs.writeFileSync(output.replace(/\.png$/, '-translation.png'), (await capture()).toPNG());
    openAISettings('voice');
    await win.webContents.executeJavaScript("if(document.getElementById('usage').value !== 'voice') throw new Error('Voice action did not open voice setup')");
  }
  const customizationResult = await runCustomizationSmoke({ controller: customizationController, mainWindow, dialog, outputDirectory: app.getPath('userData') });
  const { runPhrasesSmoke } = await import('./phrasesSmoke.js');
  const phrases = await runPhrasesSmoke({ settingsWindow: win, getWindow: () => phrasesWindow,
    getCopiedText: () => smokeClipboardText, outputDirectory: app.getPath('userData') });
  const { runUpdateSmoke } = await import('./updateSmoke.js');
  const updates = await runUpdateSmoke({ electron, rendererDirectory: path.join(__dirname, '../renderer'), icon: appIcon, outputDirectory: app.getPath('userData') });
  console.log('[Smoke] PASS', JSON.stringify({ ...result, onboarding, customization: customizationResult, phrases, updates }));
  app.exit(0);
}

// Single source of truth for the fixed companion window size (resizable: false).
const COMPANION_WIDTH = 340;
const COMPANION_HEIGHT = 440;

// Z-order band used for every always-on-top assertion. On Windows the level
// is NOT cosmetic: 'floating'..='status' live in a band *below the taskbar*,
// so a borderless-fullscreen game covering the taskbar region also covers a
// 'floating' companion — the pet stays under DOTA 2 no matter how often the
// flag is re-asserted. 'screen-saver' is the highest band a normal app can
// request and stays above borderless games. Other platforms keep 'floating'
// so the pet never covers the Dock/taskbar during normal desktop use.
const TOPMOST_LEVEL = process.platform === 'win32' ? 'screen-saver' : 'floating';

/**
 * Re-assert topmost on a window. Windows silently strips WS_EX_TOPMOST when
 * a fullscreen-style window takes the foreground, and Electron caches its own
 * flag (isAlwaysOnTop() never reflects the OS bit), so a same-value
 * setAlwaysOnTop(true) can be swallowed — the NOTOPMOST->TOPMOST toggle
 * forces a real style change. moveTop() then puts the window at the head of
 * the topmost band; even with the band bit stripped it lands at the head of
 * the normal band, which is still above a borderless game.
 */
function reassertTopmost(win, { invalidate = false } = {}) {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.setAlwaysOnTop(false);
  win.setAlwaysOnTop(true, TOPMOST_LEVEL);
  win.moveTop();
  if (invalidate) {
    // Kick the compositor so a demote/restore cycle never leaves the layered
    // surface blank.
    try {
      win.webContents.invalidate();
    } catch (e) {}
  }
}
let gsiSettings = {
  autoSwitchHero: true,
  enableCombatAlerts: true,
  enableRuneTimers: true,
  port: 3008,
};

// Gemini Live Translate target language (BCP-47). Input language is always
// auto-detected server-side; this only decides what the translation is spoken
// in. Persisted so the choice survives restarts and applied to the engine on
// every connect. Official default is 'en'.
const TRANSLATE_TARGET_LANGUAGES = [
  { code: 'en', label: '英语 (English)' },
  { code: 'zh-Hans', label: '中文 (简体)' },
  { code: 'zh-Hant', label: '中文 (繁體)' },
  { code: 'ja', label: '日语 (日本語)' },
  { code: 'ko', label: '韩语 (한국어)' },
  { code: 'ru', label: '俄语 (Русский)' },
  { code: 'es', label: '西班牙语 (Español)' },
  { code: 'fr', label: '法语 (Français)' },
];
let translateTargetLanguage = 'en';

function translateTargetLanguageLabel(code) {
  return TRANSLATE_TARGET_LANGUAGES.find((l) => l.code === code)?.label || code;
}

// Window placement, pin state & scale mode, persisted in voicespirit_settings.json so the
// companion reopens where the user left it instead of always snapping back to
// the bottom-right default.
let windowState = { x: null, y: null, pinned: false, scaleMode: 'normal' };
let saveWindowStateTimer = null;
let topmostWatchdog = null;

export const SCALE_TIERS = [
  { id: 'normal', scale: 1.0, label: '标准尺寸 (100%)' },
  { id: 'compact', scale: 0.75, label: '精简缩小 (75%)' },
  { id: 'mini', scale: 0.55, label: '极简迷你 (55%)' },
];

function persistWindowState() {
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => {
    try {
      const sPath = getSettingsPath();
      let data = {};
      if (fs.existsSync(sPath)) {
        try {
          data = JSON.parse(fs.readFileSync(sPath, 'utf8'));
        } catch (e) {}
      }
      data.windowState = windowState;
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(sPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[Settings] Failed to save window state:', e);
    }
  }, 350);
}

function setWindowPinned(pinned) {
  const next = Boolean(pinned);
  if (windowState.pinned === next) return;
  windowState.pinned = next;
  persistWindowState();

  if (mainWindow && !mainWindow.isDestroyed()) {
    // Pinning re-asserts topmost so the companion never sinks behind the game.
    if (next) {
      reassertTopmost(mainWindow);
      // A locked companion must not wander off on its own.
      if (roamEngine?.isRoaming) {
        roamEngine.stop();
      }
    }
    mainWindow.webContents.send('window:pinned-changed', { pinned: windowState.pinned });
  }
  updateTrayMenu();
}

function setScaleMode(mode, notify = true) {
  const valid = SCALE_TIERS.some((t) => t.id === mode) ? mode : 'normal';
  windowState.scaleMode = valid;
  persistWindowState();
  if (notify && mainWindow && !mainWindow.isDestroyed()) {
    const tier = SCALE_TIERS.find((t) => t.id === valid) || SCALE_TIERS[0];
    mainWindow.webContents.send('window:scale-changed', {
      scaleMode: tier.id,
      scale: tier.scale,
      label: tier.label,
    });
  }
  return valid;
}

function cycleScaleMode() {
  const curIdx = SCALE_TIERS.findIndex((t) => t.id === (windowState.scaleMode || 'normal'));
  const nextIdx = (curIdx + 1) % SCALE_TIERS.length;
  const nextTier = SCALE_TIERS[nextIdx];
  setScaleMode(nextTier.id, true);
  return nextTier;
}

// Default to the Free-Chat Companion persona: casual chatting out of the box,
// with smart in-conversation hero role-play handled by the model itself.
// A saved selection (hero or companion) always wins over this default.
let currentHeroId = FREE_CHAT_HERO_ID;

// Voice persona currently overridden by Desktop Pet mode (信使小驴 etc.).
// The renderer owns pet selection; it syncs the active pet here so the voice
// engine talks as the pet instead of the equipped hero. Null = hero mode.
let activePetPersona = null;

// Free-Chat Companion pseudo-hero — not part of heroes.config.json. The
// engine recognises its id and swaps the locked-hero prompt for the
// free-chat routing prompt (chat freely / role-play an addressed hero /
// coach mode).
const COMPANION_PSEUDO_HERO = {
  id: FREE_CHAT_HERO_ID,
  nameZh: '自由伴侣',
  nameEn: 'Free Chat',
  attribute: 'all',
  themeColor: '#38bdf8',
  sprites: { idle: 'assets/heroes/companion/idle.svg', speaking: 'assets/heroes/companion/speaking.svg', action: 'assets/heroes/companion/action.svg' },
  catchphrases: [
    '我在呢，想聊点啥？',
    '今天手感怎么样，召唤师？',
    '闲着也是闲着，唠两句？',
  ],
};

export const VOICE_PROVIDERS = [
  { id: null, label: '未连接 (仅本地语音与翻译)' },
  { id: 'doubao', label: '火山豆包 (中英双语全双工)' },
  { id: 'qwen', label: '阿里千问 (中英双语实时对讲)' },
  { id: 'cartesia', label: 'Cartesia 纯英对练 (English Voice)' },
  { id: 'google', label: '谷歌 Gemini Live (多语言实时对话)' },
  { id: 'google-translate', label: '谷歌实时翻译 (Live Translate)' },
];

// No provider dials out on its own: cloud voice connects ONLY when the user
// explicitly picks one (tray / pet menu / IPC / shortcut).
// null = 未连接 — GSI 播报与翻译走本地路径，不受影响。
let currentVoiceProvider = null;

function setVoiceProvider(providerId) {
  cancelConnectionTest();
  if (providerId) {
    try {
      if (providerDefinition(providerId).textOnly) throw new Error('请选择实时语音服务商。');
      const profile = aiSettingsStore.getPrivate(providerId);
      if (providerDefinition(providerId).fields.some(field => !field.optional && !profile[field.id])) {
        stopVoiceForSettings();
        openAISettings('voice');
        return;
      }
      applyAIConfiguration(aiSettingsStore);
      const options = engineOptions(aiSettingsStore, providerId);
      voiceClient?.disconnect();
      Object.assign(voiceClient.cloudEngine, options);
    } catch (error) {
      stopVoiceForSettings();
      publishVoiceStatus({ status: 'error', error: error.message });
      openAISettings('voice');
      return;
    }
  }
  currentVoiceProvider = providerId || null;
  if (voiceClient) {
    if (currentVoiceProvider) {
      voiceClient.setProvider(currentVoiceProvider);
    } else {
      voiceClient.disconnect();
      // A manual disconnect() nulls the socket before its close event fires,
      // so the engine's stale-socket guard swallows the close without a
      // status emit — tell the renderer the cloud voice is now off.
      voiceClient.cloudEngine.apiKey = null;
      publishVoiceStatus({ status: 'disconnected', provider: '未连接 (仅本地语音)' });
    }
  }
  updateTrayMenu();
}

function cycleVoiceProvider() {
  const available = VOICE_PROVIDERS.filter(p => {
    if (!p.id) return true;
    try { const profile = aiSettingsStore.getPrivate(p.id); return providerDefinition(p.id).fields.every(field => field.optional || profile[field.id]); }
    catch { return false; }
  });
  if (available.length === 1) { openAISettings('voice'); return available[0]; }
  const currentIdx = available.findIndex(p => p.id === currentVoiceProvider);
  const nextProvider = available[(currentIdx + 1) % available.length];
  setVoiceProvider(nextProvider.id);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('voice:provider-cycled', {
      providerId: nextProvider.id,
      label: nextProvider.label,
    });
  }
  return nextProvider;
}



function getSettingsPath() {
  try {
    return path.join(app.getPath('userData'), 'voicespirit_settings.json');
  } catch (e) {
    return path.resolve(__dirname, '../../voicespirit_settings.json');
  }
}

export const DEFAULT_SIMPLIFIED_PHRASES = [
  { cn: '快推中路别刷了，一波带走', en: 'Push mid now, end the game.' },
  { cn: '集合开雾打肉山，别单走', en: 'Smoke and rosh now, stick together.' },
  { cn: '没买活稳点，别单走送了', en: "No buyback, play safe and don't get caught." },
  { cn: 'TP救一下，反打他们！', en: 'TP help! Counter-initiate now!' },
  { cn: '先手秒辅助，别集火前排', en: 'Focus backline supports first, ignore tank.' },
  { cn: '键盘上拴条狗都比你玩得好', en: 'A dog on keyboard plays better than you.' },
  { cn: '超级兵死了给钱，你死了只值举报', en: 'Mega creeps give gold, you only give reports.' },
  { cn: '在野区采灵芝？出来打团', en: 'AFK jungle forever? Join the fight.' },
  { cn: '脑子不用可以捐给有用的人', en: 'Donate your brain if you never use it.' },
  { cn: '打得漂亮，兄弟们冲！', en: "Well played boys, let's keep going!" },
];

function getPhrasesConfigPath() {
  try {
    return path.join(app.getPath('userData'), 'custom_phrases.json');
  } catch (e) {
    return path.resolve(__dirname, '../../custom_phrases.json');
  }
}

let cachedPhrases = null;

function loadPhrasesConfig() {
  if (cachedPhrases) return cachedPhrases;
  try {
    const pPath = getPhrasesConfigPath();
    if (fs.existsSync(pPath)) {
      const data = JSON.parse(fs.readFileSync(pPath, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        cachedPhrases = data;
        return cachedPhrases;
      }
    }
  } catch (err) {
    console.error('[Phrases] Failed to load custom phrases, using defaults:', err.message);
  }
  cachedPhrases = JSON.parse(JSON.stringify(DEFAULT_SIMPLIFIED_PHRASES));
  return cachedPhrases;
}

function savePhrasesConfig(phrases) {
  try {
    cachedPhrases = phrases;
    const pPath = getPhrasesConfigPath();
    fs.writeFileSync(pPath, JSON.stringify(phrases, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('[Phrases] Failed to save custom phrases:', err.message);
    return { success: false, error: err.message };
  }
}

function sendPhraseToGame(digit, type = 'cn') {
  const phrases = loadPhrasesConfig();
  const index = digit === '0' ? 9 : parseInt(digit, 10) - 1;
  if (index >= 0 && index < phrases.length) {
    const phraseObj = phrases[index];
    const text = type === 'cn' ? phraseObj.cn : phraseObj.en;
    if (text) {
      clipboard.writeText(text);
      console.log(`[Phrase Sent] [${type.toUpperCase()}] Row ${digit}: "${text}" copied to clipboard`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('phrase:sent', {
          digit,
          type,
          text,
          label: type === 'cn' ? '🇨🇳 中文快捷短语' : '🇺🇸 英文快捷短语',
        });
      }
      return { success: true, text };
    }
  }
  return { success: false, error: 'Phrase not found' };
}

function loadSavedHeroId() {
  try {
    const sPath = getSettingsPath();
    if (fs.existsSync(sPath)) {
      const data = JSON.parse(fs.readFileSync(sPath, 'utf8'));
      if (data && data.gsiSettings) {
        gsiSettings = { ...gsiSettings, ...data.gsiSettings };
      }
      if (data && data.windowState && typeof data.windowState === 'object') {
        windowState = {
          x: Number.isFinite(data.windowState.x) ? data.windowState.x : null,
          y: Number.isFinite(data.windowState.y) ? data.windowState.y : null,
          pinned: Boolean(data.windowState.pinned),
          scaleMode: data.windowState.scaleMode || 'normal',
        };
      }
      if (data && data.selectedHeroId) {
        return data.selectedHeroId;
      }
    }
  } catch (e) {
    console.error('[Settings] Failed to load saved settings:', e);
  }
  return null;
}

function saveHeroId(heroId) {
  try {
    const sPath = getSettingsPath();
    let data = {};
    if (fs.existsSync(sPath)) {
      try {
        data = JSON.parse(fs.readFileSync(sPath, 'utf8'));
      } catch (e) {}
    }
    data.selectedHeroId = heroId;
    data.gsiSettings = gsiSettings;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(sPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Settings] Failed to save heroId:', e);
  }
}

function saveGsiSettings(newSettings) {
  try {
    const sPath = getSettingsPath();
    let data = {};
    if (fs.existsSync(sPath)) {
      try {
        data = JSON.parse(fs.readFileSync(sPath, 'utf8'));
      } catch (e) {}
    }
    data.gsiSettings = newSettings;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(sPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Settings] Failed to save gsiSettings:', e);
  }
}

function saveTranslateTargetLanguage(langCode) {
  try {
    const sPath = getSettingsPath();
    let data = {};
    if (fs.existsSync(sPath)) {
      try {
        data = JSON.parse(fs.readFileSync(sPath, 'utf8'));
      } catch (e) {}
    }
    data.translateTargetLanguage = langCode;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(sPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Settings] Failed to save translateTargetLanguage:', e);
  }
}

// Loaded independently of the hero config: loadSavedHeroId() only runs when
// heroes.config.json parses, and a broken config must not reset the chosen
// translation language. Whitelist-validated so a hand-edited settings file
// can never push an arbitrary code into the Google setup frame.
function loadTranslateTargetLanguage() {
  try {
    const sPath = getSettingsPath();
    if (!fs.existsSync(sPath)) return;
    const data = JSON.parse(fs.readFileSync(sPath, 'utf8'));
    const saved = data && data.translateTargetLanguage;
    if (TRANSLATE_TARGET_LANGUAGES.some((l) => l.code === saved)) {
      translateTargetLanguage = saved;
    }
  } catch (e) {
    console.error('[Settings] Failed to load translateTargetLanguage:', e);
  }
}

function setTranslateTargetLanguage(langCode) {
  const lang = TRANSLATE_TARGET_LANGUAGES.some((l) => l.code === langCode) ? langCode : 'en';
  translateTargetLanguage = lang;
  saveTranslateTargetLanguage(lang);
  // A live google-translate session reconnects inside the engine so the new
  // target takes effect immediately; other providers just remember it.
  voiceClient?.setTranslateTargetLanguage(lang);
  updateTrayMenu();
}

function loadHeroesConfig() {
  try {
    const configPath = path.resolve(__dirname, '../../heroes.config.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      heroesConfig = JSON.parse(data);
      const savedHero = loadSavedHeroId();
      if (savedHero && (savedHero === FREE_CHAT_HERO_ID || (heroesConfig.heroes && heroesConfig.heroes[savedHero]))) {
        currentHeroId = savedHero;
      } else {
        currentHeroId = FREE_CHAT_HERO_ID;
      }
      console.log(`[Config] Loaded ${Object.keys(heroesConfig.heroes || {}).length} heroes, currentHeroId: ${currentHeroId}`);
    }
  } catch (err) {
    console.error('[Config] Failed to load heroes.config.json:', err);
    heroesConfig = {
      defaultHero: 'invoker',
      heroes: {}
    };
  }
}

function getCurrentHero() {
  if (currentHeroId === FREE_CHAT_HERO_ID) {
    return COMPANION_PSEUDO_HERO;
  }
  if (heroesConfig && heroesConfig.heroes && heroesConfig.heroes[currentHeroId]) {
    return heroesConfig.heroes[currentHeroId];
  }
  return null;
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: areaX, y: areaY, width: screenWidth, height: screenHeight } = primaryDisplay.workArea;
  const winWidth = COMPANION_WIDTH;
  const winHeight = COMPANION_HEIGHT;
  const posX = Math.max(areaX + 10, Math.round(areaX + screenWidth - winWidth - 25));
  const posY = Math.max(areaY + 10, Math.round(areaY + screenHeight - winHeight - 40));

  // Restore the last session's placement, clamped into the current work area
  // so a monitor/resolution change can never push the companion off-screen.
  let startX = posX;
  let startY = posY;
  if (Number.isFinite(windowState.x) && Number.isFinite(windowState.y)) {
    startX = Math.round(Math.max(areaX + 6, Math.min(windowState.x, areaX + screenWidth - winWidth - 6)));
    startY = Math.round(Math.max(areaY + 6, Math.min(windowState.y, areaY + screenHeight - winHeight - 6)));
  }

  mainWindow = new BrowserWindow({
    icon: appIcon,
    width: winWidth,
    height: winHeight,
    minWidth: winWidth,
    maxWidth: winWidth,
    minHeight: winHeight,
    maxHeight: winHeight,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false, // Locked to fixed dimensions to prevent Windows DWM scaling during drag
    maximizable: false,
    fullscreenable: false,
    useContentSize: true,
    hasShadow: false,
    show: false,
    skipTaskbar: false,
    title: '刀塔宠物 · DotaPet',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      zoomFactor: 1.0,
    },
  });

  // Use the platform-appropriate topmost band (see TOPMOST_LEVEL) so the pet
  // survives borderless games on Windows without covering the Dock on macOS.
  mainWindow.setAlwaysOnTop(true, TOPMOST_LEVEL);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Disable visual zoom scaling
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.setZoomFactor(1);

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  const showAndPresentWindow = () => {
    if (smokeTest) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, TOPMOST_LEVEL);
    if (!aiSettingsWindow || aiSettingsWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.moveTop();
    }
    mainWindow.setSize(winWidth, winHeight);
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    updateTrayMenu();
  };

  mainWindow.once('ready-to-show', showAndPresentWindow);

  // Guarantee window is presented even if ready-to-show was delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      showAndPresentWindow();
    }
  }, 600);

  // Strictly enforce fixed dimension & lock out Windows Aero Snap maximize
  mainWindow.on('maximize', (e) => {
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.unmaximize();
      mainWindow.setSize(winWidth, winHeight);
    }
  });

  mainWindow.on('will-resize', (e) => {
    e.preventDefault();
  });

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [w, h] = mainWindow.getSize();
      if (w !== winWidth || h !== winHeight) {
        mainWindow.setSize(winWidth, winHeight);
      }
    }
  });

  // Remember placement whenever the window lands somewhere new.
  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    windowState.x = x;
    windowState.y = y;
    persistWindowState();
    // Kick the compositor so a drag never leaves a blank layered surface.
    // During a roam the window moves every frame — the watchdog's periodic
    // invalidate covers presentation there; don't churn 60 kicks a second.
    if (!roamEngine?.isRoaming) {
      mainWindow.webContents.invalidate();
    }
  });

  // Topmost watchdog (Windows): a borderless game can outrank the companion
  // twice over — the OS strips WS_EX_TOPMOST when a fullscreen-style window
  // takes the foreground, and a same-value setAlwaysOnTop(true) is swallowed
  // because Electron caches its own flag. Every tick a cheap moveTop() keeps
  // the window at the head of its band without ever leaving it (no flicker);
  // on the slow cadence the full NOTOPMOST->TOPMOST toggle restores a
  // stripped band bit and forces the layered surface to present a fresh
  // frame, undoing the blank-window state a game focus grab can leave behind.
  if (process.platform === 'win32') {
    let tick = 0;
    topmostWatchdog = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
      // While the phrase editor has focus the user is at the desktop working
      // in it — don't yank the pet above the editor every half second.
      const settingsActive = aiSettingsWindow && !aiSettingsWindow.isDestroyed()
        && aiSettingsWindow.isVisible() && !aiSettingsWindow.isMinimized();
      const phrasesActive = phrasesWindow && !phrasesWindow.isDestroyed()
        && phrasesWindow.isVisible() && phrasesWindow.isFocused();
      if (settingsActive || phrasesActive) return;
      tick += 1;
      mainWindow.moveTop();
      if (tick % 8 === 0) {
        reassertTopmost(mainWindow, { invalidate: true });
      }
    }, 500);
  }

  mainWindow.on('show', () => {
    reassertTopmost(mainWindow);
    updateTrayMenu();
  });
  mainWindow.on('restore', () => {
    reassertTopmost(mainWindow, { invalidate: true });
    updateTrayMenu();
  });
  mainWindow.on('hide', () => updateTrayMenu());
  mainWindow.on('minimize', () => updateTrayMenu());

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Log] ${message}`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[Renderer Error] did-fail-load: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (topmostWatchdog) {
      clearInterval(topmostWatchdog);
      topmostWatchdog = null;
    }
    // Pet window closing means the user quit the companion — the editor
    // window must not keep the app alive after that.
    if (phrasesWindow && !phrasesWindow.isDestroyed()) {
      phrasesWindow.close();
    }
  });
}

// ==========================================================================
// Quick Phrases Editor Window (F6)
// The 860px phrase table cannot live inside the fixed 300x440 transparent
// pet window, so it gets its own resizable, framed window.
// ==========================================================================
let phrasesWindow = null;
let smokeClipboardText = '';

function createPhrasesWindow() {
  if (phrasesWindow && !phrasesWindow.isDestroyed()) {
    if (!smokeTest) {
      if (phrasesWindow.isMinimized()) phrasesWindow.restore();
      phrasesWindow.show(); phrasesWindow.focus(); phrasesWindow.moveTop();
    }
    return phrasesWindow;
  }

  phrasesWindow = new BrowserWindow({
    icon: appIcon,
    ...settingsWindowBounds(screen.getPrimaryDisplay().workArea, { width: 880, height: 780, minWidth: 620, minHeight: 520 }),
    title: 'DOTA 2 快捷短语面板',
    autoHideMenuBar: true,
    backgroundColor: '#1c1611',
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The phrase editor is an in-game tool (F6) — it needs the same high
  // z-order band as the pet or it sinks behind a borderless DOTA 2 as well.
  phrasesWindow.setAlwaysOnTop(true, TOPMOST_LEVEL);
  phrasesWindow.loadFile(path.join(__dirname, '../renderer/phrases.html'))
    .catch((err) => console.error('[Phrases] loadFile failed:', err.message));

  presentSettingsWhenReady(phrasesWindow, { smokeTest });

  phrasesWindow.webContents.on('did-fail-load', (event, code, desc) => {
    console.error(`[Phrases] did-fail-load: ${code} - ${desc}`);
  });

  phrasesWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Phrases Renderer] ${message}`);
  });

  phrasesWindow.on('closed', () => {
    phrasesWindow = null;
  });
  return phrasesWindow;
}

function togglePhrasesWindow() {
  if (phrasesWindow && !phrasesWindow.isDestroyed()) {
    phrasesWindow.close();
  } else {
    createPhrasesWindow();
  }
}

function createTrayIcon() {
  const image = nativeImage.createFromPath(appIcon);
  if (!image.isEmpty()) return image.resize({ width: 20, height: 20 });
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - 7.5;
      const dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 6.5) {
        if (dist <= 3.5) {
          buffer[idx] = 245;     // R
          buffer[idx + 1] = 158; // G
          buffer[idx + 2] = 11;  // B
          buffer[idx + 3] = 255; // A
        } else {
          buffer[idx] = 220;     // R
          buffer[idx + 1] = 38;  // G
          buffer[idx + 2] = 38;  // B
          buffer[idx + 3] = 255; // A
        }
      } else {
        buffer[idx + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function setupTray() {
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('刀塔宠物 · DotaPet (桌宠 & 游戏翻译)');

    // Left click toggle window visibility & focus
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
          mainWindow.focus();
        } else {
          mainWindow.hide();
        }
      } else {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true, TOPMOST_LEVEL);
      }
      updateTrayMenu();
    });

    tray.on('double-click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, TOPMOST_LEVEL);
      updateTrayMenu();
    });

    updateTrayMenu();
  } catch (err) {
    console.warn('[Tray] Could not create system tray:', err.message);
  }
}

function snapWindow(position = 'center') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getSize();
  const [curX, curY] = mainWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: curX, y: curY }) || screen.getPrimaryDisplay();
  const { x: areaX, y: areaY, width: areaW, height: areaH } = display.workArea;

  let targetX = areaX + (areaW - w) / 2;
  let targetY = areaY + (areaH - h) / 2;
  const marginSide = 25;
  const marginBottom = 35;
  const marginTop = 20;

  switch (position) {
    case 'bottom-right':
      targetX = areaX + areaW - w - marginSide;
      targetY = areaY + areaH - h - marginBottom;
      break;
    case 'bottom-left':
      targetX = areaX + marginSide;
      targetY = areaY + areaH - h - marginBottom;
      break;
    case 'top-right':
      targetX = areaX + areaW - w - marginSide;
      targetY = areaY + marginTop;
      break;
    case 'top-left':
      targetX = areaX + marginSide;
      targetY = areaY + marginTop;
      break;
    case 'center':
    default:
      targetX = areaX + (areaW - w) / 2;
      targetY = areaY + (areaH - h) / 2;
      break;
  }

  const finalX = Math.round(targetX);
  const finalY = Math.round(targetY);
  mainWindow.setPosition(finalX, finalY);

  if (roamEngine) {
    roamEngine.syncExternalPosition(finalX);
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const providerNames = {
    cartesia: 'Cartesia (纯英对练)',
    doubao: '火山豆包 (中英双语)',
    qwen: '阿里千问 (中英双语)',
    google: '谷歌 Gemini Live',
    'google-translate': `谷歌实时翻译 (译入${translateTargetLanguageLabel(translateTargetLanguage)})`,
    'cloud-stream': 'Cartesia (纯英对练)',
  };

  const providerSubmenu = [
    {
      // Disconnect is the startup state: nothing dials out until the user
      // explicitly picks a provider below.
      label: '⛔ 断开云语音 (不连接，GSI/翻译走本地)',
      type: 'radio',
      checked: !currentVoiceProvider,
      click: () => {
        setVoiceProvider(null);
      },
    },
    {
      label: '● Cartesia + DeepSeek (English Voice 纯英对练)',
      type: 'radio',
      checked: currentVoiceProvider === 'cartesia' || currentVoiceProvider === 'cloud-stream',
      click: () => {
        setVoiceProvider('cartesia');
      },
    },
    {
      label: '● 火山豆包 (Doubao 中英双语全双工)',
      type: 'radio',
      checked: currentVoiceProvider === 'doubao',
      click: () => {
        setVoiceProvider('doubao');
      },
    },
    {
      label: '● 阿里千问 (Qwen 中英双语实时对讲)',
      type: 'radio',
      checked: currentVoiceProvider === 'qwen',
      click: () => {
        setVoiceProvider('qwen');
      },
    },
    {
      label: '● 谷歌 Gemini Live (多语言实时对话)',
      type: 'radio',
      checked: currentVoiceProvider === 'google',
      click: () => {
        setVoiceProvider('google');
      },
    },
    {
      label: '● 谷歌 Gemini Live Translate (实时翻译)',
      type: 'radio',
      checked: currentVoiceProvider === 'google-translate',
      click: () => {
        setVoiceProvider('google-translate');
      },
    },
    {
      // Target language of the 谷歌实时翻译 provider, nested one layer under
      // its radio — NOT attached to the radio itself: native menus treat any
      // item that carries a submenu as a container, so a click would open the
      // submenu and the radio could never be toggled. Input language is
      // auto-detected by the model; this only decides what the translation is
      // spoken in. Selecting one applies immediately (a live translate
      // session reconnects) and persists across restarts.
      label: `⤷ 译入语言: ${translateTargetLanguageLabel(translateTargetLanguage)}`,
      submenu: TRANSLATE_TARGET_LANGUAGES.map(({ code, label }) => ({
        label,
        type: 'radio',
        checked: code === translateTargetLanguage,
        click: () => setTranslateTargetLanguage(code),
      })),
    },
  ];

  const gsiStatusLabel = gsiServer?.isConnected ? '🟢 DOTA 2 联动: 游戏中' : '⚪ DOTA 2 联动: 待机中';

  const gsiSubmenu = [
    {
      label: `● 状态: ${gsiServer?.isConnected ? '已连接' : '未连接 (端口 ' + gsiSettings.port + ')'}`,
      enabled: false,
    },
    {
      label: '🔄 自动识别并同步选定英雄',
      type: 'checkbox',
      checked: Boolean(gsiSettings.autoSwitchHero),
      click: (item) => {
        gsiSettings.autoSwitchHero = item.checked;
        gsiServer?.setOptions(gsiSettings);
        saveGsiSettings(gsiSettings);
      },
    },
    {
      label: '⚡ 击杀/连杀与死亡情绪互动',
      type: 'checkbox',
      checked: Boolean(gsiSettings.enableCombatAlerts),
      click: (item) => {
        gsiSettings.enableCombatAlerts = item.checked;
        gsiServer?.setOptions(gsiSettings);
        saveGsiSettings(gsiSettings);
      },
    },
    {
      label: '🔔 战术节点与神符倒计时播报',
      type: 'checkbox',
      checked: Boolean(gsiSettings.enableRuneTimers),
      click: (item) => {
        gsiSettings.enableRuneTimers = item.checked;
        gsiServer?.setOptions(gsiSettings);
        saveGsiSettings(gsiSettings);
      },
    },
    { type: 'separator' },
    {
      label: '🛠️ 一键配置 DOTA 2 GSI',
      click: () => {
        const result = installGsiConfig(null, gsiSettings.port);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('gsi:install-result', result);
        }
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `当前角色: ${activePetPersona ? `${activePetPersona.nameZh} (萌宠)` : getCurrentHero()?.nameZh || currentHeroId}`,
      enabled: false,
    },
    {
      label: gsiStatusLabel,
      submenu: gsiSubmenu,
    },
    {
      label: `🎙️ 语音引擎: ${currentVoiceProvider
        ? (providerNames[currentVoiceProvider] || currentVoiceProvider)
        : '未连接 (选择后才开始连接)'}`,
      submenu: providerSubmenu,
    },
    { label: '⚙️ AI 设置 / 自己的 API Key', click: () => openAISettings() },
    { label: '🏡 新手引导 / 使用帮助', click: () => welcomeController?.open() },
    { label: '🎨 自定义形象 / 背景', click: () => customizationController?.open() },
    { label: updateService?.state.version && ['available', 'ready', 'downloading'].includes(updateService.state.phase)
      ? `⬆️ 更新到 v${updateService.state.version}` : `⬆️ 检查更新 · v${app.getVersion()}`, click: () => updateController?.open() },
    {
      label: '📍 吸附位置',
      submenu: [
        {
          label: '右下角',
          click: () => snapWindow('bottom-right'),
        },
        {
          label: '屏幕中央',
          click: () => snapWindow('center'),
        },
        {
          label: '左下角',
          click: () => snapWindow('bottom-left'),
        },
      ],
    },
    {
      label: '⚡ 快捷短语 (F6)',
      click: () => {
        togglePhrasesWindow();
      },
    },
    {
      label: mainWindow?.isVisible() ? '👁️ 隐藏桌宠' : '👁️ 显示桌宠',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
          reassertTopmost(mainWindow);
        }
        updateTrayMenu();
      },
    },
    {
      label: '👋 退出伴侣',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function selectHero(heroId) {
  const isCompanion = heroId === FREE_CHAT_HERO_ID;
  if (!isCompanion && !heroesConfig?.heroes?.[heroId]) return;
  currentHeroId = heroId;
  customizationController?.publish();
  saveHeroId(heroId);
  // companion resolves to the in-code pseudo-hero; real heroes come from config
  const hero = getCurrentHero();
  if (!hero) return;
  console.log(`[Hero] Switched to: ${hero.nameZh} (${heroId})`);

  // Pet mode owns the live voice persona: record the selection, but the courier
  // keeps talking. hero:changed stays suppressed too, or the renderer would
  // repaint its badge with the hero while the pet is still on stage. The
  // setHero call is skipped entirely — re-injecting the same pet persona would
  // bounce the Google Live session for nothing.
  if (voiceClient && !activePetPersona) {
    voiceClient.setHero(hero);
  }

  if (mainWindow && !mainWindow.isDestroyed() && !activePetPersona) {
    mainWindow.webContents.send('hero:changed', hero);
  }

  updateTrayMenu();
}

function setupServices() {
  voiceClient = new VoiceSpiritClient({
    currentHero: getCurrentHero(),
    translateTargetLanguage,
    autoReconnect: false,
  });

  ahkEngine = new AhkMigratedEngine(mainWindow, voiceClient);

  // Initialize DOTA 2 GSI Local Listener Server
  gsiServer = new GSIServer({
    port: gsiSettings.port,
    heroesConfig: heroesConfig,
    autoSwitchHero: gsiSettings.autoSwitchHero,
    enableCombatAlerts: gsiSettings.enableCombatAlerts,
    enableRuneTimers: gsiSettings.enableRuneTimers,
  });

  // Relay GSI engine events to the renderer (and react to hero detection).
  const forwardGsiEvents = [
    ['hero_detected', 'gsi:hero-detected'],
    ['combat_kill', 'gsi:combat-kill'],
    ['combat_death', 'gsi:combat-death'],
    ['low_health_alert', 'gsi:low-health'],
    ['tactical_timer', 'gsi:tactical-timer'],
    ['snapshot', 'gsi:snapshot'],
  ];
  for (const [eventName, channel] of forwardGsiEvents) {
    gsiServer.on(eventName, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
      }
    });
  }

  gsiServer.on('hero_detected', (data) => {
    if (data.autoSwitch && data.heroId && data.heroId !== currentHeroId) {
      selectHero(data.heroId);
    }
  });

  gsiServer.on('connection_status', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gsi:connection-status', data);
    }
    updateTrayMenu();
  });

  gsiServer.start();

  // Relay cloud voice engine events to the renderer.
  const forwardVoiceEvents = [
    ['status', 'voice:status'],
    ['agent_text_delta', 'voice:text-delta'],
    ['agent_audio_chunk', 'voice:audio-chunk'],
    ['agent_complete', 'voice:complete'],
    ['speech_interim', 'voice:user-interim'],
    ['speech_final', 'voice:user-final'],
    ['agent_audio_start', 'voice:audio-start'],
    ['interrupted', 'voice:interrupted'],
    ['translation_result', 'translate:result'],
  ];
  for (const [eventName, channel] of forwardVoiceEvents) {
    voiceClient.on(eventName, (data) => {
      if (eventName === 'status') {
        if (data?.status === 'error') {
          voiceClient.disconnect();
          voiceClient.cloudEngine.apiKey = null;
          currentVoiceProvider = null;
          updateTrayMenu();
        }
        publishVoiceStatus(data);
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
      }
    });
  }

  // Startup never connects. A saved provider is a preference, not permission to dial.
}

function setupIPC() {
  const settingsHandler = handler => async (event, payload) => {
    if (!isTrustedSettingsSender(event, aiSettingsWindow, aiSettingsURL)) {
      return { ok: false, error: '此窗口无权访问 AI 设置。' };
    }
    try { return { ok: true, ...await handler(payload) }; }
    catch (error) { return { ok: false, error: error.message }; }
  };
  ipcMain.on('ai:open-settings', (_event, purpose) => openAISettings(purpose));
  ipcMain.on('welcome:open', () => welcomeController?.open());
  ipcMain.handle('ai:microphone-privacy', settingsHandler(async () => {
    await shell.openExternal('ms-settings:privacy-microphone');
    return {};
  }));
  ipcMain.handle('ai:open-phrases', settingsHandler(() => { createPhrasesWindow(); return {}; }));
  ipcMain.handle('ai:finish-setup', settingsHandler(() => {
    // Return before closing so the calling renderer receives its result.
    const window = aiSettingsWindow;
    setImmediate(() => { if (!smokeTest) mainWindow?.show(); window?.close(); });
    return {};
  }));
  ipcMain.handle('ai:open-key-page', settingsHandler(async provider => {
    await shell.openExternal(aiKeyPage(provider));
    return {};
  }));
  ipcMain.handle('ai:get-settings', settingsHandler(() => {
    const pet = activePetPersona?.id?.replace(/^pet:/, '');
    const allowedPets = ['aurora_wolf', 'donkey_courier', 'treant_sapling', 'mischievous_greevil', 'baby_roshan'];
    return { settings: aiSettingsStore.publicSettings(), status: lastVoiceStatus,
      version: app.getVersion(), purpose: settingsPurpose,
      companionPet: allowedPets.includes(pet) ? pet : 'mischievous_greevil' };
  }));
  ipcMain.handle('ai:save-settings', settingsHandler(payload => {
    const affectsVoice = settingsAffectVoice(aiSettingsStore, payload, currentVoiceProvider);
    const settings = aiSettingsStore.save(payload);
    if (affectsVoice) stopVoiceForSettings();
    applyAIConfiguration(aiSettingsStore);
    return { settings };
  }));
  ipcMain.handle('ai:delete-secrets', settingsHandler(payload => {
    const { provider, field } = typeof payload === 'string' ? { provider: payload } : payload || {};
    stopVoiceForSettings();
    const settings = aiSettingsStore.deleteSecrets(provider, field);
    applyAIConfiguration(aiSettingsStore);
    return { settings };
  }));
  ipcMain.handle('ai:import-config', settingsHandler(async () => {
    const selected = await dialog.showOpenDialog(aiSettingsWindow || mainWindow, {
      title: '主动导入已有配置（文件只在本机读取）', properties: ['openFile'], filters: [{ name: 'JSON 配置', extensions: ['json'] }],
    });
    if (selected.canceled) return { cancelled: true };
    const file = selected.filePaths[0];
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('配置文件过大，请选择小于 1 MB 的 JSON 文件。');
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('导入文件不是有效的 JSON 配置。'); }
    stopVoiceForSettings();
    const imported = aiSettingsStore.importConfig(parsed);
    applyAIConfiguration(aiSettingsStore);
    return imported;
  }));
  ipcMain.handle('ai:test-connection', settingsHandler(async provider => {
    cancelConnectionTest();
    const controller = new AbortController();
    connectionTest = controller;
    try { return { result: await testAIConnection(aiSettingsStore, provider, { signal: controller.signal }) }; }
    finally { if (connectionTest === controller) connectionTest = null; }
  }));
  ipcMain.handle('ai:cancel-test', settingsHandler(() => { cancelConnectionTest(); return {}; }));
  ipcMain.handle('ai:test-text', settingsHandler(async provider => {
    cancelConnectionTest();
    const controller = new AbortController(); connectionTest = controller;
    try { return { result: await testAIConnection(aiSettingsStore, provider, { signal: controller.signal, textOnly: true }) }; }
    finally { if (connectionTest === controller) connectionTest = null; }
  }));
  ipcMain.handle('ai:connect', settingsHandler(provider => {
    setVoiceProvider(provider);
    return { status: lastVoiceStatus };
  }));
  ipcMain.handle('ai:disconnect', settingsHandler(() => { setVoiceProvider(null); return { status: lastVoiceStatus }; }));
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: true, ...options });
    }
  });

  // Hero Management
  ipcMain.handle('hero:get-config', () => heroesConfig);
  ipcMain.handle('hero:get-current', () => getCurrentHero());
  ipcMain.handle('hero:select', (event, heroId) => {
    selectHero(heroId);
    return getCurrentHero();
  });

  // Desktop Pet persona sync. The renderer owns pet mode/pet selection; this
  // keeps the voice engine's persona glued to whatever is on the desktop.
  // While a pet persona is active, tray/GSI hero switches only update the
  // saved hero — the courier keeps talking until pet mode is turned off.
  ipcMain.handle('pet:sync-persona', (event, payload = {}) => {
    const { isPetMode, pet } = payload;
    const previousId = activePetPersona?.id || null;
    activePetPersona = isPetMode ? buildPetPseudoHero(pet) : null;
    customizationController?.publish();
    if (isPetMode && !activePetPersona) {
      console.warn('[Pet] Pet mode synced without a usable pet manifest; keeping hero persona');
    }
    if (activePetPersona?.id !== previousId) {
      console.log(`[Pet] Voice persona -> ${activePetPersona ? `${activePetPersona.nameZh} (${activePetPersona.id})` : `hero: ${currentHeroId}`}`);
      if (voiceClient) {
        voiceClient.setHero(activePetPersona || getCurrentHero());
      }
    }
    updateTrayMenu();
    return { applied: Boolean(activePetPersona), personaId: activePetPersona?.id || currentHeroId };
  });

  // Voice Interaction IPC
  ipcMain.on('voice:send-audio-chunk', (event, chunk) => {
    if (voiceClient) {
      voiceClient.sendAudioChunk(chunk);
    }
  });

  ipcMain.on('voice:set-provider', (event, provider) => {
    setVoiceProvider(provider);
  });

  // Mic switched off with speech possibly pending: force-commit the in-flight
  // Google utterance (no-op for every other provider).
  ipcMain.on('voice:commit-utterance', () => {
    if (voiceClient) {
      voiceClient.commitUtterance();
    }
  });

  // In-Game Translation & AHK Trigger IPC
  ipcMain.handle('translate:clipboard', async () => {
    if (ahkEngine) {
      return await ahkEngine.handleClipboardTranslation(currentHeroId);
    }
    return { error: 'Translation engine not initialized' };
  });

  // Quick Phrases IPC (F6 Panel & Shortcuts)
  ipcMain.on('phrases:toggle-window', () => togglePhrasesWindow());
  ipcMain.handle('phrases:get-config', () => loadPhrasesConfig());
  ipcMain.handle('phrases:save-config', (event, phrases) => savePhrasesConfig(phrases));
  ipcMain.handle('phrases:translate-text', async (event, text) => {
    if (ahkEngine && ahkEngine.translationService) {
      const result = await ahkEngine.translationService.analyzeText(text, { heroId: currentHeroId });
      return result;
    }
    return { translated: text, meaningZh: text };
  });

  ipcMain.on('clipboard:write', (event, text) => {
    if (smokeTest) smokeClipboardText = text;
    else clipboard.writeText(text);
  });

  // Desktop Pet Roaming IPC. Motion is integrated on the renderer's vsync clock
  // (see RoamMotor) — these channels carry only intent and pixel-level results.
  ipcMain.on('roam:toggle', () => {
    if (windowState.pinned) {
      mainWindow?.webContents.send('window:pinned-changed', { pinned: true, rejected: 'roam' });
      return;
    }
    roamEngine?.toggle();
  });
  ipcMain.on('roam:start', () => {
    if (windowState.pinned) {
      mainWindow?.webContents.send('window:pinned-changed', { pinned: true, rejected: 'roam' });
      return;
    }
    roamEngine?.start();
  });
  ipcMain.on('roam:stop', () => roamEngine?.stop());
  ipcMain.on('roam:apply-x', (event, { x, epoch } = {}) => roamEngine?.applyMotorX(x, epoch));
  ipcMain.on('roam:leg-complete', (event, { epoch } = {}) => roamEngine?.handleLegComplete(epoch));
  ipcMain.on('roam:reached-bound', (event, { epoch } = {}) => roamEngine?.handleReachedBound(epoch));

  // Absolute Cursor Dragging with Windows Aero Snap immunity
  let dragOffset = null;
  let lastDragSetPos = { x: -1, y: -1 };

  ipcMain.on('window:drag-start', (_event, payload = {}) => {
    // Pinned companion is anchored: dragging is a no-op until it is unpinned.
    if (windowState.pinned) return;
    roamEngine?.pauseForInteraction();
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Prefer the pointer event's own coordinates: they are sampled at the
      // exact gesture start, while a fresh getCursorScreenPoint() here already
      // lags the real cursor by the IPC round trip.
      const cursor = Number.isFinite(payload.screenX) && Number.isFinite(payload.screenY)
        ? { x: payload.screenX, y: payload.screenY }
        : screen.getCursorScreenPoint();
      const [winX, winY] = mainWindow.getPosition();
      dragOffset = {
        x: cursor.x - winX,
        y: cursor.y - winY,
      };
      lastDragSetPos = { x: winX, y: winY };
    }
  });

  ipcMain.on('window:drag-move', (_event, payload = {}) => {
    if (mainWindow && !mainWindow.isDestroyed() && dragOffset) {
      const cursor = Number.isFinite(payload.screenX) && Number.isFinite(payload.screenY)
        ? { x: payload.screenX, y: payload.screenY }
        : screen.getCursorScreenPoint();
      const nextX = cursor.x - dragOffset.x;
      const nextY = cursor.y - dragOffset.y;

      const currentDisplay = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay();
      const { x: minX, y: minY, width: workW, height: workH } = currentDisplay.workArea;

      // Keep at least 6px away from top edge to prevent Windows Aero Snap from auto-maximizing
      // Keep at least 15px from bottom edge to prevent colliding with taskbar
      const clampedX = Math.round(Math.max(minX + 6, Math.min(nextX, minX + workW - COMPANION_WIDTH - 6)));
      const clampedY = Math.round(Math.max(minY + 6, Math.min(nextY, minY + workH - COMPANION_HEIGHT - 15)));

      if (lastDragSetPos.x !== clampedX || lastDragSetPos.y !== clampedY) {
        lastDragSetPos.x = clampedX;
        lastDragSetPos.y = clampedY;
        mainWindow.setPosition(clampedX, clampedY);
      }
    }
  });

  ipcMain.on('window:drag-end', () => {
    dragOffset = null;
    lastDragSetPos = { x: -1, y: -1 };
    roamEngine?.resumeAfterInteraction();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      }
      const [curW, curH] = mainWindow.getSize();
      if (curW !== COMPANION_WIDTH || curH !== COMPANION_HEIGHT) {
        mainWindow.setSize(COMPANION_WIDTH, COMPANION_HEIGHT);
      }
    }
  });

  // DOTA 2 Game State Integration (GSI) IPC
  ipcMain.handle('gsi:check-install', (event, customDir) => {
    return checkGsiInstalled(customDir, gsiSettings.port);
  });

  ipcMain.handle('gsi:install-config', (event, customDir) => {
    const res = installGsiConfig(customDir, gsiSettings.port);
    return res;
  });

  ipcMain.on('window:snap-to', (event, position) => {
    snapWindow(position);
  });

  ipcMain.on('window:set-pinned', (_event, pinned) => {
    setWindowPinned(pinned);
  });

  ipcMain.handle('window:get-pinned', () => windowState.pinned);

  // Companion Scaling & Compact Modes
  ipcMain.handle('window:get-scale', () => {
    const tier = SCALE_TIERS.find((t) => t.id === windowState.scaleMode) || SCALE_TIERS[0];
    return { scaleMode: tier.id, scale: tier.scale, label: tier.label };
  });

  ipcMain.on('window:set-scale', (_event, mode) => {
    setScaleMode(mode, true);
  });

  ipcMain.on('window:cycle-scale', () => {
    cycleScaleMode();
  });

  // Voice Provider Cycling
  ipcMain.on('voice:cycle-provider', () => {
    cycleVoiceProvider();
  });

  ipcMain.handle('voice:get-current-provider', () => {
    const current = VOICE_PROVIDERS.find((p) => p.id === currentVoiceProvider) || VOICE_PROVIDERS[0];
    return current;
  });

  ipcMain.on('window:center', () => {
    snapWindow('center');
  });

  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('window:close', () => {
    app.quit();
  });
}

/**
 * A failed global-shortcut registration used to vanish into the console —
 * which is exactly how "F8 does nothing in game" happened whenever the legacy
 * dota2_translator.ahk (still running from the pre-Electron setup) grabbed the
 * hotkey first. Surface it on the HUD, and name the usual suspect.
 */
function detectLegacyAhkRunning() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const query = (image) => new Promise((resolve) => {
    exec(`tasklist /FO CSV /NH /FI "IMAGENAME eq ${image}"`, { windowsHide: true }, (err, stdout) => {
      resolve(Boolean(!err && stdout && /AutoHotkey/i.test(stdout)));
    });
  });
  return query('AutoHotkey64.exe').then((found) => found || query('AutoHotkey32.exe'));
}

function reportShortcutFailures(failures) {
  const keys = failures.map((f) => f.key).join(', ');
  console.warn(`[Shortcut] ${failures.length} global hotkey(s) failed to register: ${keys}`);
  detectLegacyAhkRunning()
    .catch(() => false)
    .then((ahkRunning) => {
      const f8Lost = failures.some((f) => f.key === 'F8');
      const hint = f8Lost && ahkRunning
        ? '⚠ F8 热键被占用——检测到 AutoHotkey 正在运行，很可能是旧版 dota2_translator.ahk：请退出后重启本伴侣，否则游戏内翻译无效'
        : `⚠ 全局热键注册失败: ${keys}——可能被其他程序占用，请关闭冲突软件后重启本伴侣`;
      console.warn('[Shortcut]', hint);
      // Registration runs at startup while the renderer is still loading —
      // delay the HUD notice so it isn't sent into a void.
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('translate:result', { original: '', meaningZh: hint, intent: 'info' });
        }
      }, 3000);
    });
}

// App lifecycle
if (app?.whenReady) {  app.whenReady().then(() => {
    app.setAppUserModelId?.('fun.dota2bot.companion');
    const mediaDocuments = ['index.html', 'ai-settings.html', 'welcome.html'].map(file => pathToFileURL(path.join(__dirname, '../renderer', file)).href);
    session?.defaultSession?.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(permission === 'media' && mediaDocuments.includes(contents?.getURL()) && !details.mediaTypes?.includes('video'));
    });
    session?.defaultSession?.setPermissionCheckHandler((contents, permission, _origin, details) =>
      permission === 'media' && mediaDocuments.includes(contents?.getURL()) && details.mediaType === 'audio');
    aiSettingsStore = new AISettingsStore({ filePath: path.join(app.getPath('userData'), 'ai-settings.json'), safeStorage });
    try { applyAIConfiguration(aiSettingsStore); }
    catch (error) { lastVoiceStatus = { status: 'error', error: connectionError(error.message) }; }
    loadHeroesConfig();
    loadTranslateTargetLanguage();
    createWindow();
    if (!smokeTest) { setupTray(); setupServices(); }
    setupIPC();
    customizationController = createCustomizationController({ electron, rendererDirectory: path.join(__dirname, '../renderer'),
      getMainWindow: () => mainWindow, getHeroesConfig: () => heroesConfig,
      getCompanionHero: () => COMPANION_PSEUDO_HERO,
      getActiveKey: () => activePetPersona?.id || `hero:${currentHeroId}`, smokeTest });
    welcomeController = createWelcomeController({ electron, rendererDirectory: path.join(__dirname, '../renderer'), icon: appIcon,
      openSettings: openAISettings, openCustomization: () => customizationController?.open(), getMainWindow: () => mainWindow, smokeTest });

    if (smokeTest) {
      if (process.argv.includes('--companion-upgrade-check')) {
        try {
          if (!fs.existsSync(path.join(app.getPath('userData'), '.companion-validation'))) throw new Error('Upgrade check requires isolated fixtures');
          if (aiSettingsStore.getPrivate('google').apiKey !== 'upgrade-fixture-key') throw new Error('Upgrade lost encrypted key');
          if (!welcomeController.store.state.dismissed) throw new Error('Upgrade reset guide preference');
          const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'customization.json'), 'utf8'));
          if (!saved.profiles['hero:companion']?.appearance.assetId) throw new Error('Upgrade lost appearance');
          console.log('[Upgrade] PASS', app.getVersion()); app.exit(0);
        } catch (error) { console.error('[Upgrade]', error.message); app.exit(1); }
        return;
      }
      runCompanionSmokeTest().catch(async error => {
        console.error('[Smoke]', error.message);
        try {
          if (aiSettingsWindow && !aiSettingsWindow.isDestroyed()) fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-failure.png'), (await aiSettingsWindow.webContents.capturePage()).toPNG());
        } catch { /* Preserve the original failure even if capture is unavailable. */ }
        app.exit(1);
      }); return;
    }
    welcomeController.showOnFirstRun();
    // Load the CJS updater only in a real session; isolated smoke tests never dial out.
    import('electron-updater').then(({ default: electronUpdater }) => {
      updateService = new UpdateService({ updater: electronUpdater.autoUpdater, currentVersion: app.getVersion(), enabled: app.isPackaged && process.platform === 'win32' });
      updateController = createUpdateController({ electron, service: updateService, rendererDirectory: path.join(__dirname, '../renderer'), icon: appIcon, onState: updateTrayMenu });
      updateService.start();
      updateTrayMenu();
    }).catch(error => console.warn('[Updates] Could not initialize updater:', error.message));

    roamEngine = new DesktopRoamEngine(() => mainWindow);

    // Resolution / taskbar / monitor-layout changes move the walkable range.
    // They also switch DWM composition modes (HDR, refresh rate), which can
    // demote the companion and blank its layered surface — re-assert and
    // re-present once the compositor settles.
    const onDisplayLayoutChanged = () => {
      roamEngine?.refreshBounds();
      setTimeout(() => reassertTopmost(mainWindow, { invalidate: true }), 150);
    };
    screen.on('display-metrics-changed', onDisplayLayoutChanged);
    screen.on('display-added', onDisplayLayoutChanged);
    screen.on('display-removed', onDisplayLayoutChanged);

    // Sleep / lock-screen transitions are the other classic moment Windows
    // forgets a layered window's band membership and presentation state.
    powerMonitor.on('resume', () => reassertTopmost(mainWindow, { invalidate: true }));
    powerMonitor.on('unlock-screen', () => reassertTopmost(mainWindow, { invalidate: true }));

    // Register Global Shortcuts (F6, Ctrl/Alt+1~0, Alt+Q, Alt+T, Alt+M, Alt+H, F8, Alt+L, Alt+V, Alt+C)
    registerShortcuts(mainWindow, {
      onTriggerTranslate: () => {
        if (ahkEngine) ahkEngine.handleClipboardTranslation(currentHeroId);
      },
      onGameChatTranslate: () => {
        if (ahkEngine) ahkEngine.handleGameChatTranslate(currentHeroId);
      },
      onShortcutFailures: (failures) => {
        reportShortcutFailures(failures);
      },
      onTogglePhrasePanel: () => {
        togglePhrasesWindow();
      },
      onSendPhrase: (digit, type) => {
        sendPhraseToGame(digit, type);
      },
      onToggleRoam: () => {
        if (windowState.pinned) {
          mainWindow?.webContents.send('window:pinned-changed', { pinned: true, rejected: 'roam' });
          return;
        }
        roamEngine?.toggle();
      },
      onTogglePin: () => {
        setWindowPinned(!windowState.pinned);
      },
      onCycleVoiceProvider: () => {
        cycleVoiceProvider();
      },
      onToggleCompact: () => {
        cycleScaleMode();
      },
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.moveTop();
      }
    });
  }).catch((err) => {
    console.error('[App] Fatal startup error:', err);
  });

  app.on('will-quit', () => {
    updateController?.dispose();
    cancelConnectionTest();
    unregisterShortcuts();
    if (ahkEngine?.gameInput?.dispose) {
      ahkEngine.gameInput.dispose();
    }
    if (roamEngine) {
      roamEngine.stop();
    }
    if (gsiServer) {
      gsiServer.stop();
    }
    if (voiceClient) {
      voiceClient.disconnect();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AISettingsStore } from './aiSettingsStore.js';
import { runCustomizationSmoke } from './customizationSmoke.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The full desktop smoke run (npm run smoke): first launch, settings, voice reconnects,
 * conversation layout, customization, hero search, phrases and updates, all against an
 * isolated data directory and with no cloud account contacted. Exits the app when done.
 */
export async function runCompanionSmoke({
  app, electron, appIcon, mainWindow, controlCenter, welcomeController, customizationController, aiSettingsStore,
  settingsPage, openAISettings, setVoiceProvider, setupVoiceService, createPhrasesWindow, getCopiedText,
}) {
  const { dialog, nativeImage, safeStorage } = electron;
  if (mainWindow.getTitle() !== '刀塔宠物 · DotaPet') throw new Error('Desktop still shows legacy branding');
  const { pageLoaded, captureHub, navigateHub } = await import('./controlCenterSmoke.js');
  const firstSetup = welcomeController.showOnFirstRun();
  if (!firstSetup || firstSetup !== controlCenter.window || controlCenter.active !== 'services') throw new Error('First launch did not open configuration directly');
  const firstSetupClosed = new Promise(resolve => firstSetup.once('closed', resolve));
  await Promise.all([pageLoaded(settingsPage()), pageLoaded(firstSetup.webContents)]);
  firstSetup.setSize(620, 640);
  await new Promise(resolve => setTimeout(resolve, 150));
  await firstSetup.webContents.executeJavaScript(`(async () => {
    for (let i=0; i<100 && document.body.dataset.compact !== 'true'; i++) await new Promise(resolve=>setTimeout(resolve,20));
    if (document.body.dataset.compact !== 'true') throw new Error('Narrow settings center kept the wide sidebar');
    // Folded icons stay where the wide sidebar draws them, so folding never shifts them.
    const icon = document.querySelector('.nav-item[data-page=services] .nav-icon').getBoundingClientRect();
    if (Math.abs(icon.left + icon.width / 2 - 32) > 1) throw new Error('Folded sidebar icons are not centred where the wide sidebar draws them');
    if (!document.querySelector('.app-chrome #sidebar-toggle')) throw new Error('Sidebar fold control is not in the title bar');
    const current = document.querySelector('.nav-item[aria-current=page]');
    if (current?.dataset.page !== 'services') throw new Error('Sidebar does not mark the setup page');
    if (document.querySelector('.nav-item[data-page=update]').hidden === false) throw new Error('Update entry shown without an updater');
  })()`);
  await settingsPage().executeJavaScript(`(async () => {
    for (let i=0; i<100 && document.getElementById('provider').disabled; i++) await new Promise(resolve=>setTimeout(resolve,40));
    if(document.querySelectorAll('.provider-option').length !== 4) throw new Error('First launch did not show all four services');
    if(!document.getElementById('translate-card') || document.getElementById('translate-secret')) throw new Error('First launch should share the Qwen key with translation');
    if(document.getElementById('advanced').open) throw new Error('First launch opened advanced controls');
    const skip=document.getElementById('skip').getBoundingClientRect(), primary=document.getElementById('connect').getBoundingClientRect();
    if(skip.bottom > innerHeight || primary.bottom > document.querySelector('footer').getBoundingClientRect().top) throw new Error('First setup action outside viewport: '+JSON.stringify({ width:innerWidth,height:innerHeight,skip:skip.bottom,primary:primary.bottom }));
    document.getElementById('skip').click();
  })()`);
  await firstSetupClosed;
  if (!welcomeController.store.state.dismissed || welcomeController.showOnFirstRun()) throw new Error('First setup dismissal was not persisted');
  aiSettingsStore.save({ provider: 'google', secrets: { apiKey: 'smoke-encrypted-key' } });
  if (fs.readFileSync(aiSettingsStore.filePath, 'utf8').includes('smoke-encrypted-key')) throw new Error('Vault contains plaintext');
  const reloaded = new AISettingsStore({ filePath: aiSettingsStore.filePath, safeStorage });
  if (reloaded.getPrivate('google').apiKey !== 'smoke-encrypted-key') throw new Error('Encrypted key did not survive reload');
  aiSettingsStore.deleteSecrets('google');
  openAISettings();
  const page = settingsPage();
  await Promise.all([pageLoaded(page), pageLoaded(controlCenter.window.webContents)]);
  const result = await page.executeJavaScript(`(async () => {
    const waitFor = async predicate => {
      for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error('Settings UI timed out');
    };
    const get = id => document.getElementById(id);
    await waitFor(() => !get('provider').disabled);
    const change = (id, value) => { get(id).value = value; get(id).dispatchEvent(new Event('change')); };
    const type = (id, value) => { get(id).value = value; get(id).dispatchEvent(new Event('input')); };
    if (get('provider').options.length !== 4 || !window.electronAPI) throw new Error('Four-provider voice setup missing');
    if (document.querySelectorAll('.provider-option').length !== 4 || get('voice').options.length !== 3) throw new Error('Simple provider or voice choices missing');
    change('provider', 'qwen');
    if (document.querySelectorAll('#translator-options button').length !== 2 || get('translate-secret')) throw new Error('Translation should reuse the Qwen key without a second box');
    change('provider', 'doubao');
    if (!get('translate-secret')) throw new Error('Translation must ask for its own key when voice uses another account');
    if ('copyToClipboard' in window.electronAPI || 'sendAudioChunk' in window.electronAPI) throw new Error('Settings preload exposes unrelated app controls');
    if (get('advanced').open) throw new Error('Advanced setup should be collapsed initially');
    change('provider', 'google');
    change('all-voices', 'Charon');
    change('provider', 'qwen'); change('provider', 'google');
    if (get('voice').value !== 'Charon') throw new Error('Switching providers lost the draft voice');
    type('secret-apiKey', 'smoke-google-key');
    type('preferred-address', 'Daddy');
    type('custom-instructions', 'Call my friend James Jay.');
    change('google-mode', 'google-translate');
    if (get('secret-apiKey').value !== 'smoke-google-key') throw new Error('Gemini modes did not share the key draft');
    change('google-mode', 'google');
    get('save').click();
    await waitFor(() => !get('save').disabled);
    if (get('secret-apiKey').value || !get('secret-apiKey').placeholder.includes('已保存')) throw new Error('Key was not cleared or saved');
    const savedPreferences = (await window.electronAPI.getAISettings()).settings.conversation;
    if (savedPreferences.preferredAddress !== 'Daddy' || savedPreferences.customInstructions !== 'Call my friend James Jay.') throw new Error('Chat preferences were not persisted through settings IPC');
    change('google-mode', 'google-translate');
    if (!get('secret-apiKey').placeholder.includes('已保存')) throw new Error('Gemini translation did not share the saved key');
    change('google-mode', 'google');
    change('provider', 'qwen');
    if (get('secret-apiKey').value) throw new Error('Key leaked across provider switch');
    change('provider', 'google');
    const remove = document.querySelector('#secret-fields .key-remove');
    remove.click(); remove.click(); await waitFor(() => !get('save').disabled);
    if (get('secret-apiKey').placeholder.includes('已保存')) throw new Error('Key was not deleted');
    change('provider', 'qwen');
    get('advanced').open = false;
    const state = await window.electronAPI.getAISettings();
    if (JSON.stringify(state).includes('smoke-google-key')) throw new Error('Public IPC leaked a key');
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport) throw new Error('Settings page overflows horizontally');
    const primary = get('connect').getBoundingClientRect();
    if (primary.bottom > innerHeight) throw new Error('Primary setup action requires scrolling');
    return { providerCount: state.settings.providers.length, visibleVoiceProviders: 4, directFirstSetup: true, encryptedStorage: state.settings.encryptionAvailable };
  })()`);
  // The microphone check and help now live in settings; the old guide window is gone.
  const onboarding = await page.executeJavaScript(`(async () => {
    const waitFor = async predicate => { for(let i=0;i<350;i++){ if(predicate()) return; await new Promise(r=>setTimeout(r,40)); } throw new Error('Microphone check timed out: '+document.getElementById('mic-status').textContent); };
    const get = id => document.getElementById(id);
    const acquired=[]; const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);acquired.push(stream);return stream;};
    get('advanced').open = true;
    get('mic-start').click();
    // Hosted Windows runners can open Chromium's fake device but have no active
    // audio output clock. Both detected sound and a clean silent result are valid;
    // signal classification is covered separately by the microphone unit tests.
    await waitFor(()=>get('mic-status').textContent.includes('麦克风已关闭'));
    const detectedSound=get('mic-status').textContent.includes('检查通过');
    if(!detectedSound && !get('mic-status').textContent.includes('设备已打开，但没有检测到明显声音')) throw new Error('Unexpected microphone result');
    if(acquired.some(stream=>stream.getTracks().some(track=>track.readyState!=='ended'))) throw new Error('Check left microphone open');
    get('mic-start').click(); await waitFor(()=>acquired.length===2);
    get('provider').value='doubao'; get('provider').dispatchEvent(new Event('change'));
    if(acquired.some(stream=>stream.getTracks().some(track=>track.readyState!=='ended'))) throw new Error('Changing provider left microphone open');
    get('provider').value='qwen'; get('provider').dispatchEvent(new Event('change'));
    get('mic-start').click(); await waitFor(()=>acquired.length===3);
    window.__micStreams = acquired;
    return { localMicrophone:true, detectedSound, stoppedOnNavigation:true };
  })()`);
  // Leaving the page in the sidebar must release the microphone and keep unsaved input.
  await page.executeJavaScript(`(() => {
    const provider = document.getElementById('provider'); provider.value = 'doubao'; provider.dispatchEvent(new Event('change'));
    const input = document.getElementById('secret-apiKey'); input.value = 'smoke-unsaved-draft'; input.dispatchEvent(new Event('input'));
  })()`);
  await navigateHub(controlCenter, 'appearance');
  await pageLoaded(controlCenter.contents('appearance'));
  await page.executeJavaScript(`(async () => {
    for (let i=0; i<100 && window.__micStreams.some(s=>s.getTracks().some(t=>t.readyState!=='ended')); i++) await new Promise(r=>setTimeout(r,20));
    if (window.__micStreams.some(s=>s.getTracks().some(t=>t.readyState!=='ended'))) throw new Error('Switching pages left microphone open');
  })()`);
  openAISettings('help');
  if (controlCenter.active !== 'help') throw new Error('Help request did not open the help page');
  await controlCenter.window.webContents.executeJavaScript(`(async () => {
    for (let i=0; i<100 && document.getElementById('page-help').hidden; i++) await new Promise(r=>setTimeout(r,20));
    if (document.getElementById('page-help').hidden) throw new Error('Help page not shown');
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) throw new Error('Help overflows horizontally');
  })()`);
  openAISettings('translate');
  if (controlCenter.active !== 'services' || settingsPage() !== page) throw new Error('Translate request did not return to the same settings page');
  await page.executeJavaScript(`(async () => {
    const get = id => document.getElementById(id);
    if (get('provider').value !== 'doubao' || get('secret-apiKey').value !== 'smoke-unsaved-draft') throw new Error('Switching pages lost an unsaved key');
    get('secret-apiKey').value = ''; get('secret-apiKey').dispatchEvent(new Event('input'));
    get('provider').value = 'qwen'; get('provider').dispatchEvent(new Event('change'));
    get('advanced').open = false;
  })()`);
  openAISettings();
  if (controlCenter.active !== 'services') throw new Error('Reopening without a purpose changed the page');
  // The settings center is its own taskbar window; while it has focus the pet steps back.
  controlCenter.window.emit('focus');
  if (mainWindow.isAlwaysOnTop()) throw new Error('Pet stayed above the focused settings center');
  controlCenter.window.emit('blur');
  if (!mainWindow.isAlwaysOnTop()) throw new Error('Pet did not return on top after settings lost focus');
  const vault = fs.readFileSync(aiSettingsStore.filePath, 'utf8');
  if (vault.includes('smoke-google-key')) throw new Error('Vault contains plaintext');
  const outputArg = process.argv.find(value => value.startsWith('--companion-smoke-output='));
  if (outputArg) {
    const capture = () => captureHub(controlCenter, nativeImage);
    const image = await capture();
    if (image.isEmpty()) throw new Error('Settings screenshot is empty');
    const output = path.resolve(outputArg.slice('--companion-smoke-output='.length));
    fs.writeFileSync(output, image.toPNG());
    for (const state of ['connecting', 'connected', 'error']) {
      page.send('voice:status', { status: state, providerId: 'qwen', ...(state === 'error' ? { error: '请检查密钥与网络后重试。' } : {}) });
      await page.executeJavaScript(`(async () => {
        for (let i=0; i<100 && document.getElementById('connection-status').dataset.state !== '${state}'; i++) await new Promise(resolve=>setTimeout(resolve,20));
        if (document.getElementById('connection-status').dataset.state !== '${state}') throw new Error('Connection state did not update');
        if ('${state}' === 'connecting' && !document.getElementById('connect').disabled) throw new Error('Connecting allowed duplicate starts');
        if ('${state}' === 'connected' && document.getElementById('finish').hidden) throw new Error('Connected setup did not offer completion');
      })()`);
      fs.writeFileSync(output.replace(/\.png$/, `-${state}.png`), (await capture()).toPNG());
    }
    page.send('voice:status', { status: 'disconnected', providerId: 'qwen' });
    await page.executeJavaScript("document.getElementById('feedback').textContent = ''; document.getElementById('feedback').dataset.kind = ''");
    await page.executeJavaScript("document.getElementById('advanced').open = true; window.scrollTo(0, document.body.scrollHeight)");
    fs.writeFileSync(output.replace(/\.png$/, '-actions.png'), (await capture()).toPNG());
    await navigateHub(controlCenter, 'help');
    fs.writeFileSync(output.replace(/\.png$/, '-help.png'), (await capture()).toPNG());
    await navigateHub(controlCenter, 'services');
    // The pet rests alone; toolbars appear on hover; right-click holds the everyday actions.
    const petShot = async (script, name) => {
      await mainWindow.webContents.executeJavaScript(`${script}; new Promise(resolve => setTimeout(resolve, 300))`);
      await mainWindow.webContents.capturePage();
      fs.writeFileSync(output.replace(/\.png$/, `-${name}.png`), (await mainWindow.webContents.capturePage()).toPNG());
    };
    // Hidden windows do not advance CSS fades; capture the real final hover state.
    await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.hud-top-bar, .hud-bottom-dock').forEach(element => element.style.transition = 'none')");
    await petShot("document.body.classList.remove('hud-awake')", 'pet-rest');
    await petShot("document.body.classList.add('hud-awake')", 'pet-hover');
    // A hidden smoke window does not advance the menu's fade-in animation.
    await petShot("const menu = document.getElementById('pet-context-menu'); menu.style.animation = 'none'; menu.classList.remove('hidden')", 'pet-menu');
    await mainWindow.webContents.executeJavaScript("document.getElementById('pet-context-menu').style.animation = ''; document.getElementById('pet-context-menu').classList.add('hidden'); document.body.classList.remove('hud-awake')");
    await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.hud-top-bar, .hud-bottom-dock').forEach(element => element.style.transition = '')");
    await page.executeJavaScript("document.getElementById('advanced').open = false; document.getElementById('provider').value = 'doubao'; document.getElementById('provider').dispatchEvent(new Event('change')); window.scrollTo(0,0)");
    fs.writeFileSync(output.replace(/\.png$/, '-doubao.png'), (await capture()).toPNG());
    controlCenter.window.setSize(620, 730);
    await new Promise(resolve => setTimeout(resolve, 150));
    const overflow = await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth');
    if (overflow) throw new Error('Narrow settings page overflows horizontally');
    fs.writeFileSync(output.replace(/\.png$/, '-narrow.png'), (await capture()).toPNG());
    controlCenter.window.setSize(1060, 820);
    await new Promise(resolve => setTimeout(resolve, 150));
    await page.executeJavaScript("document.getElementById('provider').value = 'qwen'; document.getElementById('provider').dispatchEvent(new Event('change')); document.querySelector('#translator-options [data-provider=deepseek]').click(); document.getElementById('translate-card').scrollIntoView()");
    fs.writeFileSync(output.replace(/\.png$/, '-translation.png'), (await capture()).toPNG());
    await page.executeJavaScript("if(!document.getElementById('translate-secret')) throw new Error('DeepSeek translation did not ask for its key'); document.querySelector('#translator-options [data-provider=qwen]').click(); window.scrollTo(0,0)");
  }
  const { runConversationSmoke } = await import('./conversationSmoke.js');
  const { voiceClient, voiceConnection } = setupVoiceService();
  const { runVoiceReconnectSmoke } = await import('./voiceReconnectSmoke.js');
  const { conversation, ...voiceReconnect } = await runVoiceReconnectSmoke({ mainWindow, store: aiSettingsStore, client: voiceClient,
    connection: voiceConnection, disconnect: () => setVoiceProvider(null), getSettingsWindow: () => controlCenter.window,
    runConversation: () => runConversationSmoke({ mainWindow, outputDirectory: app.getPath('userData') }) });
  const customizationResult = await runCustomizationSmoke({ controller: customizationController, controlCenter, mainWindow, dialog, nativeImage, outputDirectory: app.getPath('userData') });
  const { runHeroSearchSmoke } = await import('./heroSearchSmoke.js');
  const heroSearch = await runHeroSearchSmoke({ mainWindow, outputDirectory: app.getPath('userData') });
  const { runPhrasesSmoke } = await import('./phrasesSmoke.js');
  const phrases = await runPhrasesSmoke({ controlCenter, openPanel: () => createPhrasesWindow(),
    getCopiedText, nativeImage, outputDirectory: app.getPath('userData') });
  const { runUpdateSmoke } = await import('./updateSmoke.js');
  const updates = await runUpdateSmoke({ electron, rendererDirectory: path.join(__dirname, '../renderer'), controlCenter, icon: appIcon, outputDirectory: app.getPath('userData') });
  // Last: quitting from the pet must not leave the (unowned) settings center behind.
  controlCenter.open();
  const settingsClosed = new Promise(resolve => controlCenter.window.once('closed', resolve));
  mainWindow.close();
  await Promise.race([settingsClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('Settings center outlived the pet window')), 3000))]);
  console.log('[Smoke] PASS', JSON.stringify({ ...result, onboarding, conversation, voiceReconnect, customization: customizationResult, heroSearch, phrases, updates, settingsClosesWithPet: true }));
  app.exit(0);
}

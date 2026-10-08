// Synthetic user data encrypted by the current Windows account. Never uses real credentials.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const directory = path.resolve(process.argv[2]);
if (!fs.existsSync(path.join(directory, '.companion-validation'))) throw new Error('Requires a marked, isolated validation directory');
// Windows Chromium stores its encrypted master key in this profile's Local State.
app.setPath('userData', directory);
app.whenReady().then(async () => {
  const { AISettingsStore } = await import(pathToFileURL(path.resolve(__dirname, '../src/main/aiSettingsStore.js')).href);
  const { CustomizationStore } = await import(pathToFileURL(path.resolve(__dirname, '../src/main/customizationStore.js')).href);
  const store = new AISettingsStore({ filePath: path.join(directory, 'ai-settings.json'), safeStorage });
  store.save({ provider: 'google', secrets: { apiKey: 'upgrade-fixture-key' } });
  const customization = new CustomizationStore(directory);
  const asset = customization.importImage({ name: '升级验收形象', dataUrl: 'data:image/svg+xml;base64,' + fs.readFileSync(path.resolve(__dirname, '../src/renderer/assets/app-icon.svg')).toString('base64') });
  customization.saveProfile('hero:companion', { appearance: { assetId: asset.id } });
  fs.writeFileSync(path.join(directory, 'welcome.json'), JSON.stringify({ dismissed: true, version: '1.0.0' }));
  fs.writeFileSync(path.join(directory, 'custom_phrases.json'), JSON.stringify([{ text: '升级保留测试', translation: 'upgrade preserved' }]));
  console.log('Upgrade fixtures seeded with OS encrypted synthetic key and custom appearance.');
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

// Capture the real app through its isolated smoke fixtures. No personal keys,
// cloud connection, actual update download, or changes to a user's companion.
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'docs/images');
const settingsOnly = process.argv.includes('--settings-only');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-docs-'));

async function capture(language) {
  const directory = path.join(staging, language);
  fs.mkdirSync(directory);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const args = ['.', '--companion-smoke-test',
    '--companion-docs-screenshots',
    ...(language === 'full' ? [] : [`--lang=${language}`]),
    '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    `--companion-data-dir=${directory}`,
    `--companion-smoke-output=${path.join(directory, 'ai-settings.png')}`];
  await new Promise((resolve, reject) => {
    const child = spawn(electron, args, { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill(), 90000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !output.includes('[Smoke] PASS')) return reject(new Error(`${language} capture failed:\n${output}`));
      console.log(`Captured ${language} UI; smoke checks passed.`);
      resolve();
    });
  });
  return directory;
}

const full = await capture('full');
const chinese = await capture('zh');
const english = await capture('en');
const images = [
  [chinese, 'language-services.png', 'welcome.png'],
  [chinese, 'language-chat-preferences.png', 'chat-preferences.png'],
  [full, 'ai-settings-translation.png', 'translation-settings.png'],
  [chinese, 'language-appearance.png', 'appearance.png'],
  [chinese, 'language-phrases.png', 'phrases.png'],
  [chinese, 'language-help.png', 'help.png'],
  [chinese, 'language-f6.png', 'quick-phrases.png'],
  [full, 'update-sidebar.png', 'update.png'],
  [full, 'ai-settings-pet-rest.png', 'pet-rest.png'],
  [full, 'ai-settings-pet-hover.png', 'pet-toolbar.png'],
  [english, 'language-services.png', 'settings-en.png'],
  [english, 'language-chat-preferences.png', 'chat-preferences-en.png'],
  [english, 'language-appearance.png', 'appearance-en.png'],
  [english, 'language-phrases.png', 'phrases-en.png'],
  [english, 'language-help.png', 'help-en.png'],
  [english, 'language-f6.png', 'quick-phrases-en.png'],
].filter(([, , destination]) => !settingsOnly || ['welcome.png', 'settings-en.png', 'chat-preferences.png', 'chat-preferences-en.png', 'translation-settings.png'].includes(destination));
// Validate the whole capture before replacing any documentation images.
for (const [directory, source] of images) {
  const file = path.join(directory, source);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) throw new Error(`Missing or empty capture: ${file}`);
}
fs.mkdirSync(target, { recursive: true });
for (const [directory, source, destination] of images) fs.copyFileSync(path.join(directory, source), path.join(target, destination));
console.log(`Refreshed ${images.length} screenshots in docs/images. Isolated fixtures: ${staging}`);

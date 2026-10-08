import fs from 'node:fs';
import path from 'node:path';
import { captureHub, navigateHub } from './controlCenterSmoke.js';

/** Exercise the real sidebar entry, phrase editor, and isolated persistence. */
export async function runPhrasesSmoke({ controlCenter, getWindow, getCopiedText, nativeImage, outputDirectory }) {
  controlCenter.open('services');
  // Keyboard users switch pages from inside a page, where Tab cannot reach the sidebar.
  const page = controlCenter.contents('services');
  page.focus();
  page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] });
  for (let i = 0; i < 50 && controlCenter.active !== 'appearance'; i++) await new Promise(r => setTimeout(r, 20));
  if (controlCenter.active !== 'appearance') throw new Error('Ctrl+Tab did not switch settings pages');
  await navigateHub(controlCenter, 'phrases');
  fs.writeFileSync(path.join(outputDirectory, 'phrases-page.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  await controlCenter.window.webContents.executeJavaScript(`(async () => {
    if (document.getElementById('page-phrases').hidden) throw new Error('Phrases page not shown');
    if ('getAISettings' in window.controlCenter || 'copyToClipboard' in window.controlCenter) throw new Error('Sidebar exposes page controls');
    const open = document.getElementById('open-phrases');
    open.click();
    for (let i = 0; i < 100 && open.disabled; i++) await new Promise(r => setTimeout(r, 20));
    if (document.getElementById('phrases-feedback').textContent) throw new Error('Sidebar could not open phrases');
  })()`);
  const window = getWindow();
  if (!window) throw new Error('Sidebar phrase entry did not create the editor');
  // loadFile can finish before we attach the listener; wait on the actual DOM.
  const copy = await window.webContents.executeJavaScript(`(async () => {
    const wait = async fn => { for(let i=0; i<150; i++) { if(fn()) return; await new Promise(r=>setTimeout(r,20)); } throw new Error('Phrase editor timed out'); };
    await wait(() => document.querySelectorAll('.phrase-row-item').length === 10);
    const row = document.querySelector('.phrase-row-item');
    const text = row.querySelector('.phrase-en').value;
    if(!text) throw new Error('Default English phrases missing');
    row.querySelector('[data-type=en]').click();
    return text;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (getCopiedText() !== copy) throw new Error('English copy failed');
  const chinese = await window.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('.phrase-row-item');
    row.querySelector('[data-type=cn]').click();
    return row.querySelector('.phrase-cn').value;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (getCopiedText() !== chinese) throw new Error('Chinese copy failed');
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.phrase-en').value = 'Smoke test phrase';
    document.getElementById('btn-save-phrases').click();
    for(let i=0; i<100 && document.getElementById('btn-save-phrases').disabled; i++) await new Promise(r=>setTimeout(r,20));
    if(!document.getElementById('hud-toast').textContent.includes('已保存')) throw new Error('Phrases were not saved');
    // Cover the old delayed auto-close, not just the immediate save result.
    await new Promise(r=>setTimeout(r,1100));
  })()`);
  if (window.isDestroyed()) throw new Error('Saving closed the quick-copy panel');
  const saved = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'custom_phrases.json'), 'utf8'));
  if (saved[0].en !== 'Smoke test phrase') throw new Error('Phrase changes not persisted');
  window.setSize(880, 780);
  await new Promise(resolve => setTimeout(resolve, 150));
  await window.webContents.executeJavaScript(`(() => {
    for(const row of document.querySelectorAll('.phrase-row-item')) {
      const bounds=row.getBoundingClientRect(), english=row.querySelector('.phrase-en').getBoundingClientRect();
      for(const button of row.querySelectorAll('button')) {
        const action=button.getBoundingClientRect();
        if(action.right > bounds.right || action.left < english.right) throw new Error('Copy actions overlap phrase text');
      }
    }
  })()`);
  await window.webContents.capturePage();
  await window.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(path.join(outputDirectory, 'phrases.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(620, 520);
  await new Promise(resolve => setTimeout(resolve, 150));
  await window.webContents.executeJavaScript(`(() => {
    if(document.documentElement.scrollWidth > document.documentElement.clientWidth) throw new Error('Narrow phrases overflow horizontally');
    const footer = document.querySelector('.phrases-modal-footer').getBoundingClientRect();
    if(footer.bottom > innerHeight || footer.top < 0) throw new Error('Phrase actions outside viewport');
    for(const button of document.querySelectorAll('.phrase-row-actions button')) {
      const bounds=button.getBoundingClientRect();
      if(bounds.right > innerWidth || bounds.left < 0) throw new Error('Copy action outside viewport');
    }
  })()`);
  await window.webContents.capturePage();
  await window.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(path.join(outputDirectory, 'phrases-narrow.png'), (await window.webContents.capturePage()).toPNG());
  window.close();
  return { sidebarEntry: true, bilingualCopy: true, saveKeepsOpen: true, narrowLayout: true };
}

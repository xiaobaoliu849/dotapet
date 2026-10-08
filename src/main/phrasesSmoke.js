import fs from 'node:fs';
import path from 'node:path';
import { captureHub, navigateHub, pageLoaded } from './controlCenterSmoke.js';

/** executeJavaScript loses thrown messages for some failures; name the step. */
async function run(contents, script) {
  try { return await contents.executeJavaScript(script); }
  catch (error) { throw new Error(`${error.message} in: ${script.replace(/\s+/g, ' ').slice(0, 120)}`); }
}
const rowsReady = `(async () => {
  for (let i = 0; i < 150 && document.querySelectorAll('.phrase-row-item').length !== 10; i++) await new Promise(r => setTimeout(r, 20));
  if (document.querySelectorAll('.phrase-row-item').length !== 10) throw new Error('Phrase editor timed out');
})()`;
const english = row => `document.querySelectorAll('.phrase-en')[${row}]`;
const typeEnglish = (row, text) => `(() => { const input = ${english(row)}; input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const save = `(async () => {
  const button = document.getElementById('btn-save-phrases');
  button.click();
  for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
  if (!document.getElementById('hud-toast').textContent.includes('已保存')) throw new Error('Phrases were not saved');
})()`;
const waitForEnglish = (row, text) => `(async () => {
  for (let i = 0; i < 100 && ${english(row)}.value !== ${JSON.stringify(text)}; i++) await new Promise(r => setTimeout(r, 20));
  return ${english(row)}.value;
})()`;

/** The settings page edits phrases in place; the F6 panel stays in sync with it. */
export async function runPhrasesSmoke({ controlCenter, openPanel, getCopiedText, nativeImage, outputDirectory }) {
  controlCenter.open('services');
  // Keyboard users switch pages from inside a page, where Tab cannot reach the sidebar.
  const services = controlCenter.contents('services');
  services.focus();
  services.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] });
  for (let i = 0; i < 50 && controlCenter.active !== 'appearance'; i++) await new Promise(r => setTimeout(r, 20));
  if (controlCenter.active !== 'appearance') throw new Error('Ctrl+Tab did not switch settings pages');

  await navigateHub(controlCenter, 'phrases');
  const page = controlCenter.contents('phrases');
  await pageLoaded(page);
  await run(page, rowsReady);
  const copy = await run(page, `(() => {
    if (document.documentElement.dataset.embedded !== 'true') throw new Error('Settings page did not embed the editor');
    if (getComputedStyle(document.getElementById('btn-cancel-phrases')).display !== 'none') throw new Error('Embedded editor offers to close a window it does not own');
    if ('sendAudioChunk' in window.electronAPI || 'getAISettings' in window.electronAPI) throw new Error('Phrase editor exposes unrelated controls');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const row = document.querySelector('.phrase-row-item');
    const text = row.querySelector('.phrase-en').value;
    if (!text) throw new Error('Default English phrases missing');
    row.querySelector('[data-type=en]').click();
    return text;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (page.isDestroyed() || controlCenter.active !== 'phrases') throw new Error('Escape closed the embedded editor');
  if (getCopiedText() !== copy) throw new Error('English copy failed');
  const chinese = await run(page, `(() => {
    const row = document.querySelector('.phrase-row-item');
    row.querySelector('[data-type=cn]').click();
    return row.querySelector('.phrase-cn').value;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (getCopiedText() !== chinese) throw new Error('Chinese copy failed');
  await run(page, typeEnglish(0, 'Smoke test phrase'));
  await run(page, save);
  const saved = () => JSON.parse(fs.readFileSync(path.join(outputDirectory, 'custom_phrases.json'), 'utf8'));
  if (saved()[0].en !== 'Smoke test phrase') throw new Error('Phrase changes not persisted');
  await run(page, `new Promise(r => setTimeout(r, 2600))`); // let the toast fade for the screenshot
  fs.writeFileSync(path.join(outputDirectory, 'phrases-page.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // F6 still opens the floating in-game panel with the same list.
  const panel = openPanel();
  await pageLoaded(panel.webContents);
  await run(panel.webContents, rowsReady);
  if (await run(panel.webContents, `${english(0)}.value`) !== 'Smoke test phrase') throw new Error('F6 panel shows a different list');
  if (await run(panel.webContents, `document.documentElement.dataset.embedded === 'true'`)) throw new Error('F6 panel lost its own style');
  // A save in the settings page refreshes an untouched panel...
  await run(page, typeEnglish(1, 'Synced from settings'));
  await run(page, save);
  if (await run(panel.webContents, waitForEnglish(1, 'Synced from settings')) !== 'Synced from settings') throw new Error('F6 panel did not pick up the saved list');
  // ...but never replaces edits the panel has not saved yet.
  await run(panel.webContents, typeEnglish(2, 'Panel draft'));
  await run(page, typeEnglish(3, 'Second settings save'));
  await run(page, save);
  await new Promise(resolve => setTimeout(resolve, 150));
  await run(panel.webContents, `(() => {
    if (${english(2)}.value !== 'Panel draft') throw new Error('A save elsewhere overwrote unsaved panel edits');
    if (${english(3)}.value !== 'Second settings save') throw new Error('Rows not being edited did not sync');
    if (!document.getElementById('hud-toast').textContent.includes('已同步')) throw new Error('Panel did not explain the other save');
  })()`);
  // Saving the panel reaches the settings page, which has nothing unsaved.
  await run(panel.webContents, save);
  if (await run(page, waitForEnglish(2, 'Panel draft')) !== 'Panel draft') throw new Error('Settings page did not pick up the panel save');
  if (saved()[2].en !== 'Panel draft' || saved()[3].en !== 'Second settings save') throw new Error('Final phrase list is wrong');
  // Both editors can submit before receiving the other's save notification.
  await run(page, typeEnglish(4, 'Concurrent settings save'));
  await run(panel.webContents, typeEnglish(5, 'Concurrent panel save'));
  await Promise.all([run(page, save), run(panel.webContents, save)]);
  if (await run(page, waitForEnglish(5, 'Concurrent panel save')) !== 'Concurrent panel save' ||
      await run(panel.webContents, waitForEnglish(4, 'Concurrent settings save')) !== 'Concurrent settings save') throw new Error('Concurrent phrase saves did not merge');
  if (saved()[4].en !== 'Concurrent settings save' || saved()[5].en !== 'Concurrent panel save') throw new Error('Concurrent phrase saves lost a row');
  // A conflicting row never silently replaces the saved version.
  await run(page, typeEnglish(6, 'Settings conflicting row'));
  await run(panel.webContents, typeEnglish(6, 'Panel conflicting row'));
  await run(page, save);
  await run(panel.webContents, `(async () => {
    const button = document.getElementById('btn-save-phrases'); button.click();
    for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
    if (!document.getElementById('hud-toast').textContent.includes('本次未保存') || !button.textContent.includes('确认覆盖')) throw new Error('Conflicting save did not explain overwrite');
    if (${english(6)}.value !== 'Panel conflicting row') throw new Error('Conflict erased the local draft');
  })()`);
  if (saved()[6].en !== 'Settings conflicting row') throw new Error('Conflict overwrote the saved row');
  // The longer overwrite action must stay reachable at the panel's minimum size.
  panel.setSize(620, 520);
  await new Promise(resolve => setTimeout(resolve, 150));
  await run(panel.webContents, `(() => {
    const footer = document.querySelector('.phrases-modal-footer').getBoundingClientRect();
    const button = document.getElementById('btn-save-phrases').getBoundingClientRect();
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        footer.bottom > innerHeight + 1 || button.right > innerWidth || button.left < 0) throw new Error('Conflict actions overflow the narrow panel');
  })()`);
  await panel.webContents.capturePage();
  await run(panel.webContents, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(path.join(outputDirectory, 'phrases-conflict.png'), (await panel.webContents.capturePage()).toPNG());
  panel.setSize(880, 780);
  await run(panel.webContents, save);
  if (await run(page, waitForEnglish(6, 'Panel conflicting row')) !== 'Panel conflicting row') throw new Error('Confirmed overwrite did not synchronize');
  // Cover the old delayed auto-close, not just the immediate save result.
  await new Promise(resolve => setTimeout(resolve, 1100));
  if (panel.isDestroyed()) throw new Error('Saving closed the quick-copy panel');

  panel.setSize(880, 780);
  await new Promise(resolve => setTimeout(resolve, 150));
  await run(panel.webContents, `(() => {
    for(const row of document.querySelectorAll('.phrase-row-item')) {
      const bounds=row.getBoundingClientRect(), english=row.querySelector('.phrase-en').getBoundingClientRect();
      for(const button of row.querySelectorAll('button')) {
        const action=button.getBoundingClientRect();
        if(action.right > bounds.right || action.left < english.right) throw new Error('Copy actions overlap phrase text');
      }
    }
  })()`);
  await panel.webContents.capturePage();
  await run(panel.webContents, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(path.join(outputDirectory, 'phrases.png'), (await panel.webContents.capturePage()).toPNG());
  // Returns the problem instead of throwing so the message survives executeJavaScript.
  const fits = `(() => {
    if(document.documentElement.scrollWidth > document.documentElement.clientWidth) return 'overflows horizontally: ' + document.documentElement.scrollWidth + ' > ' + document.documentElement.clientWidth;
    const footer = document.querySelector('.phrases-modal-footer').getBoundingClientRect();
    // Fractional display scaling can put an edge a hair past the viewport.
    if(footer.bottom > innerHeight + 1 || footer.top < 0) return 'actions outside viewport: ' + JSON.stringify({ top: footer.top, bottom: footer.bottom, innerHeight });
    for(const button of document.querySelectorAll('.phrase-row-actions button')) {
      const bounds=button.getBoundingClientRect();
      if(bounds.right > innerWidth || bounds.left < 0) return 'copy action outside viewport: ' + bounds.right + ' > ' + innerWidth;
    }
    return '';
  })()`;
  const checkFits = async (contents, name) => {
    const problem = await run(contents, fits);
    if (problem) throw new Error(`Narrow ${name}: ${problem}`);
  };
  panel.setSize(620, 520);
  await new Promise(resolve => setTimeout(resolve, 150));
  await checkFits(panel.webContents, 'F6 panel');
  await panel.webContents.capturePage();
  await run(panel.webContents, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(path.join(outputDirectory, 'phrases-narrow.png'), (await panel.webContents.capturePage()).toPNG());
  panel.close();

  // The settings page at the settings center's minimum size.
  controlCenter.window.setSize(620, 640);
  await new Promise(resolve => setTimeout(resolve, 150));
  await checkFits(page, 'settings phrases page');
  fs.writeFileSync(path.join(outputDirectory, 'phrases-page-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  return { settingsPage: true, bilingualCopy: true, panelSync: true, concurrentSaves: true, conflictKeepsDraft: true,
    confirmedOverwrite: true, keepsUnsavedEdits: true, saveKeepsOpen: true, narrowLayout: true };
}

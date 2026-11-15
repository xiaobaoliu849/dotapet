import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';
import { recordAnswer } from '../learning/model.js';
import { fetchCatalog } from '../learning/update.js';

export function createLearningController({ electron, hub, rendererDirectory, dataDirectory }) {
  const { ipcMain, shell } = electron;
  const catalogFile = path.join(dataDirectory, 'learning-catalog.json');
  const progressFile = path.join(dataDirectory, 'learning-progress.json');
  const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const bundled = read(path.join(rendererDirectory, '../learning/catalog.json'), null);
  const cached = read(catalogFile, null);
  let catalog = cached?.schema === 1 && Array.isArray(cached.lessons)
    && Date.parse(cached.fetchedAt) > Date.parse(bundled.fetchedAt) ? cached : bundled;
  let progress = read(progressFile, {});
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) progress = {};
  let updating = false;
  const write = (file, data) => { fs.mkdirSync(dataDirectory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); };
  const url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const trusted = event => isTrustedSettingsSender(event, hub.contents('learning'), url);
  const respond = fn => async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: 'Untrusted learning page' };
    try { return { ok: true, ...await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  };
  ipcMain.handle('learning:load', respond(() => ({ catalog, progress })));
  ipcMain.handle('learning:progress', respond((id, action, value) => {
    if (!catalog.lessons.some(r => r.id === id)) throw new Error('Unknown lesson');
    let next;
    if (action === 'saved' && typeof value === 'boolean') next = { ...progress[id], saved: value };
    else if (action === 'answer' && typeof value === 'boolean') next = recordAnswer(progress[id], value);
    else throw new Error('Invalid learning action');
    const updated = { ...progress, [id]: next };
    write(progressFile, updated); progress = updated;
    return { progress };
  }));
  ipcMain.handle('learning:sources', respond(async () => { await shell.openExternal('https://www.dota2.com/patches/'); return {}; }));
  ipcMain.handle('learning:update', respond(async () => {
    if (updating) throw new Error('An update is already running');
    updating = true;
    try {
      const fresh = await fetchCatalog({ onProgress: state => { const contents = hub.contents('learning'); if (contents) contents.send('learning:update-progress', state); } });
      fresh.lessons.push(...catalog.lessons.filter(r => r.kind === 'phrase'));
      write(catalogFile, fresh); catalog = fresh;
      return { catalog };
    } finally { updating = false; }
  }));
  hub.register('learning', { file: 'learning.html', preload: '../preload/learning.js', background: '#f6f7f2',
    onHide: contents => contents.send('learning:hidden') });
}

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';
import { recordAnswer } from '../learning/model.js';
import { fetchCatalog } from '../learning/update.js';
import { planStudy, studyOptions, studySummary, STUDY_DEFAULTS } from '../learning/study.js';

export function createLearningController({ electron, hub, rendererDirectory, dataDirectory }) {
  const { ipcMain, shell } = electron;
  const catalogFile = path.join(dataDirectory, 'learning-catalog.json');
  const progressFile = path.join(dataDirectory, 'learning-progress.json');
  const stateFile = path.join(dataDirectory, 'learning-state.json');
  const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const bundled = read(path.join(rendererDirectory, '../learning/catalog.json'), null);
  const audio = read(path.join(rendererDirectory, '../learning/audio-manifest.json'), { entries: {}, missing: [] });
  const cached = read(catalogFile, null);
  let catalog = cached?.schema === 1 && Array.isArray(cached.lessons)
    && Date.parse(cached.fetchedAt) > Date.parse(bundled.fetchedAt) ? cached : bundled;
  let legacyProgress = read(progressFile, {});
  if (!legacyProgress || typeof legacyProgress !== 'object' || Array.isArray(legacyProgress)) legacyProgress = {};
  const saved = read(stateFile, null);
  let state = saved?.schema === 1 ? saved : { schema: 1, progress: legacyProgress, preferences: STUDY_DEFAULTS, active: null, history: [] };
  let updating = false;
  const write = (file, data) => { fs.mkdirSync(dataDirectory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); };
  // Progress, session cursor and completion history commit together, including migration from the old progress file.
  const commit = next => { write(stateFile, next); state = next; };
  const snapshot = () => ({ progress: state.progress, study: { preferences: state.preferences, active: state.active, history: state.history } });
  const url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const trusted = event => isTrustedSettingsSender(event, hub.contents('learning'), url);
  const respond = fn => async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: 'Untrusted learning page' };
    try { return { ok: true, ...await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  };
  ipcMain.handle('learning:load', respond(() => ({ catalog, audio, ...snapshot() })));
  ipcMain.handle('learning:progress', respond((id, action, value) => {
    if (!catalog.lessons.some(r => r.id === id)) throw new Error('Unknown lesson');
    let next;
    if (action === 'saved' && typeof value === 'boolean') next = { ...state.progress[id], saved: value };
    else throw new Error('Invalid learning action');
    commit({ ...state, progress: { ...state.progress, [id]: next } });
    return snapshot();
  }));
  ipcMain.handle('learning:start-session', respond(options => {
    const preferences = studyOptions(options);
    if (state.active && !state.active.completedAt) return snapshot();
    const planned = planStudy(catalog.lessons, state.progress, preferences);
    if (!planned.items.length) return { ...snapshot(), empty: true };
    const active = { id: randomUUID(), startedAt: Date.now(), options: planned.options, items: planned.items, answers: [] };
    commit({ ...state, preferences, active });
    return snapshot();
  }));
  ipcMain.handle('learning:answer-session', respond((sessionId, lessonId, choice) => {
    const active = state.active;
    if (!active || active.id !== sessionId) throw new Error('This study session is no longer active');
    // Retried IPC messages must not count a successful disk write twice.
    if (active.answers.some(answer => answer.id === lessonId)) return snapshot();
    const item = active.items[active.answers.length];
    if (!item || item.lesson.id !== lessonId || !item.question.options.includes(choice)) throw new Error('Invalid session answer');
    const correct = item.question.answer === choice;
    const answers = [...active.answers, { id: lessonId, choice, correct }];
    const next = { ...active, answers, ...(answers.length === active.items.length ? { completedAt: Date.now() } : {}) };
    const history = next.completedAt ? [...state.history, studySummary(next)].slice(-180) : state.history;
    commit({ ...state, active: next, history,
      progress: { ...state.progress, [lessonId]: recordAnswer(state.progress[lessonId], correct) } });
    return snapshot();
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

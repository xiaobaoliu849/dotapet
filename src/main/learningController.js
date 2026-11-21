import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';
import { recordAnswer } from '../learning/model.js';
import { SPOKEN_PHRASES, learningCollection } from '../learning/spokenPhrases.js';
import { fetchCatalog } from '../learning/update.js';
import { applyReviewedLocalizations } from '../learning/reviewedLocalizations.js';
import { planStudy, planFocusedLesson, studyOptions, studySummary, STUDY_DEFAULTS } from '../learning/study.js';
import { diffCatalog } from '../learning/contentAudit.js';
import { buildPatchChangesManifest } from '../learning/patchChanges.js';
import { starterUnit, starterAvailability, isLearningStep } from '../learning/starterPath.js';

export function createLearningController({ electron, hub, rendererDirectory, dataDirectory, refreshCatalog = fetchCatalog, onPracticeVoice = null, onStopVoice = null }) {
  const { ipcMain, shell } = electron;
  const catalogFile = path.join(dataDirectory, 'learning-catalog.json');
  const patchChangesFile = path.join(dataDirectory, 'learning-patch-changes.json');
  const progressFile = path.join(dataDirectory, 'learning-progress.json');
  const stateFile = path.join(dataDirectory, 'learning-state.json');
  const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const bundled = read(path.join(rendererDirectory, '../learning/catalog.json'), null);
  const bundledImages = new Map(
    (bundled?.lessons || [])
      .filter(lesson => lesson?.id && lesson?.imageUrl)
      .map(lesson => [lesson.id, lesson.imageUrl]),
  );
  const withBundledImages = data => (!data?.lessons ? data : {
    ...data,
    lessons: data.lessons.map(lesson => (
      lesson?.imageUrl || !bundledImages.has(lesson?.id)
        ? lesson
        : { ...lesson, imageUrl: bundledImages.get(lesson.id) }
    )),
  });
  const heroConfig = read(path.join(rendererDirectory, '../../heroes.config.json'), { heroes: {} });
  const heroMeta = Object.fromEntries(
    Object.values(heroConfig.heroes || {})
      .filter(h => h?.nameEn)
      .map(h => [
        h.nameEn.toLowerCase(),
        {
          slug: h.id,
          attribute: (h.attribute === 'all' || h.attribute === 'uni') ? 'uni' : (h.attribute || 'str'),
          complexity: h.complexity || 1,
          attackType: h.attackType || '',
          themeColor: h.themeColor || '',
          photoUrl: h.photoUrl || '',
        },
      ]),
  );
  const rawAudio = read(path.join(rendererDirectory, '../learning/audio-manifest.json'), { entries: {}, missing: [] });
  const audioDir = path.join(rendererDirectory, 'assets/learning-audio');
  const audio = {
    ...rawAudio,
    entries: Object.fromEntries(
      Object.entries(rawAudio.entries || {}).filter(([, entry]) => entry?.file && (!entry.localOnly || fs.existsSync(path.join(audioDir, entry.file)))),
    ),
  };
  const itemImages = read(path.join(rendererDirectory, '../learning/item-images.json'), { entries: {}, missing: [] });
  const itemShopCategories = read(path.join(rendererDirectory, '../learning/item-shop-categories.json'), { entries: {} });
  const itemDetails = read(path.join(rendererDirectory, '../learning/item-details.json'), { entries: {} });
  const starterEvidence = read(path.join(rendererDirectory, '../learning/starter-shop-evidence.json'), { entries: {} });
  const bundledPatchChanges = read(path.join(rendererDirectory, '../learning/patch-changes.json'), { schema: 1, patch: null, removed: [], entries: {} });
  const baseline = read(path.join(rendererDirectory, '../learning/audio-baseline.json'), { entries: {} });
  const audioBaseline = { entries: Object.fromEntries(Object.entries(baseline.entries).map(([id, entry]) => [id, { candidateSpeech: entry.candidateSpeech, evidence: entry.evidence }])) };
  const cached = read(catalogFile, null);
  const usingCachedCatalog = cached?.schema === 1 && Array.isArray(cached.lessons)
    && Date.parse(cached.fetchedAt) > Date.parse(bundled.fetchedAt);
  let catalog = withBundledImages(usingCachedCatalog ? applyReviewedLocalizations(cached) : bundled);
  const cachedPatchChanges = usingCachedCatalog ? read(patchChangesFile, null) : null;
  let patchChanges = cachedPatchChanges?.schema === 1 && cachedPatchChanges.entries ? cachedPatchChanges : bundledPatchChanges;
  let legacyProgress = read(progressFile, {});
  if (!legacyProgress || typeof legacyProgress !== 'object' || Array.isArray(legacyProgress)) legacyProgress = {};
  const saved = read(stateFile, null);
  let state = saved?.schema === 1
    ? { paused: null, ...saved }
    : { schema: 1, progress: legacyProgress, preferences: STUDY_DEFAULTS, active: null, paused: null, history: [] };
  let updating = false;
  const write = (file, data) => { fs.mkdirSync(dataDirectory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); };
  // Progress, session cursor and completion history commit together, including migration from the old progress file.
  const commit = next => { write(stateFile, next); state = next; };
  const snapshot = () => ({ progress: state.progress, study: { preferences: state.preferences, active: state.active, paused: state.paused || null, history: state.history } });
  const lessonCatalog = () => ({ ...catalog, lessons: learningCollection(catalog.lessons) });
  const url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const trusted = event => isTrustedSettingsSender(event, hub.contents('learning'), url);
  const respond = fn => async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: 'Untrusted learning page' };
    try { return { ok: true, ...await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  };
  ipcMain.handle('learning:load', respond(() => ({ catalog: lessonCatalog(), heroMeta, itemImages, itemShopCategories, itemDetails, starterEvidence, patchChanges, audio, audioBaseline, ...snapshot() })));
  ipcMain.handle('learning:progress', respond((id, action, value) => {
    const known = catalog.lessons.some(r => r.id === id) || SPOKEN_PHRASES.some(p => p.id === id);
    if (!known) throw new Error('Unknown lesson');
    let next;
    if (action === 'saved' && typeof value === 'boolean') next = { ...state.progress[id], saved: value };
    else throw new Error('Invalid learning action');
    commit({ ...state, progress: { ...state.progress, [id]: next } });
    return snapshot();
  }));
  ipcMain.handle('learning:start-session', respond(options => {
    const preferences = studyOptions(options);
    if (state.active && !state.active.completedAt) return snapshot();
    const unit = starterUnit(preferences.scope);
    if (unit && !unit.lessonIds.every(id => catalog.lessons.some(lesson => lesson.id === id && starterAvailability(starterEvidence, id, lesson)))) {
      throw new Error('This starter lesson needs verified shop data before it can be started.');
    }
    const planned = planStudy(learningCollection(catalog.lessons), state.progress, preferences);
    if (!planned.items.length) return { ...snapshot(), empty: true };
    const active = { id: randomUUID(), startedAt: Date.now(), options: planned.options, items: planned.items, answers: [], ...(unit ? { guideIndex: 0 } : {}) };
    commit({ ...state, preferences, active, paused: null });
    return snapshot();
  }));
  ipcMain.handle('learning:practice-lesson', respond(options => {
    const request = options && typeof options === 'object' && !Array.isArray(options)
      ? { direction: state.preferences?.direction || 'en', ...options }
      : options;
    const planned = planFocusedLesson(learningCollection(catalog.lessons), state.progress, request);
    if (planned.unquizzable || !planned.items.length) {
      return { ...snapshot(), empty: true, unquizzable: Boolean(planned.unquizzable) };
    }
    const existing = state.active;
    const keepInPaused = Boolean(
      existing
      && !existing.completedAt
      && existing.options?.scope !== 'focus'
      && (existing.answers.length > 0 || existing.items.length > 1 || Number.isInteger(existing.guideIndex)),
    );
    const paused = keepInPaused ? existing : (state.paused || null);
    const active = { id: randomUUID(), startedAt: Date.now(), options: planned.options, items: planned.items, answers: [] };
    commit({ ...state, active, paused });
    return snapshot();
  }));
  ipcMain.handle('learning:abandon-session', respond((target = 'active') => {
    if (target !== 'active' && target !== 'paused') throw new Error('Invalid abandon target');
    if (target === 'paused') {
      if (!state.paused) return snapshot();
      commit({ ...state, paused: null });
      return snapshot();
    }
    if (!state.active || state.active.completedAt) return snapshot();
    commit({ ...state, active: null });
    return snapshot();
  }));
  ipcMain.handle('learning:resume-paused', respond(() => {
    if (!state.paused || state.paused.completedAt) return snapshot();
    commit({ ...state, active: state.paused, paused: null });
    return snapshot();
  }));
  ipcMain.handle('learning:advance-guide', respond((sessionId, lessonId) => {
    const active = state.active;
    if (!active || active.id !== sessionId || !Number.isInteger(active.guideIndex)) throw new Error('No matching guided lesson');
    const index = active.items.findIndex(item => item.lesson.id === lessonId);
    if (index >= 0 && index < active.guideIndex) return snapshot();
    if (!isLearningStep(active) || index !== active.guideIndex) throw new Error('Invalid learning step');
    commit({ ...state, active: { ...active, guideIndex: active.guideIndex + 1 } });
    return snapshot();
  }));
  ipcMain.handle('learning:answer-session', respond((sessionId, lessonId, choice) => {
    const active = state.active;
    if (!active || active.id !== sessionId) throw new Error('This study session is no longer active');
    if (isLearningStep(active)) throw new Error('Complete the learning cards before starting recall.');
    // Retried IPC messages must not count a successful disk write twice.
    if (active.answers.some(answer => answer.id === lessonId)) return snapshot();
    const item = active.items[active.answers.length];
    if (!item || item.lesson.id !== lessonId || !item.question.options.includes(choice)) throw new Error('Invalid session answer');
    const correct = item.question.answer === choice;
    const answers = [...active.answers, { id: lessonId, choice, correct }];
    const next = { ...active, answers, ...(answers.length === active.items.length ? { completedAt: Date.now() } : {}) };
    const history = next.completedAt ? [...state.history, studySummary(next)].slice(-180) : state.history;
    commit({ ...state, active: next, history,
      progress: { ...state.progress, [lessonId]: recordAnswer(state.progress[lessonId], correct, Date.now(), { earlyReview: Boolean(item.earlyReview) }) } });
    return snapshot();
  }));
  ipcMain.handle('learning:sources', respond(async () => { await shell.openExternal('https://www.dota2.com/patches/'); return {}; }));
  ipcMain.handle('learning:practice-voice', respond(async (persona) => {
    if (!persona || typeof persona !== 'object' || typeof persona.systemPrompt !== 'string') {
      throw new Error('Invalid voice practice context');
    }
    if (typeof onPracticeVoice !== 'function') {
      throw new Error('Voice practice is unavailable right now');
    }
    await onPracticeVoice(persona);
    return {};
  }));
  ipcMain.handle('learning:stop-voice', respond(async () => {
    if (typeof onStopVoice === 'function') await onStopVoice();
    return {};
  }));
  ipcMain.handle('learning:update', respond(async () => {
    if (updating) throw new Error('An update is already running');
    updating = true;
    try {
      const fresh = withBundledImages(await refreshCatalog({ onProgress: state => { const contents = hub.contents('learning'); if (contents) contents.send('learning:update-progress', state); } }));
      fresh.lessons.push(...catalog.lessons.filter(r => r.kind === 'phrase'));
      const changes = diffCatalog(catalog, fresh);
      write(path.join(dataDirectory, 'learning-catalog.previous.json'), catalog);
      write(path.join(dataDirectory, 'learning-catalog-changes.json'), changes);
      if (changes.changes.length) {
        const nextPatchChanges = buildPatchChangesManifest({
          diff: changes,
          beforeCatalog: catalog,
          afterCatalog: fresh,
          shopCategories: itemShopCategories,
          patch: fresh.patch,
          previousPatch: catalog.patch && catalog.patch !== fresh.patch ? catalog.patch : null,
          releasedAt: fresh.patchDate || null,
        });
        write(patchChangesFile, nextPatchChanges);
        patchChanges = nextPatchChanges;
      }
      write(catalogFile, fresh); catalog = fresh;
      return { catalog: lessonCatalog(), changes, patchChanges };
    } finally { updating = false; }
  }));
  hub.register('learning', { file: 'learning.html', preload: '../preload/learning.js', background: '#f6f7f2',
    onHide: contents => contents.send('learning:hidden') });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLearningController } from '../src/main/learningController.js';

function fixture(t, extra = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-study-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map(), frame = {}, contents = { mainFrame: frame, isDestroyed: () => false };
  const rendererDirectory = path.resolve('src/renderer'); frame.url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const options = { electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} }, hub: { contents: () => contents, register() {} }, rendererDirectory, dataDirectory, ...extra };
  const event = { sender: contents, senderFrame: frame };
  const reload = () => createLearningController(options); reload();
  const call = (name, ...args) => handlers.get('learning:' + name)(event, ...args);
  return { dataDirectory, reload, call, handlers, event };
}

test('guided starter lessons persist learning checkpoints before recall and count retries once', async t => {
  const f = fixture(t);
  const started = await f.call('start-session', { scope: 'starter-lane', direction: 'zh' });
  assert.equal(started.ok, true);
  const active = started.study.active;
  assert.equal(active.guideIndex, 0); assert.equal(active.items.length, 5);
  const [first, second] = active.items;
  assert.equal((await f.call('answer-session', active.id, first.lesson.id, first.question.answer)).ok, false);
  assert.equal((await f.call('advance-guide', active.id, second.lesson.id)).ok, false);
  assert.equal((await f.call('advance-guide', 'foreign-session', first.lesson.id)).ok, false);
  assert.equal((await f.call('advance-guide', active.id, first.lesson.id)).study.active.guideIndex, 1);
  assert.equal((await f.call('advance-guide', active.id, first.lesson.id)).study.active.guideIndex, 1);
  f.reload();
  const loaded = await f.call('load');
  assert.equal(loaded.study.active.guideIndex, 1);
  assert.equal(loaded.progress[first.lesson.id], undefined, 'reading does not count as a correct answer');
  assert.equal((await f.call('start-session', { scope: 'starter-team' })).study.active.id, active.id);
  for (const item of active.items.slice(1)) assert.equal((await f.call('advance-guide', active.id, item.lesson.id)).ok, true);
  f.reload();
  assert.equal((await f.call('load')).study.active.guideIndex, 5);
  for (const item of active.items) assert.equal((await f.call('answer-session', active.id, item.lesson.id, item.question.answer)).ok, true);
  const finished = await f.call('load');
  assert.ok(finished.study.active.completedAt);
  assert.equal(finished.study.history[0].correct, 5);
  assert.equal(finished.study.history[0].scope, 'starter-lane');
  assert.equal((await f.call('start-session', { scope: 'starter-lane' })).empty, true, 'future reviews remain scheduled');
});

test('failed guided checkpoint writes keep the learning cursor and reject foreign callers', async t => {
  const f = fixture(t), started = await f.call('start-session', { scope: 'starter-team' });
  const active = started.study.active, id = active.items[0].lesson.id;
  assert.equal((await f.handlers.get('learning:advance-guide')({ sender: {}, senderFrame: f.event.senderFrame }, active.id, id)).ok, false);
  fs.mkdirSync(path.join(f.dataDirectory, 'learning-state.json.tmp'));
  assert.equal((await f.call('advance-guide', active.id, id)).ok, false);
  assert.equal((await f.call('load')).study.active.guideIndex, 0);
});

test('saved spoken callouts can be practiced, answered and resumed through the same session IPC', async t => {
  const f = fixture(t), id = 'spoken:smoke-triangle';
  assert.equal((await f.call('progress', id, 'saved', true)).ok, true);
  const loaded = await f.call('load');
  assert.ok(loaded.catalog.lessons.some(row => row.id === id));
  const started = await f.call('start-session', { size: 5, kind: 'phrase', scope: 'saved', direction: 'zh' });
  assert.deepEqual(started.study.active.items.map(item => item.lesson.id), [id]);
  const active = started.study.active, item = active.items[0];
  assert.equal((await f.call('answer-session', active.id, id, item.question.answer)).ok, true);
  f.reload();
  const saved = await f.call('load');
  assert.equal(saved.progress[id].correct, 1);
  assert.equal(saved.progress[id].saved, true);
});

test('older cached catalogs retain bundled image metadata and the shared spoken collection', async t => {
  const f = fixture(t), before = await f.call('load');
  const item = before.catalog.lessons.find(row => row.id === 'item:1');
  const { imageUrl, internalName, ...legacyItem } = item;
  fs.writeFileSync(path.join(f.dataDirectory, 'learning-catalog.json'), JSON.stringify({
    schema: 1, fetchedAt: '2099-01-01T00:00:00.000Z', lessons: [legacyItem],
  }));
  f.reload();
  const loaded = await f.call('load');
  assert.equal(loaded.catalog.lessons.find(row => row.id === item.id).imageUrl, imageUrl);
  assert.equal(loaded.itemImages.entries[item.id].file, '1.png');
  assert.ok(loaded.catalog.lessons.some(row => row.id === 'spoken:smoke-triangle'));
});

test('sessions persist answers, resume after reload, reject out-of-order answers and count retries once', async t => {
  const f = fixture(t);
  let response = await f.call('start-session', { size: 5, kind: 'hero' });
  const active = response.study.active;
  assert.equal(active.items.length, 5);
  const [first, second] = active.items;
  assert.equal((await f.call('answer-session', active.id, second.lesson.id, second.question.answer)).ok, false);
  assert.equal((await f.call('answer-session', 'invalid', first.lesson.id, first.question.answer)).ok, false);
  assert.equal((await f.call('answer-session', active.id, first.lesson.id, 'not-an-option')).ok, false);
  response = await f.call('answer-session', active.id, first.lesson.id, first.question.answer);
  assert.equal(response.progress[first.lesson.id].attempts, 1);
  response = await f.call('answer-session', active.id, first.lesson.id, first.question.answer);
  assert.equal(response.progress[first.lesson.id].attempts, 1);
  f.reload();
  response = await f.call('load');
  assert.equal(response.study.active.id, active.id); assert.equal(response.study.active.answers.length, 1);
  assert.equal((await f.call('start-session', { size: 10 })).study.active.id, active.id, 'unfinished session is resumed');
  for (const item of active.items.slice(1)) {
    const choice = item === second ? item.question.options.find(option => option !== item.question.answer) : item.question.answer;
    response = await f.call('answer-session', active.id, item.lesson.id, choice);
  }
  assert.ok(response.study.active.completedAt);
  assert.equal(response.study.history.length, 1); assert.equal(response.study.history[0].correct, 4);
  assert.deepEqual(response.study.history[0].mistakes, [second.lesson.id]);
  response = await f.call('answer-session', active.id, first.lesson.id, first.question.answer);
  assert.equal(response.study.history.length, 1);
  f.reload(); response = await f.call('load'); assert.equal(response.study.history.length, 1);
  const next = await f.call('start-session', { size: 10 });
  assert.notEqual(next.study.active.id, active.id); assert.equal(next.study.active.items.length, 10);
  assert.ok(next.study.active.items.every(item => !active.items.some(old => old.lesson.id === item.lesson.id)), 'future reviews remain excluded');
});

test('refresh preserves the old snapshot, records changes and keeps sessions; failed refresh keeps the catalog', async t => {
  let fail = false;
  const f = fixture(t, { refreshCatalog: async () => {
    if (fail) throw new Error('offline');
    const bundled = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
    bundled.lessons = bundled.lessons.filter(row => row.kind !== 'phrase');
    bundled.lessons[0].descriptionEn += ' Updated test description.';
    bundled.fetchedAt = '2099-01-01T00:00:00.000Z'; return bundled;
  } });
  const before = await f.call('load'), started = await f.call('start-session', {});
  const update = await f.call('update'); assert.equal(update.ok, true);
  assert.equal(update.changes.changes.length, 1);
  const previous = JSON.parse(fs.readFileSync(path.join(f.dataDirectory, 'learning-catalog.previous.json')));
  assert.equal(previous.fetchedAt, before.catalog.fetchedAt);
  const after = await f.call('load'); assert.equal(after.study.active.id, started.study.active.id);
  assert.equal(after.catalog.lessons.length, before.catalog.lessons.length);
  fail = true; assert.equal((await f.call('update')).ok, false);
  assert.equal((await f.call('load')).catalog.fetchedAt, update.catalog.fetchedAt);
});

test('saved-only practice migrates old bookmarks and preserves a short completed session', async t => {
  const f = fixture(t), id = 'hero:1';
  const legacy = { [id]: { saved: true, attempts: 2, correct: 1, box: 0, due: 1 } };
  fs.writeFileSync(path.join(f.dataDirectory, 'learning-progress.json'), JSON.stringify(legacy)); f.reload();
  let response = await f.call('start-session', { size: 10, scope: 'saved', direction: 'zh' });
  assert.equal(response.study.active.items.length, 1); assert.equal(response.study.active.items[0].lesson.id, id);
  assert.equal(response.study.active.items[0].question.prompt, response.study.active.items[0].lesson.zh);
  const active = response.study.active, item = active.items[0];
  response = await f.call('answer-session', active.id, id, item.question.answer);
  assert.equal(response.progress[id].attempts, 3); assert.equal(response.progress[id].saved, true);
  f.reload(); response = await f.call('load');
  assert.equal(response.progress[id].attempts, 3); assert.equal(response.study.preferences.scope, 'saved');
  assert.ok(response.study.active.completedAt); assert.equal(response.study.history.length, 1);
  response = await f.call('start-session', { scope: 'saved' });
  assert.equal(response.empty, true); assert.ok(response.study.active.completedAt);
});

test('foreign IPC and invalid options cannot create sessions; failed disk writes change neither cursor nor progress', async t => {
  const f = fixture(t);
  assert.equal((await f.handlers.get('learning:start-session')({ sender: {}, senderFrame: f.event.senderFrame }, {})).ok, false);
  assert.equal((await f.call('start-session', { size: 200 })).ok, false);
  const response = await f.call('start-session', {}), active = response.study.active, item = active.items[0];
  fs.mkdirSync(path.join(f.dataDirectory, 'learning-state.json.tmp'));
  assert.equal((await f.call('answer-session', active.id, item.lesson.id, item.question.answer)).ok, false);
  const loaded = await f.call('load');
  assert.equal(loaded.study.active.answers.length, 0); assert.equal(loaded.progress[item.lesson.id], undefined);
});

test('focused item practice targets exact ID, supports immediate re-practice, pauses/resumes active sessions, and preserves preferences', async t => {
  const f = fixture(t);
  // Start a normal 5-hero session and answer 1 question.
  const daily = await f.call('start-session', { size: 5, kind: 'hero', direction: 'en' });
  const dailyActive = daily.study.active;
  assert.equal((await f.call('answer-session', dailyActive.id, dailyActive.items[0].lesson.id, dailyActive.items[0].question.answer)).ok, true);

  // Launch focused practice on Sabatons of Mordiggian (item:1953): pauses the daily session without overwriting preferences.
  const focus1 = await f.call('practice-lesson', { lessonId: 'item:1953', direction: 'en' });
  assert.equal(focus1.ok, true);
  assert.equal(focus1.study.active.options.scope, 'focus');
  assert.equal(focus1.study.active.options.focusId, 'item:1953');
  assert.deepEqual(focus1.study.active.items.map(i => i.lesson.id), ['item:1953']);
  assert.equal(focus1.study.paused.id, dailyActive.id);
  assert.equal(focus1.study.paused.answers.length, 1);
  assert.equal(focus1.study.preferences.kind, 'hero');
  assert.equal(focus1.study.preferences.search, '');

  // Switching to another focused item (Horn of Battle) before answering replaces the focus drill while keeping the paused daily session.
  const focus2 = await f.call('practice-lesson', { lessonId: 'item:1950', direction: 'en' });
  assert.equal(focus2.ok, true);
  assert.deepEqual(focus2.study.active.items.map(i => i.lesson.id), ['item:1950']);
  assert.equal(focus2.study.paused.id, dailyActive.id);

  // Answer Horn of Battle correctly (first time -> box 1), then immediately drill it again in reverse direction (earlyReview -> box stays 1).
  const hornItem = focus2.study.active.items[0];
  const ans1 = await f.call('answer-session', focus2.study.active.id, 'item:1950', hornItem.question.answer);
  assert.equal(ans1.ok, true);
  assert.ok(ans1.study.active.completedAt);
  assert.equal(ans1.progress['item:1950'].box, 1);

  const focus3 = await f.call('practice-lesson', { lessonId: 'item:1950', direction: 'zh' });
  assert.equal(focus3.ok, true);
  assert.equal(focus3.study.active.items[0].lesson.id, 'item:1950');
  assert.equal(focus3.study.active.items[0].earlyReview, true);
  const ans2 = await f.call('answer-session', focus3.study.active.id, 'item:1950', focus3.study.active.items[0].question.answer);
  assert.equal(ans2.progress['item:1950'].box, 1, 'early voluntary drill preserves SRS tier');
  assert.equal(ans2.progress['item:1950'].attempts, 2);

  // Resume the paused multi-lesson daily session and verify state survives controller reload.
  const resumed = await f.call('resume-paused');
  assert.equal(resumed.ok, true);
  assert.equal(resumed.study.active.id, dailyActive.id);
  assert.equal(resumed.study.active.answers.length, 1);
  assert.equal(resumed.study.paused, null);

  // Abandoning an unfinished session clears active while preserving saved progress.
  const abandoned = await f.call('abandon-session', 'active');
  assert.equal(abandoned.ok, true);
  assert.equal(abandoned.study.active, null);
  f.reload();
  const afterReload = await f.call('load');
  assert.equal(afterReload.study.active, null);
  assert.equal(afterReload.progress['item:1950'].attempts, 2);
  assert.equal(afterReload.progress[dailyActive.items[0].lesson.id].attempts, 1);

  // Foreign IPC callers are rejected on all new endpoints.
  const foreign = { sender: {}, senderFrame: f.event.senderFrame };
  assert.equal((await f.handlers.get('learning:practice-lesson')(foreign, { lessonId: 'item:1953' })).ok, false);
  assert.equal((await f.handlers.get('learning:abandon-session')(foreign, 'active')).ok, false);
  assert.equal((await f.handlers.get('learning:resume-paused')(foreign)).ok, false);
});

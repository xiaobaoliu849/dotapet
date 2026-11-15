import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLearningController } from '../src/main/learningController.js';

function fixture(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-study-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map(), frame = {}, contents = { mainFrame: frame, isDestroyed: () => false };
  const rendererDirectory = path.resolve('src/renderer'); frame.url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const options = { electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} }, hub: { contents: () => contents, register() {} }, rendererDirectory, dataDirectory };
  const event = { sender: contents, senderFrame: frame };
  const reload = () => createLearningController(options); reload();
  const call = (name, ...args) => handlers.get('learning:' + name)(event, ...args);
  return { dataDirectory, reload, call, handlers, event };
}

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

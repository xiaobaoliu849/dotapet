import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { filterLessons, recordAnswer, makeQuestion, pairRecords, describe } from '../src/learning/model.js';
import { createLearningController } from '../src/main/learningController.js';
import { fetchCatalog } from '../src/learning/update.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
test('catalog has unique stable IDs, bilingual lessons and all four subjects', () => {
  assert.ok(catalog.lessons.length > 900);
  assert.equal(new Set(catalog.lessons.map(r => r.id)).size, catalog.lessons.length);
  assert.deepEqual([...new Set(catalog.lessons.map(r => r.kind))].sort(), ['ability', 'hero', 'item', 'phrase']);
  for (const r of catalog.lessons) { assert.ok(r.en && r.zh, r.id); assert.doesNotMatch(r.descriptionEn, /<[^>]+>/); }
});
test('search matches hero context and Chinese; saved filter intersects topic', () => {
  const lesson = catalog.lessons.find(r => r.kind === 'ability');
  assert.ok(filterLessons(catalog.lessons, { search: lesson.parent }).includes(lesson));
  assert.ok(filterLessons(catalog.lessons, { search: lesson.zh }).includes(lesson));
  assert.deepEqual(filterLessons(catalog.lessons, { kind: 'ability', saved: true, progress: { [lesson.id]: { saved: true } } }), [lesson]);
});
test('review intervals grow on success, reset on failure and preserve bookmarks', () => {
  let p = { saved: true };
  for (const days of [1, 3, 7, 14, 30, 30]) { p = recordAnswer(p, true, 100); assert.equal(p.due, 100 + days * 86400000); }
  p = recordAnswer(p, false, 100); assert.equal(p.due, 60100); assert.equal(p.box, 0); assert.equal(p.saved, true); assert.equal(p.attempts, 7); assert.equal(p.correct, 6);
});
test('quiz options are distinct, include the answer once, support reverse direction', () => {
  for (const direction of ['en', 'zh']) for (const kind of ['hero', 'ability', 'item', 'phrase']) {
    const lesson = catalog.lessons.find(r => r.kind === kind), q = makeQuestion(lesson, catalog.lessons, direction);
    assert.equal(q.prompt, lesson[direction]); assert.equal(q.options.length, 4); assert.equal(new Set(q.options).size, 4); assert.ok(q.options.includes(q.answer));
  }
});
test('official data joins by numeric ID and resolves values without executing HTML', () => {
  const a = [{ id: 1, name_loc: 'Blink', desc_loc: '<h1>Active</h1> Range %range%', special_values: [{ name: 'range', values_float: [1200] }] }];
  assert.equal(describe(a[0]), 'Active\n Range 1200');
  assert.equal(pairRecords(a, [{ id: 1, name_loc: '闪烁' }], 'ability')[0].zh, '闪烁');
  assert.throws(() => pairRecords(a, [], 'ability'), /Missing bilingual/);
});
test('learning IPC rejects foreign frames and persists progress across controller reloads', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-learning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), frame = {}, contents = { mainFrame: frame, isDestroyed: () => false };
  const rendererDirectory = path.resolve('src/renderer'); frame.url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const options = { electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} }, hub: { contents: () => contents, register() {} }, rendererDirectory, dataDirectory: directory };
  createLearningController(options);
  const trusted = { sender: contents, senderFrame: frame }, id = catalog.lessons[0].id;
  assert.equal((await handlers.get('learning:load')({ sender: {}, senderFrame: frame })).ok, false);
  assert.equal((await handlers.get('learning:load')({ sender: contents, senderFrame: { url: frame.url } })).ok, false);
  assert.equal((await handlers.get('learning:progress')(trusted, 'bogus', 'saved', true)).ok, false);
  assert.equal((await handlers.get('learning:progress')(trusted, id, 'saved', true)).ok, true);
  assert.equal((await handlers.get('learning:progress')(trusted, id, 'answer', false)).ok, false, 'session answers use validated session IPC');
  createLearningController(options);
  const loaded = await handlers.get('learning:load')(trusted);
  assert.equal(loaded.progress[id].saved, true);
  assert.ok(loaded.heroMeta && typeof loaded.heroMeta === 'object');
  const attrs = new Set(Object.values(loaded.heroMeta).map(h => h.attribute));
  assert.deepEqual([...attrs].sort(), ['agi', 'int', 'str', 'uni']);
});

test('updater joins live-shaped feeds and records unnamed internal item omissions', async () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'entry_' + i }));
  const fetcher = async url => {
    const endpoint = url.pathname.split('/').pop(), zh = url.searchParams.get('language') === 'schinese';
    let data;
    if (endpoint === 'herolist') data = { heroes: list };
    else if (endpoint === 'itemlist') data = { itemabilities: list };
    else {
      const hero = endpoint === 'herodata', id = Number(url.searchParams.get(hero ? 'hero_id' : 'item_id'));
      data = { [hero ? 'heroes' : 'items']: [{ id, name_loc: !hero && id === 100 ? '' : (zh ? '中文' : 'English') + id,
        desc_loc: 'Range %range%', special_values: [{ name: 'range', values_float: [500] }], abilities: [] }] };
    }
    return { ok: true, json: async () => ({ result: { data } }) };
  };
  const result = await fetchCatalog({ fetcher });
  assert.equal(result.lessons.length, 199); assert.equal(result.omitted.length, 1); assert.equal(result.patch, null);
  assert.equal(result.lessons.find(r => r.kind === 'item').descriptionEn, 'Range 500');
});

test('failed updater retries and returns no partial catalog', async () => {
  let calls = 0;
  await assert.rejects(fetchCatalog({ fetcher: async () => { calls++; return { ok: false, status: 503 }; } }), /Valve HTTP 503/);
  assert.equal(calls, 3);
});

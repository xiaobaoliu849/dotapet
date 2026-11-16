import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { filterLessons, recordAnswer, makeQuestion, pairRecords, describe, itemImageUrl } from '../src/learning/model.js';
import { summarizeMastery } from '../src/learning/mastery.js';
import { buildHeroPracticePersona, buildPhrasePracticePersona } from '../src/learning/voicePractice.js';
import { createLearningController } from '../src/main/learningController.js';
import { fetchCatalog } from '../src/learning/update.js';
import { createHash } from 'node:crypto';
import { itemImageSources } from '../src/learning/itemImages.js';
import { itemCoaching } from '../src/learning/itemCoaching.js';
import { reviewCounts } from '../src/learning/study.js';
import { learningCollection } from '../src/learning/spokenPhrases.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
test('every catalog item has a bundled PNG with a verified signature and content hash', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../src/learning/item-images.json', import.meta.url)));
  assert.deepEqual(manifest.missing, []);
  for (const item of catalog.lessons.filter(row => row.kind === 'item')) {
    const entry = manifest.entries[item.id];
    assert.ok(entry, item.id);
    assert.match(entry.file, /^\d+\.png$/);
    const png = fs.readFileSync(new URL('../src/renderer/assets/learning-items/' + entry.file, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', item.id);
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
    assert.equal(createHash('sha256').update(png).digest('hex'), entry.sha256, item.id);
    assert.equal(itemImageSources(item, manifest)[0], 'assets/learning-items/' + entry.file);
  }
});

test('item images preserve identity across refresh, reject unsafe paths and support new official slugs', () => {
  const item = { id: 'item:1', kind: 'item', en: 'Blink Dagger' };
  const manifest = { entries: { 'item:1': { file: '1.png', name: 'Blink Dagger', slug: 'blink' } } };
  assert.deepEqual(itemImageSources(item, manifest), ['assets/learning-items/1.png']);
  assert.deepEqual(itemImageSources({ ...item, en: 'Renamed item' }, manifest), []);
  assert.deepEqual(itemImageSources({ ...item, internalName: 'item_different' }, manifest), ['https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/different.png', 'https://cdn.steamstatic.com/apps/dota2/images/dota_react/items/different.png']);
  assert.deepEqual(itemImageSources({ ...item, internalName: 'item_../../escape' }, { entries: {} }), []);
  manifest.entries['item:1'].file = '../escape.png';
  assert.deepEqual(itemImageSources(item, manifest), []);
  const pair = pairRecords([{ id: 1, name: 'item_blink', name_loc: 'Blink Dagger' }], [{ id: 1, name_loc: '闪烁匕首' }], 'item')[0];
  assert.equal(pair.internalName, 'item_blink');
  assert.equal(itemImageUrl({ name: 'item_../../escape' }), '');
  assert.equal(itemImageUrl({ name: 123 }), '');
  const urls = ['https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/blink.png', 'https://cdn.steamstatic.com/apps/dota2/images/dota_react/items/blink.png'];
  manifest.entries['item:1'].file = '1.png';
  for (const imageUrl of urls) assert.deepEqual(itemImageSources({ ...item, imageUrl }, manifest), ['assets/learning-items/1.png', ...urls]);
  assert.deepEqual(itemImageSources({ ...item, en: 'Unknown', imageUrl: 'https://untrusted.example/blink.png' }, manifest), []);
});

test('item aliases work in both library search and session search; coaching avoids invented balance values', () => {
  for (const [search, name] of [['bkb', 'Black King Bar'], ['tp', 'Town Portal Scroll'], ['跳刀', 'Blink Dagger'], ['羊刀', 'Scythe of Vyse']]) {
    assert.ok(filterLessons(catalog.lessons, { kind: 'item', search }).some(row => row.en === name), search);
  }
  const bkb = catalog.lessons.find(row => row.en === 'Black King Bar');
  assert.match(itemCoaching(bkb).en, /cooldown/);
  const neutral = { kind: 'item', en: 'Test Artifact', zh: '测试宝物', descriptionEn: 'Deals damage and applies a dispel.' };
  assert.equal(itemCoaching(neutral).en, 'I have Test Artifact.');
  assert.deepEqual(itemCoaching(neutral).vocabulary.map(row => row.en), ['dispel', 'damage']);
});

test('review counts separate unseen and saved-only words from previously studied words', () => {
  const lessons = ['unseen', 'saved', 'due', 'future'].map(id => ({ id }));
  assert.deepEqual(reviewCounts(lessons, { saved: { saved: true }, due: { attempts: 1, due: 50 }, future: { attempts: 1, due: 200 } }, 100), { reviews: 1, unseen: 2 });
});

test('spoken phrases share the wordbook and mastery counts without duplicate entries', () => {
  const collection = learningCollection(catalog.lessons);
  const phrase = collection.find(row => row.id === 'spoken:smoke-triangle');
  assert.equal(phrase.kind, 'phrase');
  assert.ok(filterLessons(collection, { saved: true, progress: { [phrase.id]: { saved: true } } }).includes(phrase));
  assert.equal(learningCollection(collection).length, collection.length);
  assert.equal(summarizeMastery(collection, {}).find(row => row.key === 'phrase').total, collection.filter(row => row.kind === 'phrase').length);
});
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
  assert.equal((await handlers.get('learning:progress')(trusted, 'spoken:smoke-triangle', 'saved', true)).ok, true);
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

test('summarizeMastery computes practiced, mastered, and saved counts per category', () => {
  const sampleProgress = {
    'hero:1': { saved: true, attempts: 2, correct: 2, box: 2 },
    'ability:5003': { saved: false, attempts: 1, correct: 1, box: 1 },
    'spoken:smoke-triangle': { saved: true, attempts: 3, correct: 3, box: 3 },
  };
  const summary = summarizeMastery(catalog.lessons, sampleProgress);
  assert.equal(summary.length, 4);
  const hero = summary.find(s => s.key === 'hero');
  const ability = summary.find(s => s.key === 'ability');
  const phrase = summary.find(s => s.key === 'phrase');
  assert.equal(hero.practiced, 1);
  assert.equal(hero.mastered, 1);
  assert.equal(hero.saved, 1);
  assert.equal(ability.practiced, 1);
  assert.equal(ability.mastered, 0);
  assert.equal(phrase.practiced, 1);
  assert.equal(phrase.mastered, 1);
  assert.equal(phrase.saved, 1);
});

test('voicePractice builds hero-ability and spoken-phrase personas and dispatches via IPC', async t => {
  const hero = catalog.lessons.find(r => r.kind === 'hero');
  const abilities = catalog.lessons.filter(r => r.kind === 'ability' && r.parent === `${hero.en} · ${hero.zh}`);
  const heroPersona = buildHeroPracticePersona({ hero, abilities });
  assert.ok(heroPersona.systemPrompt.includes(hero.en));
  assert.ok(heroPersona.systemPrompt.includes(abilities[0].en));

  const phrasePersona = buildPhrasePracticePersona({ phrase: { id: 'spoken:test', zh: '开雾打肉山', en: 'Smoke and rosh now.' } });
  assert.ok(phrasePersona.systemPrompt.includes('Smoke and rosh now.'));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-voice-practice-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), frame = {}, contents = { mainFrame: frame, isDestroyed: () => false };
  const rendererDirectory = path.resolve('src/renderer'); frame.url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  let received = null;
  createLearningController({
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} },
    hub: { contents: () => contents, register() {} },
    rendererDirectory,
    dataDirectory: directory,
    onPracticeVoice: persona => { received = persona; },
  });
  const trusted = { sender: contents, senderFrame: frame };
  const res = await handlers.get('learning:practice-voice')(trusted, heroPersona);
  assert.equal(res.ok, true);
  assert.equal(received.id, heroPersona.id);
});

test('makeQuestion skips lessons whose English and Chinese names are identical', () => {
  const identical = { id: 'item:test', kind: 'item', en: 'Black Grimoire\n(Warlock)', zh: 'Black Grimoire\n(Warlock)' };
  assert.equal(makeQuestion(identical, catalog.lessons, 'en'), null);
  assert.equal(makeQuestion(identical, catalog.lessons, 'zh'), null);
});

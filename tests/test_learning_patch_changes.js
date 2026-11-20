import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  normalizeMechanicsChanges,
  buildPatchChangesManifest,
  getLessonPatchChange,
  getHeroPatchSummary,
  summarizePatchChanges,
  formatPatchStatLabel,
} from '../src/learning/patchChanges.js';
import { fetchCatalog, fetchLatestPatch } from '../src/learning/update.js';
import { createLearningController } from '../src/main/learningController.js';
import { searchShopItems } from '../src/learning/itemShop.js';
import { createHash } from 'node:crypto';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url), 'utf8'));
const shopCategories = JSON.parse(fs.readFileSync(new URL('../src/learning/item-shop-categories.json', import.meta.url), 'utf8'));
const patchChanges = JSON.parse(fs.readFileSync(new URL('../src/learning/patch-changes.json', import.meta.url), 'utf8'));
const audioManifest = JSON.parse(fs.readFileSync(new URL('../src/learning/audio-manifest.json', import.meta.url), 'utf8'));

test('bundled catalog records verified Patch 7.42 metadata and release timestamp', () => {
  assert.equal(catalog.patch, '7.42');
  assert.ok(catalog.patchDate && !Number.isNaN(Date.parse(catalog.patchDate)));
});

test('bundled patch-changes manifest covers Patch 7.42 additions, changes, and removed hero abilities without duplicates', () => {
  assert.equal(patchChanges.schema, 1);
  assert.equal(patchChanges.patch, '7.42');
  assert.equal(patchChanges.previousPatch, '7.41f');
  assert.equal(patchChanges.counts.addedShopItems, 6);
  assert.equal(patchChanges.counts.addedNeutralItems, 5);
  assert.equal(patchChanges.counts.addedAbilities, 9);
  assert.equal(patchChanges.counts.removedAbilities, 7);
  assert.equal(patchChanges.counts.affectedHeroes, 118);

  const summary = summarizePatchChanges(patchChanges, catalog.lessons, shopCategories);
  assert.deepEqual(
    summary.newShopItems.map(i => i.en).sort(),
    ['Bloodslinger', 'Caduceus', "Ristul's Devotion", 'Sabatons of Mordiggian', 'Skypiercer', 'Starforge'],
  );
  assert.equal(summary.newNeutralItems.length, 5);
  assert.equal(summary.removedAbilities.length, 7);
  for (const rem of summary.removedAbilities) {
    assert.ok(rem.heroId && rem.parent, `Removed ability missing parent hero: ${rem.id}`);
  }

  // Ensure zero duplicate (key, scope) stat rows in any entry
  for (const [id, entry] of Object.entries(patchChanges.entries)) {
    if (entry.type !== 'changed') continue;
    const seen = new Set();
    for (const st of entry.stats || []) {
      const k = `${st.key}::${st.scope || 'base'}`;
      assert.ok(!seen.has(k), `Duplicate stat diff ${k} in ${id}`);
      seen.add(k);
      assert.notEqual(st.before, st.after, `No-op stat diff ${k} in ${id}`);
      assert.ok(st.en && !st.en.includes('$') && !/%\w+%/.test(st.en), `Malformed label ${st.en} in ${id}`);
    }
  }
});

test('normalizeMechanicsChanges deduplicates parallel Valve keys and formats Shard/Scepter sub-diffs cleanly', () => {
  const rows = normalizeMechanicsChanges([
    { field: 'cooldowns', before: [120, 110, 100], after: [125, 110, 95] },
    { field: 'AbilityCooldown', before: { values: [120, 110, 100], shard: [], scepter: [40] }, after: { values: [125, 110, 95], shard: [], scepter: [35] } },
    { field: 'scepter_cleave_pct', before: { values: [0], shard: [], scepter: [40] }, after: { values: [0], shard: [], scepter: [50] } },
    { field: 'AbilityCastRange', before: { values: [1300], shard: [], scepter: [] }, after: { values: [1300], shard: [100], scepter: [] } },
    { field: 'item_cost', before: 875, after: 900 },
  ]);

  assert.equal(rows.filter(r => r.key === 'cooldown' && !r.scope).length, 1, 'cooldowns and AbilityCooldown must deduplicate');
  assert.deepEqual(rows.find(r => r.key === 'item_cost'), { key: 'item_cost', en: 'Cost', zh: '价格', scope: null, before: '875g', after: '900g' });
  assert.deepEqual(rows.find(r => r.key === 'cooldown' && !r.scope), { key: 'cooldown', en: 'Cooldown', zh: '冷却时间', scope: null, before: '120 / 110 / 100s', after: '125 / 110 / 95s' });
  assert.deepEqual(rows.find(r => r.key === 'cooldown' && r.scope === 'scepter'), { key: 'cooldown', en: 'Cooldown', zh: '冷却时间', scope: 'scepter', before: '40s', after: '35s' });
  assert.deepEqual(rows.find(r => r.key === 'cast_range' && r.scope === 'shard'), { key: 'cast_range', en: 'Cast Range', zh: '施法距离', scope: 'shard', before: '—', after: '100' });
  const cleave = rows.find(r => r.key === 'cleave_pct' && r.scope === 'scepter');
  assert.equal(formatPatchStatLabel(cleave, false), 'Cleave (Scepter)');
  assert.equal(formatPatchStatLabel(cleave, true), '分裂伤害（神杖）');
});

test('getHeroPatchSummary aggregates added, changed, and removed abilities per hero', () => {
  const meepo = catalog.lessons.find(l => l.kind === 'hero' && l.en === 'Meepo');
  const meepoAbs = catalog.lessons.filter(l => l.kind === 'ability' && l.parent === `${meepo.en} · ${meepo.zh}`);
  const summary = getHeroPatchSummary(patchChanges, meepo, meepoAbs);
  assert.equal(summary.status, 'added');
  assert.equal(summary.addedCount, 1);
  assert.equal(summary.removedAbilities.length, 2);
  assert.ok(summary.changedCount >= 1);

  const ob = getLessonPatchChange(patchChanges, 'item:600');
  assert.equal(ob.type, 'changed');
  assert.ok(ob.stats.some(s => s.key === 'duration' && s.before === '6s' && s.after === '4.5s'));
});

test('fetchLatestPatch and fetchCatalog parse official patchnoteslist when available and fall back to null safely', async () => {
  const withPatch = await fetchLatestPatch(async () => ({
    ok: true,
    json: async () => ({
      patches: [
        { patch_number: '7.41f', patch_timestamp: 1789497865 },
        { patch_number: '7.42', patch_timestamp: 1794988800 },
      ],
    }),
  }));
  assert.equal(withPatch.patch, '7.42');
  assert.equal(withPatch.previousPatch, '7.41f');
  assert.equal(withPatch.patchDate, new Date(1794988800 * 1000).toISOString());

  const list = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'entry_' + i }));
  const fetcher = async url => {
    const endpoint = url.pathname.split('/').pop(), zh = url.searchParams.get('language') === 'schinese';
    if (endpoint === 'patchnoteslist') {
      return { ok: true, json: async () => ({ patches: [{ patch_number: '7.42', patch_timestamp: 1794988800 }] }) };
    }
    let data;
    if (endpoint === 'herolist') data = { heroes: list };
    else if (endpoint === 'itemlist') data = { itemabilities: list };
    else {
      const hero = endpoint === 'herodata', id = Number(url.searchParams.get(hero ? 'hero_id' : 'item_id'));
      data = { [hero ? 'heroes' : 'items']: [{ id, name_loc: (zh ? '中文' : 'English') + id, desc_loc: 'Text', abilities: [] }] };
    }
    return { ok: true, json: async () => ({ result: { data } }) };
  };
  const fetched = await fetchCatalog({ fetcher });
  assert.equal(fetched.patch, '7.42');
  assert.ok(fetched.patchDate);
});

test('learningController serves bundled patchChanges, updates on diff refresh, and preserves markers on no-op refresh', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-patch-changes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), frame = {}, contents = { mainFrame: frame, isDestroyed: () => false, send() {} };
  const rendererDirectory = path.resolve('src/renderer');
  frame.url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const trusted = { sender: contents, senderFrame: frame };

  let nextCatalog = null;
  createLearningController({
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} },
    hub: { contents: () => contents, register() {} },
    rendererDirectory,
    dataDirectory: directory,
    refreshCatalog: async () => nextCatalog,
  });

  const initial = await handlers.get('learning:load')(trusted);
  assert.equal(initial.ok, true);
  assert.equal(initial.catalog.patch, '7.42');
  assert.equal(initial.patchChanges.patch, '7.42');
  assert.equal(initial.patchChanges.counts.addedShopItems, 6);

  // Zero-diff refresh keeps existing 7.42 markers intact
  nextCatalog = {
    ...catalog,
    fetchedAt: new Date(Date.parse(catalog.fetchedAt) + 60000).toISOString(),
    lessons: catalog.lessons.filter(l => l.kind !== 'phrase'),
  };
  const noopRes = await handlers.get('learning:update')(trusted);
  assert.equal(noopRes.ok, true);
  assert.equal(noopRes.changes.changes.length, 0);
  assert.equal(noopRes.patchChanges.patch, '7.42');
  assert.equal(noopRes.patchChanges.counts.addedShopItems, 6);

  // Real diff refresh builds and persists a new manifest for the next patch
  const modifiedLessons = catalog.lessons.filter(l => l.kind !== 'phrase').map(l => (
    l.id === 'item:1' ? { ...l, mechanics: { ...l.mechanics, item_cost: 2300 } } : l
  ));
  nextCatalog = {
    ...catalog,
    patch: '7.43',
    patchDate: '2026-12-01T00:00:00.000Z',
    fetchedAt: new Date(Date.parse(catalog.fetchedAt) + 120000).toISOString(),
    lessons: modifiedLessons,
  };
  const updatedRes = await handlers.get('learning:update')(trusted);
  assert.equal(updatedRes.ok, true);
  assert.equal(updatedRes.patchChanges.patch, '7.43');
  assert.equal(updatedRes.patchChanges.previousPatch, '7.42');
  assert.equal(updatedRes.patchChanges.entries['item:1'].stats[0].after, '2300g');
});

test('buildPatchChangesManifest gracefully handles empty diffs', () => {
  const empty = buildPatchChangesManifest({ diff: { from: 'a', to: 'b', changes: [] }, patch: '7.42' });
  assert.equal(empty.patch, '7.42');
  assert.deepEqual(empty.removed, []);
  assert.deepEqual(empty.entries, {});
});

test('all shipped Patch 7.42 items and abilities have official Chinese names, clean descriptions, aliases, and bundled MP3 audio', () => {
  const expectedZh = {
    'item:1942': '血腥投带',
    'item:1955': '双蛇杖',
    'item:1944': '瑞斯图尔的奉献',
    'item:1946': '锻星炉',
    'item:1948': '破天之矛',
    'item:1953': '莫尔迪基安的护足',
    'item:1880': '悬红',
    'item:1916': '板砖',
    'item:1917': '镇痛之钩',
    'item:1882': '邪恶药瓶',
    'item:1911': '虫巢思维头盔',
    'item:1951': '大战斗号角',
    'ability:1921': '狼群猎手',
    'ability:1762': '摔扔',
  };
  for (const [id, zh] of Object.entries(expectedZh)) {
    const lesson = catalog.lessons.find(l => l.id === id);
    assert.ok(lesson, `Missing lesson ${id}`);
    assert.equal(lesson.zh, zh, `${id} Chinese name mismatch`);
    assert.ok(lesson.descriptionZh && /[\u4e00-\u9fff]/.test(lesson.descriptionZh), `${id} missing Chinese description`);
    assert.doesNotMatch(lesson.descriptionZh, /%\w+%/, `${id} unresolved placeholder in Chinese description`);
  }

  const items = catalog.lessons.filter(l => l.kind === 'item');
  for (const [alias, expectedEn] of [['大榴弹', 'Bloodslinger'], ['大祭品', "Ristul's Devotion"], ['大相位', 'Sabatons of Mordiggian'], ['大天堂', 'Skypiercer'], ['大陨星锤', 'Starforge'], ['大战斗号角', 'Greater Horn of Battle']]) {
    assert.equal(searchShopItems(items, alias, shopCategories)[0]?.en, expectedEn, `Alias search failed for ${alias}`);
  }

  const patchAudioEntries = Object.entries(audioManifest.entries).filter(([, e]) => e.patch === '7.42');
  assert.equal(patchAudioEntries.length, 26);
  for (const [id, entry] of patchAudioEntries) {
    assert.ok(!entry.localOnly, `${id} must be bundled (not localOnly)`);
    const file = new URL('../src/renderer/assets/learning-audio/' + entry.file, import.meta.url);
    assert.ok(fs.existsSync(file), `Missing bundled MP3 for ${id}: ${entry.file}`);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, entry.bytes, id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.audioSha256, id);
    if (id.startsWith('item:')) {
      assert.equal(entry.content, 'explanation', `${id} audio should include both item name and description`);
      assert.ok(entry.script.length > entry.name.length + 20, `${id} script should contain full description`);
    }
  }
});

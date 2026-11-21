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
import { applyReviewedLocalizations } from '../src/learning/reviewedLocalizations.js';
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
  const balmhook = catalog.lessons.find(lesson => lesson.internalName === 'item_balmhook');
  const fixtureItem = { id: 1917, name: balmhook.internalName };
  const fetcher = async url => {
    const endpoint = url.pathname.split('/').pop(), zh = url.searchParams.get('language') === 'schinese';
    if (endpoint === 'patchnoteslist') {
      return { ok: true, json: async () => ({ patches: [{ patch_number: '7.42', patch_timestamp: 1794988800 }] }) };
    }
    let data;
    if (endpoint === 'herolist') data = { heroes: list };
    else if (endpoint === 'itemlist') data = { itemabilities: [...list, fixtureItem] };
    else {
      const hero = endpoint === 'herodata', id = Number(url.searchParams.get(hero ? 'hero_id' : 'item_id'));
      data = { [hero ? 'heroes' : 'items']: [!hero && id === fixtureItem.id
        ? { id, name_loc: balmhook.en, desc_loc: balmhook.descriptionEn }
        : { id, name_loc: (zh ? '中文' : 'English') + id, desc_loc: 'Text', abilities: [] }] };
    }
    return { ok: true, json: async () => ({ result: { data } }) };
  };
  const fetched = await fetchCatalog({ fetcher });
  assert.equal(fetched.patch, '7.42');
  assert.ok(fetched.patchDate);
  const localized = fetched.lessons.find(lesson => lesson.id === balmhook.id);
  assert.equal(localized.zh, balmhook.zh);
  assert.equal(localized.descriptionZh, balmhook.descriptionZh);
  assert.equal(localized.descriptionEn, balmhook.descriptionEn);
});

test('reviewed translations are limited to the exact patch, matching lesson and known feed gaps', () => {
  const balmhook = catalog.lessons.find(lesson => lesson.internalName === 'item_balmhook');
  const fallback = { ...balmhook, zh: balmhook.en, descriptionZh: balmhook.descriptionEn };
  const patch = { patch: '7.42', lessons: [fallback] };
  assert.deepEqual(applyReviewedLocalizations(patch).lessons, [balmhook]);
  assert.equal(fallback.zh, fallback.en);

  for (const version of ['7.42a', '7.43', null]) {
    const otherPatch = { ...patch, patch: version };
    assert.equal(applyReviewedLocalizations(otherPatch), otherPatch);
  }
  const feedTranslation = { ...fallback, zh: '新译名', descriptionZh: '新的官方中文说明' };
  const differentLesson = { ...fallback, en: 'Reused ID', zh: 'Reused ID' };
  const changedDescription = { ...fallback, descriptionEn: 'New mechanic', descriptionZh: 'New mechanic' };
  const lessons = [feedTranslation, differentLesson, changedDescription];
  const result = applyReviewedLocalizations({ ...patch, lessons }).lessons;
  assert.equal(result[0], feedTranslation);
  assert.equal(result[1], differentLesson);
  assert.equal(result[2].zh, balmhook.zh);
  assert.equal(result[2].descriptionZh, changedDescription.descriptionEn);
});

test('Starforge distinguishes landing and stun durations and repairs the exact old Chinese text', () => {
  const starforge = catalog.lessons.find(lesson => lesson.id === 'item:1946');
  const values = new Map(starforge.mechanics.special_values.map(entry => [entry.name, entry.values[0]]));
  assert.equal(values.get('land_time'), 0.5);
  assert.equal(values.get('stun_duration'), 0.75);
  assert.match(starforge.descriptionZh, /0\.5秒延迟.*眩晕0\.75秒/);
  assert.match(audioManifest.entries[starforge.id].script, /stunning enemies for 0\.75s/);

  const stale = { ...starforge, descriptionZh: starforge.descriptionZh.replace('眩晕0.75秒', '眩晕0.5秒') };
  const localized = { ...starforge, descriptionZh: '陨星在0.5秒后落下，眩晕持续0.75秒。' };
  const patch = { patch: '7.42', lessons: [stale, localized] };
  const [restored, untouched] = applyReviewedLocalizations(patch).lessons;
  assert.deepEqual(restored, starforge);
  assert.equal(untouched, localized);
  assert.equal(applyReviewedLocalizations({ ...patch, patch: '7.42a' }).lessons[0], stale);

  const curse = catalog.lessons.find(lesson => lesson.id === 'ability:5587');
  assert.match(curse.descriptionZh, /对建筑的持续伤害减少100%/);
  const tome = catalog.lessons.find(lesson => lesson.id === 'item:257');
  assert.doesNotMatch(tome.descriptionEn + tome.descriptionZh, /%customval_team_tomes_used%/);
});

test('patch history stays with its verified version through same-patch updates and new releases', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-patch-changes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), frame = {}, contents = { mainFrame: frame, isDestroyed: () => false, send() {} };
  const rendererDirectory = path.resolve('src/renderer');
  frame.url = pathToFileURL(path.join(rendererDirectory, 'learning.html')).href;
  const trusted = { sender: contents, senderFrame: frame };

  const balmhook = catalog.lessons.find(lesson => lesson.internalName === 'item_balmhook');
  fs.writeFileSync(path.join(directory, 'learning-catalog.json'), JSON.stringify({
    ...catalog,
    fetchedAt: new Date(Date.parse(catalog.fetchedAt) + 30000).toISOString(),
    lessons: catalog.lessons.map(lesson => lesson.id === balmhook.id
      ? { ...lesson, zh: lesson.en, descriptionZh: lesson.descriptionEn }
      : lesson),
  }));
  fs.writeFileSync(path.join(directory, 'learning-patch-changes.json'), JSON.stringify({
    schema: 1, patch: '7.42', previousPatch: null, entries: {}, removed: [],
  }));

  let nextCatalog = null;
  const controllerOptions = {
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} },
    hub: { contents: () => contents, register() {} },
    rendererDirectory,
    dataDirectory: directory,
    refreshCatalog: async () => nextCatalog,
  };
  createLearningController(controllerOptions);

  const initial = await handlers.get('learning:load')(trusted);
  assert.equal(initial.ok, true);
  assert.equal(initial.catalog.patch, '7.42');
  assert.deepEqual(initial.catalog.lessons.find(lesson => lesson.id === balmhook.id), balmhook);
  assert.equal(initial.patchChanges.patch, '7.42');
  assert.equal(initial.patchChanges.previousPatch, '7.41f');
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

  // A feed-only translation correction must not erase highlights from the release comparison.
  nextCatalog = {
    ...nextCatalog,
    fetchedAt: new Date(Date.parse(catalog.fetchedAt) + 90000).toISOString(),
    lessons: nextCatalog.lessons.map(lesson => lesson.id === balmhook.id
      ? { ...lesson, descriptionZh: '服务器提供的更正说明。' }
      : lesson),
  };
  const samePatch = await handlers.get('learning:update')(trusted);
  assert.equal(samePatch.changes.changes.length, 1);
  assert.equal(samePatch.catalog.lessons.find(lesson => lesson.id === balmhook.id).descriptionZh, '服务器提供的更正说明。');
  assert.deepEqual(samePatch.patchChanges, initial.patchChanges);
  createLearningController(controllerOptions);
  assert.deepEqual((await handlers.get('learning:load')(trusted)).patchChanges, initial.patchChanges);

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

  // A verified release may have no diff in the fields we collect.
  nextCatalog = {
    ...nextCatalog,
    patch: '7.43a',
    fetchedAt: new Date(Date.parse(catalog.fetchedAt) + 180000).toISOString(),
  };
  const noObservedChanges = await handlers.get('learning:update')(trusted);
  assert.equal(noObservedChanges.changes.changes.length, 0);
  assert.equal(noObservedChanges.patchChanges.patch, '7.43a');
  assert.equal(noObservedChanges.patchChanges.previousPatch, '7.43');
  assert.deepEqual(noObservedChanges.patchChanges.entries, {});
  createLearningController(controllerOptions);
  assert.deepEqual((await handlers.get('learning:load')(trusted)).patchChanges, noObservedChanges.patchChanges);

  // If the patch lookup fails, keep the previous known history and the new lesson contents.
  nextCatalog = {
    ...nextCatalog,
    patch: null,
    fetchedAt: new Date(Date.parse(catalog.fetchedAt) + 240000).toISOString(),
    lessons: nextCatalog.lessons.map(lesson => lesson.id === balmhook.id
      ? { ...lesson, descriptionZh: '未核验版本的更新说明。' }
      : lesson),
  };
  const unverified = await handlers.get('learning:update')(trusted);
  assert.equal(unverified.catalog.patch, null);
  assert.equal(unverified.changes.changes.length, 1);
  assert.deepEqual(unverified.patchChanges, noObservedChanges.patchChanges);
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

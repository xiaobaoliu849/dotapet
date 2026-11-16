import test from 'node:test';
import assert from 'node:assert/strict';
import { planStudy, studyOptions, localDay, studySummary } from '../src/learning/study.js';
import fs from 'node:fs';
import { STARTER_UNITS, STARTER_ITEMS, starterAvailability } from '../src/learning/starterPath.js';

const lessons = Array.from({ length: 20 }, (_, index) => ({ id: `hero:${index}`, kind: 'hero', en: `Hero ${index}`, zh: `英雄 ${index}`, parent: '', descriptionEn: '', descriptionZh: '' }));

test('starter units have ten distinct catalog items with dated, independent official shop evidence', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
  const evidence = JSON.parse(fs.readFileSync(new URL('../src/learning/starter-shop-evidence.json', import.meta.url)));
  const ids = STARTER_UNITS.flatMap(unit => unit.lessonIds);
  assert.equal(ids.length, 10); assert.equal(new Set(ids).size, 10);
  assert.ok(Number.isFinite(Date.parse(evidence.checkedAt)));
  assert.equal(evidence.gameClientChecked, false);
  assert.deepEqual(evidence.sources.map(source => new URL(source.url).hostname).sort(), ['www.dota2.com', 'www.dota2.com.cn']);
  for (const source of evidence.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
  for (const id of ids) {
    assert.ok(catalog.lessons.some(lesson => lesson.id === id && lesson.kind === 'item'));
    assert.ok(STARTER_ITEMS[id].en && STARTER_ITEMS[id].zh);
    assert.equal(starterAvailability(evidence, id), true, id);
    const lesson = catalog.lessons.find(row => row.id === id);
    assert.equal(starterAvailability(evidence, id, lesson), true);
    assert.equal(starterAvailability(evidence, id, { ...lesson, en: 'Renamed item' }), false);
    assert.equal(starterAvailability(evidence, id, { ...lesson, internalName: 'item_other' }), false);
  }
  assert.equal(starterAvailability({ entries: { [ids[0]]: { internalName: 'wrong', shopListed: true, valveListed: true } } }, ids[0]), false);
});

test('starter sessions teach an ordered unit and restrict distractors without pulling future reviews forward', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
  const unit = STARTER_UNITS[0], options = { scope: unit.id, direction: 'zh', size: 10, kind: 'hero', search: 'unrelated' };
  const planned = planStudy(catalog.lessons, {}, options, 1000, () => 0.5);
  assert.deepEqual(planned.items.map(item => item.lesson.id), unit.lessonIds);
  assert.equal(planned.options.kind, 'item'); assert.equal(planned.options.search, ''); assert.equal(planned.options.size, 5);
  const names = planned.items.map(item => item.lesson.en);
  for (const item of planned.items) assert.ok(item.question.options.every(option => names.includes(option)));
  const progress = { [unit.lessonIds[0]]: { attempts: 1, due: 2000 }, [unit.lessonIds[3]]: { attempts: 1, box: 0, due: 1 } };
  const review = planStudy(catalog.lessons, progress, { scope: unit.id }, 1000, () => 0.5);
  assert.equal(review.items[0].lesson.id, unit.lessonIds[3]);
  assert.ok(!review.items.some(item => item.lesson.id === unit.lessonIds[0]));
});

test('study plans bound length and prioritize due mistakes, overdue reviews, then unseen words', () => {
  const progress = { 'hero:0': { attempts: 1, box: 0, due: 2000 }, 'hero:1': { attempts: 1, box: 1, due: 100 },
    'hero:2': { attempts: 1, box: 0, due: 500 }, 'hero:3': { attempts: 1, box: 1, due: 200 } };
  const plan = planStudy(lessons, progress, { size: 5 }, 1000, () => .5);
  assert.equal(plan.items.length, 5);
  assert.deepEqual(plan.items.slice(0, 3).map(item => item.lesson.id), ['hero:2', 'hero:1', 'hero:3']);
  assert.ok(!plan.items.some(item => item.lesson.id === 'hero:0'), 'future mistake stays scheduled');
  assert.equal(new Set(plan.items.map(item => item.lesson.id)).size, 5);
  assert.equal(planStudy(lessons, {}, { size: 10 }).items.length, 10);
});

test('saved-only sessions intersect topic and search without leaking other lessons', () => {
  const progress = { 'hero:1': { saved: true }, 'hero:2': { saved: true } };
  const plan = planStudy(lessons, progress, { scope: 'saved', search: 'Hero 1', kind: 'hero' });
  assert.deepEqual(plan.items.map(item => item.lesson.id), ['hero:1']);
  assert.equal(planStudy(lessons, progress, { scope: 'saved', kind: 'item' }).items.length, 0);
  assert.equal(planStudy(lessons, {}, { scope: 'saved' }).items.length, 0);
});

test('sessions allow a short queue and skip unquizzable topics without breaking the limit', () => {
  assert.equal(planStudy(lessons.slice(0, 1), {}, {}).items.length, 0);
  const progress = Object.fromEntries(lessons.map(lesson => [lesson.id, { due: 2000, attempts: 1 }]));
  assert.equal(planStudy(lessons, progress, {}, 1000).items.length, 0);
  progress['hero:5'].due = 500;
  assert.equal(planStudy(lessons, progress, {}, 1000).items.length, 1);
});

test('options reject invalid limits, scope and direction; summaries use the local completion day', () => {
  for (const value of [{ size: 10000 }, { size: '5' }, { scope: 'other' }, { direction: 'other' }, { search: 7 }, null]) assert.throws(() => studyOptions(value), /Invalid/);
  const completedAt = new Date(2026, 10, 15, 23, 59).getTime();
  assert.equal(localDay(completedAt), '2026-11-15');
  assert.deepEqual(studySummary({ id: 'test', completedAt, options: { scope: 'saved' }, answers: [{ id: 'a', correct: true }, { id: 'b', correct: false }] }),
    { id: 'test', day: '2026-11-15', completedAt, total: 2, correct: 1, scope: 'saved', mistakes: ['b'] });
});

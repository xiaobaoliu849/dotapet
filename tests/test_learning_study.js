import test from 'node:test';
import assert from 'node:assert/strict';
import { planStudy, studyOptions, localDay, studySummary } from '../src/learning/study.js';

const lessons = Array.from({ length: 20 }, (_, index) => ({ id: `hero:${index}`, kind: 'hero', en: `Hero ${index}`, zh: `英雄 ${index}`, parent: '', descriptionEn: '', descriptionZh: '' }));

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

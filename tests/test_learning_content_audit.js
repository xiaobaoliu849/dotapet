import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contentKey, narrationText, audioFreshness, diffCatalog, auditContent } from '../src/learning/contentAudit.js';
import { describe } from '../src/learning/model.js';

const lesson = { id: 'ability:1', kind: 'ability', en: 'Test', zh: '测试', parent: 'Hero', descriptionEn: 'Deals 65% damage.', descriptionZh: '造成伤害。' };
const entry = { name: 'Test', content: 'explanation' };
test('content comparison ignores presentation but preserves numeric changes and signs', () => {
  assert.equal(contentKey('<h1>Active: Blink</h1> 1200 units.'), contentKey('Active: Blink: 1200 units'));
  assert.notEqual(contentKey('60% damage'), contentKey('65% damage'));
  assert.notEqual(contentKey('-4 armor'), contentKey('+4 armor'));
});

test('archive classifications never certify an inferred MP3 transcript', () => {
  const baseline = { entries: { [lesson.id]: { candidateSpeech: 'Test. Deals 60% damage.', evidence: 'inferred' } } };
  assert.equal(audioFreshness(entry, lesson, baseline).status, 'baseline-changed');
  baseline.entries[lesson.id].candidateSpeech = 'Test. Deals 65% damage.';
  assert.equal(audioFreshness(entry, lesson, baseline).status, 'baseline-matches');
  baseline.entries[lesson.id].candidateSpeech = 'Test. +Strength: 25. Deals 65% damage. Extra note.';
  assert.equal(audioFreshness(entry, lesson, baseline).status, 'baseline-extra-context', 'extra archive notes are not automatically obsolete');
  assert.equal(audioFreshness(entry, lesson, {}).status, 'unknown-transcript');
  assert.equal(audioFreshness(null, lesson, baseline).status, 'missing');
  assert.equal(audioFreshness({ ...entry, name: 'Old name' }, lesson, baseline).status, 'missing');
  assert.equal(audioFreshness(entry, { ...lesson, descriptionEn: 'Deals %damage%.' }, baseline).status, 'unresolved-current');
  assert.equal(audioFreshness(entry, { ...lesson, descriptionEn: '' }, baseline).status, 'needs-stats-template');
});

test('biography narration compares the biography rather than the short hero summary', () => {
  const hero = { ...lesson, kind: 'hero', biographyEn: 'A hero story.' };
  assert.equal(narrationText(hero, 'biography'), 'A hero story.');
  assert.equal(narrationText(hero, 'expression'), 'Test');
});

test('catalog differences include numeric-only changes but do not invent changes for newly captured fields', () => {
  const old = { ...lesson, mechanics: { cooldowns: [10], special_values: [{ name: 'burn', values: [60], shard: [], scepter: [] }] } };
  const current = { ...old, mechanics: { cooldowns: [10], durations: [3], special_values: [{ name: 'burn', values: [65], shard: [], scepter: [] }] } };
  const diff = diffCatalog({ fetchedAt: 'old', lessons: [old] }, { fetchedAt: 'new', lessons: [current] });
  assert.equal(diff.changes.length, 1); assert.deepEqual(diff.changes[0].fields, []);
  assert.equal(diff.changes[0].mechanicsChanges.length, 1); assert.equal(diff.changes[0].mechanicsChanges[0].field, 'burn');
  assert.equal(diffCatalog({ lessons: [lesson] }, { lessons: [current] }).changes.length, 0);
  assert.deepEqual(diffCatalog({ lessons: [old] }, { lessons: [{ ...current, id: 'ability:2' }] }).changes.map(row => row.type), ['added', 'removed']);
});

test('official text interpolation uses exact bonus names, builtin fields and a single percent marker', () => {
  assert.equal(describe({ desc_loc: 'Lasts %AbilityChannelTime%s. Deals %bonus_damage%%%', channel_times: [5], special_values: [{ name: 'bonus_damage', values_float: [65] }] }), 'Lasts 5s. Deals 65%');
  assert.equal(describe({ desc_loc: '%unknown%' }), '%unknown%');
});

test('audit evidence is complete; synthesis queue blocks placeholders and starts unreviewed', () => {
  const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
  const catalog = read('../src/learning/catalog.json'), manifest = read('../src/learning/audio-manifest.json'), baseline = read('../src/learning/audio-baseline.json');
  const audit = auditContent(catalog, manifest, baseline);
  assert.equal(Object.values(audit.counts).reduce((sum, value) => sum + value, 0), catalog.lessons.length);
  assert.equal(baseline.transcriptVerified, false);
  const queue = read('../docs/audits/audio-regeneration-queue.json');
  for (const job of queue.entries) {
    assert.equal(job.reviewed, false); assert.doesNotMatch(job.text, /%\w+%/); assert.match(job.textSha256, /^[0-9a-f]{64}$/);
    assert.ok(['missing', 'baseline-changed'].includes(job.reason));
  }
});

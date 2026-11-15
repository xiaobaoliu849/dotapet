import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { narrationText } from '../src/learning/contentAudit.js';
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const plan = read('../docs/audio-samples/batch-plan.json');
const manifest = read('../docs/audio-samples/jenny-batch-1/manifest.json');
const catalog = read('../src/learning/catalog.json');
const hash = value => createHash('sha256').update(value).digest('hex');

test('eight audition scripts are bound to exact current source text and keep listening approval pending', () => {
  assert.equal(plan.entries.length, 8); assert.equal(new Set(plan.entries.map(entry => entry.id)).size, 8);
  for (const entry of plan.entries) {
    const lesson = catalog.lessons.find(lesson => lesson.id === entry.id);
    if (catalog.fetchedAt === entry.catalogFetchedAt) assert.equal(entry.sourceText, narrationText(lesson, 'explanation'));
    assert.equal(entry.sourceTextSha256, hash(entry.sourceText)); assert.equal(entry.scriptSha256, hash(entry.script));
    assert.equal(entry.sourceReviewed, true); assert.equal(entry.listeningApproved, false); assert.equal(entry.promoted, false);
    assert.doesNotMatch(entry.script, /%\w+%/);
  }
});

test('all ten sample files have valid hashes, full decode checks and matching ASR numeric counts', () => {
  const asr = read('../docs/audio-samples/jenny-batch-1/asr-review.json');
  assert.equal(manifest.entries.length, 10);
  for (const entry of manifest.entries) {
    assert.match(entry.file, /^(ability|item)-\d+(?:-plus10)?\.mp3$/);
    const audio = fs.readFileSync(new URL('../docs/audio-samples/jenny-batch-1/' + entry.file, import.meta.url));
    assert.equal(hash(audio), entry.audioSha256); assert.equal(audio.length, entry.bytes);
    assert.equal(entry.audioValidation, 'technical-pass'); assert.equal(entry.technicalValidation.decodedCompletely, true);
    assert.equal(entry.technicalValidation.peakNearFullScale, false); assert.ok(entry.technicalValidation.durationSeconds > 1);
    const check = asr.entries.find(row => row.file === entry.file && row.audioSha256 === entry.audioSha256);
    assert.ok(check, entry.file); assert.equal(check.numberCountsMatch, true); assert.deepEqual(check.missingCriticalNumberChecks, []);
    assert.equal(entry.listeningApproved, false); assert.equal(entry.promoted, false);
    assert.equal(entry.voice, 'en-US-JennyNeural'); assert.equal(entry.playbackRate, 1);
  }
});

test('all eight original bundled recordings remain unchanged', () => {
  const archive = read('../src/learning/audio-manifest.json'), baseline = read('../src/learning/audio-baseline.json');
  for (const entry of plan.entries) {
    const audio = fs.readFileSync(new URL('../src/renderer/assets/learning-audio/' + archive.entries[entry.id].file, import.meta.url));
    assert.equal(hash(audio), baseline.entries[entry.id].recordingSha256, entry.id);
  }
});

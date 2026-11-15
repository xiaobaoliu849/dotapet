import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { audioCandidates, recordedAudio } from '../src/learning/audioAssets.js';
import { createLearningAudio } from '../src/renderer/learning-audio.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../src/learning/audio-manifest.json', import.meta.url)));
const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
test('recordings are bundled locally, nonempty MP3s, and cover every hero, ability and expression', () => {
  assert.equal(Object.keys(manifest.entries).length, 1146);
  for (const [id, entry] of Object.entries(manifest.entries)) {
    assert.match(entry.file, /^(hero|ability|item|phrase)\/[\w-]+\.mp3$/);
    const file = new URL('../src/renderer/assets/learning-audio/' + entry.file, import.meta.url);
    assert.equal(fs.statSync(file).size, entry.bytes, id);
    const header = Buffer.alloc(3), fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, header, 0, 3, 0); } finally { fs.closeSync(fd); }
    assert.ok(header.toString() === 'ID3' || (header[0] === 255 && (header[1] & 224) === 224), id + ' has no MP3 header');
  }
  for (const lesson of catalog.lessons.filter(lesson => lesson.kind !== 'item')) assert.ok(recordedAudio(manifest, lesson), lesson.id);
  assert.equal(manifest.missing.length, 164);
});

test('audio mapping respects hero context, apostrophes and legacy filenames; renamed lessons are unmatched', () => {
  assert.deepEqual(audioCandidates({ kind: 'ability', en: "Nature’s Call", parent: "Nature's Prophet · 先知" }), ["heroes/NaturesProphet/Nature's_Call.mp3", 'heroes/NaturesProphet/Natures_Call.mp3']);
  assert.deepEqual(audioCandidates({ kind: 'hero', en: 'Anti-Mage' }), ['heroes/AntiMage/Bio.mp3']);
  const lesson = catalog.lessons.find(lesson => manifest.entries[lesson.id]);
  assert.equal(recordedAudio(manifest, { ...lesson, en: 'Renamed' }), null);
});

function fixture(play = () => Promise.resolve()) {
  const changes = [], tracks = [];
  const createAudio = () => {
    const audio = { paused: false, src: '', play() { return play(); }, pause() { this.paused = true; }, removeAttribute() { this.src = ''; }, load() {} };
    tracks.push(audio); return audio;
  };
  return { changes, tracks, player: createLearningAudio({ createAudio, onChange: state => changes.push(state) }) };
}

test('MP3 playback uses normal speed, toggles off, stops older tracks and resets on end', async () => {
  const f = fixture();
  await f.player.toggle('a', 'file:///a.mp3');
  assert.equal(f.tracks[0].playbackRate, 1); assert.equal(f.changes.at(-1).status, 'playing');
  await f.player.toggle('b', 'file:///b.mp3');
  assert.ok(f.tracks[0].paused); assert.equal(f.tracks[0].src, '');
  f.tracks[1].onended(); assert.equal(f.changes.at(-1).status, 'stopped');
  await f.player.toggle('c', 'file:///c.mp3'); await f.player.toggle('c', 'file:///c.mp3');
  assert.equal(f.tracks.length, 3); assert.equal(f.changes.at(-1).status, 'stopped');
});

test('failed playback reports an error and does not start a system voice', async () => {
  const f = fixture(() => Promise.reject(new Error('decoder failed')));
  await f.player.toggle('a', 'file:///bad.mp3');
  assert.equal(f.changes.at(-1).status, 'error'); assert.ok(f.tracks[0].paused);
});

test('stopping during a pending play prevents stale completion from reviving playback', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.player.toggle('a', 'file:///a.mp3');
  f.player.stop(); finish(); await pending;
  assert.equal(f.changes.at(-1).status, 'stopped'); assert.ok(f.tracks[0].paused);
  assert.ok(!f.changes.some(state => state.status === 'playing'));
});

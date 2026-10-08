import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhrasesStore, DEFAULT_SIMPLIFIED_PHRASES } from '../src/main/phrasesStore.js';
const copy = () => structuredClone(DEFAULT_SIMPLIFIED_PHRASES);
function fixture(t, fsImpl = fs) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-phrases-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'custom_phrases.json');
  fs.writeFileSync(filePath, JSON.stringify(copy()));
  return { filePath, store: new PhrasesStore({ filePath, fsImpl }) };
}

test('a successful atomic save survives restart and cache callers cannot mutate it', t => {
  const { store, filePath } = fixture(t);
  const next = copy(); next[0].en = 'Saved phrase';
  assert.equal(store.save(next).success, true);
  next[0].en = 'Changed caller';
  const read = store.load(); read[0].en = 'Changed reader';
  assert.equal(store.load()[0].en, 'Saved phrase');
  assert.equal(new PhrasesStore({ filePath }).load()[0].en, 'Saved phrase');
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
});

for (const failure of ['write', 'rename']) test(`${failure} failure preserves the previous cache and file`, t => {
  const fsImpl = { ...fs };
  if (failure === 'write') fsImpl.writeFileSync = (file, data) => { fs.writeFileSync(file, data.slice(0, 8)); throw new Error('disk full'); };
  else fsImpl.renameSync = () => { throw new Error('file locked'); };
  const { store, filePath } = fixture(t, fsImpl);
  const previous = store.load(); const disk = fs.readFileSync(filePath, 'utf8');
  const next = copy(); next[0].cn = '未保存的内容';
  assert.equal(store.save(next).success, false);
  assert.deepEqual(store.load(), previous);
  assert.equal(fs.readFileSync(filePath, 'utf8'), disk);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
});

test('invalid save payloads leave disk and cache unchanged', t => {
  const { store, filePath } = fixture(t); const previous = store.load();
  for (const payload of [null, {}, [], Array(10), copy().slice(1), Array(10).fill({ cn: 'text', en: 4 })]) {
    assert.equal(store.save(payload).success, false);
  }
  assert.deepEqual(store.load(), previous);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), previous);
});

test('legacy shorter lists keep existing text and pad unused slots', t => {
  const { filePath } = fixture(t);
  fs.writeFileSync(filePath, JSON.stringify([{ cn: '原来的短语', en: 'Legacy phrase' }]));
  const loaded = new PhrasesStore({ filePath }).load();
  assert.equal(loaded.length, 10); assert.equal(loaded[0].cn, '原来的短语');
  assert.deepEqual(loaded[9], { cn: '', en: '' });
  fs.writeFileSync(filePath, 'invalid');
  assert.deepEqual(new PhrasesStore({ filePath }).load(), copy());
});

test('conflicting row saves are atomic and require a fresh base before overwrite', t => {
  const { store } = fixture(t); const base = store.load();
  const a = copy(), b = copy(); a[0].en = 'Editor A'; b[0].en = 'Editor B'; b[1].en = 'New row';
  const first = store.save({ phrases: a, changedRows: [0], basePhrases: base });
  assert.equal(first.success, true); assert.equal(first.revision, 1);
  const conflict = store.save({ phrases: b, changedRows: [0, 1], basePhrases: base });
  assert.equal(conflict.success, false); assert.deepEqual(conflict.conflicts, [0]);
  assert.equal(store.load()[0].en, 'Editor A'); assert.equal(store.load()[1].en, base[1].en);
  assert.equal(store.snapshot().revision, 1);
  const retry = store.save({ phrases: b, changedRows: [0, 1], basePhrases: conflict.phrases });
  assert.equal(retry.success, true); assert.equal(retry.revision, 2);
  assert.equal(store.load()[0].en, 'Editor B'); assert.equal(store.load()[1].en, 'New row');
  // Identical content is safe to save even if its original base is old.
  assert.equal(store.save({ phrases: b, changedRows: [0], basePhrases: base }).success, true);
});

test('malformed row patches cannot change data or advance the saved revision', t => {
  const { store } = fixture(t); const base = store.load();
  for (const changedRows of [[-1], [10], [0, 0], ['0'], Array(1), null]) {
    assert.equal(store.save({ phrases: copy(), changedRows, basePhrases: base }).success, false);
  }
  assert.equal(store.save({ phrases: copy(), changedRows: [0], basePhrases: [] }).success, false);
  assert.deepEqual(store.load(), base); assert.equal(store.snapshot().revision, 0);
});

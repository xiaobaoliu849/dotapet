import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PhrasesStore } from '../src/main/phrasesStore.js';

const source = fs.readFileSync(new URL('../src/renderer/phrases.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const initial = () => Array.from({ length: 10 }, (_, i) => ({ cn: `中文 ${i}`, en: `English ${i}` }));
const decode = value => value.replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

async function renderer(overrides = {}, config = initial()) {
  class Element {
    constructor() { this.dataset = {}; this.children = []; this.listeners = {}; this.value = ''; this.disabled = false; this.classList = { add() {}, remove() {} }; }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    contains(child) { return this.children.includes(child); }
    closest() { return this.parent?.className === 'phrase-row-item' ? this.parent : null; }
    click() { if (!this.disabled) return this.listeners.click?.(); }
    set innerHTML(html) {
      this.children.forEach(child => { child.parent = null; }); this.children = [];
      if (this.className !== 'phrase-row-item') return;
      this.fields = {};
      for (const key of ['phrase-cn', 'phrase-en', 'btn-phrase-trans', 'copy-en', 'copy-cn']) {
        const node = new Element(); node.parent = this; this.fields[key] = node;
        if (key.startsWith('phrase-')) node.value = decode(html.match(new RegExp(`class="phrase-input ${key}"[^>]*value="([^"]*)"`))?.[1] || '');
        else if (key.startsWith('copy-')) node.dataset.type = key.slice(5);
      }
    }
    querySelector(selector) {
      if (selector.includes('data-index')) return this.children.find(row => Number(row.dataset.index) === Number(selector.match(/data-index="(\d+)"/)[1]));
      return this.fields?.[selector.slice(1)];
    }
    querySelectorAll(selector) {
      return selector === '.phrase-row-item' ? this.children : [this.fields['copy-en'], this.fields['copy-cn']];
    }
  }
  const nodes = new Map();
  for (const id of ['phrases-rows-container', 'btn-import-preset', 'btn-translate-all-phrases', 'btn-reset-default-phrases',
    'btn-save-phrases', 'btn-cancel-phrases', 'select-preset-template', 'select-preset-target-row', 'hud-toast', 'phrases-draft-status']) nodes.set(id, new Element());
  nodes.get('select-preset-target-row').value = '1';
  const calls = { saves: [], translations: [] };
  const api = { getPhrasesConfig: async () => config,
    savePhrasesConfig: async phrases => { calls.saves.push(JSON.parse(JSON.stringify(phrases))); return { success: true }; },
    translatePhraseText: async text => { calls.translations.push(text); return { translated: 'Translated' }; },
    onPhrasesChanged: callback => { calls.changed = callback; }, ...overrides };
  const document = { documentElement: { dataset: {} }, getElementById: id => nodes.get(id), createElement: () => new Element() };
  vm.runInNewContext(source, { document, window: { electronAPI: api, addEventListener() {}, close() {} }, console,
    setTimeout: () => 1, clearTimeout() {} });
  await tick();
  const row = index => nodes.get('phrases-rows-container').children[index];
  const type = (index, language, text) => {
    const input = row(index).querySelector(`.phrase-${language}`); input.value = text;
    nodes.get('phrases-rows-container').listeners.input({ target: input });
  };
  return { nodes, calls, row, type, api, translate: index => row(index).querySelector('.btn-phrase-trans').click(),
    save: () => nodes.get('btn-save-phrases').click(), toast: () => nodes.get('hud-toast').textContent,
    status: () => nodes.get('phrases-draft-status').textContent };
}

test('an unchanged translation fills English and marks the draft unsaved', async () => {
  const ui = await renderer(); await ui.translate(0);
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'Translated');
  assert.match(ui.status(), /1 行有未保存/);
});

for (const language of ['cn', 'en']) test(`a delayed translation preserves new ${language} input`, async () => {
  const request = deferred();
  const ui = await renderer({ translatePhraseText: () => request.promise });
  const translating = ui.translate(0); ui.type(0, language, 'New draft');
  request.resolve({ translated: 'Stale response' }); await translating;
  assert.equal(ui.row(0).querySelector(`.phrase-${language}`).value, 'New draft');
  assert.notEqual(ui.row(0).querySelector('.phrase-en').value, 'Stale response');
  assert.match(ui.toast(), /已保留/);
});

test('editing a row and restoring its old value still invalidates pending translation', async () => {
  const request = deferred(); const ui = await renderer({ translatePhraseText: () => request.promise });
  const translating = ui.translate(0); ui.type(0, 'cn', 'Changed'); ui.type(0, 'cn', '中文 0');
  request.resolve({ translated: 'Stale response' }); await translating;
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'English 0');
});

test('a save from the other editor invalidates translation for an untouched row', async () => {
  const request = deferred(); const ui = await renderer({ translatePhraseText: () => request.promise });
  const translating = ui.translate(0); const other = initial(); other[0] = { cn: '同步的中文', en: 'Synced English' };
  ui.calls.changed(other); request.resolve({ translated: 'Stale response' }); await translating;
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'Synced English');
  assert.equal(ui.status(), '无未保存改动');
});

test('reset while translating retains the new template rows', async () => {
  const request = deferred(); const ui = await renderer({ translatePhraseText: () => request.promise });
  const oldRow = ui.row(0); const translating = ui.translate(0);
  ui.nodes.get('btn-reset-default-phrases').click();
  const template = ui.row(0).querySelector('.phrase-en').value;
  request.resolve({ translated: 'Stale response' }); await translating;
  assert.notEqual(ui.row(0), oldRow);
  assert.equal(ui.row(0).querySelector('.phrase-en').value, template);
  assert.match(ui.status(), /10 行有未保存/);
});

test('batch translation preserves English typed during the request', async () => {
  const request = deferred(); const config = initial(); config[0].en = '';
  const ui = await renderer({ translatePhraseText: () => request.promise }, config);
  const translating = ui.nodes.get('btn-translate-all-phrases').click(); ui.type(0, 'en', 'Manual English');
  request.resolve({ translated: 'Stale response' }); await translating;
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'Manual English');
  assert.match(ui.toast(), /1 行有新改动/);
});

test('reset ends a running batch without translating detached rows', async () => {
  const request = deferred(); let calls = 0;
  const config = initial().map(row => ({ ...row, en: '' }));
  const ui = await renderer({ translatePhraseText: () => { calls++; return request.promise; } }, config);
  const translating = ui.nodes.get('btn-translate-all-phrases').click();
  ui.nodes.get('btn-reset-default-phrases').click();
  request.resolve({ translated: 'Stale response' }); await translating;
  assert.equal(calls, 1);
  assert.notEqual(ui.row(0).querySelector('.phrase-en').value, 'Stale response');
});

test('save acknowledges only its snapshot, protecting newer edits until the next save', async () => {
  const request = deferred(); const saves = [];
  const ui = await renderer({ savePhrasesConfig: phrases => {
    saves.push(JSON.parse(JSON.stringify(phrases)));
    return saves.length === 1 ? request.promise : Promise.resolve({ success: true });
  } });
  ui.type(0, 'en', 'Submitted'); const saving = ui.save();
  ui.type(0, 'en', 'Newer draft'); ui.type(1, 'cn', '另一处新改动');
  request.resolve({ success: true }); await saving;
  assert.equal(saves[0].phrases[0].en, 'Submitted');
  assert.deepEqual(saves[0].changedRows, [0]);
  assert.match(ui.status(), /2 行有未保存/);
  assert.match(ui.toast(), /新改动仍未保存/);
  const other = initial(); other[5].en = 'External saved'; ui.calls.changed(other);
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'Newer draft');
  assert.equal(ui.row(1).querySelector('.phrase-cn').value, '另一处新改动');
  assert.equal(ui.row(5).querySelector('.phrase-en').value, 'External saved');
  await ui.save(); assert.equal(saves[1].phrases[0].en, 'Newer draft');
  assert.equal(ui.status(), '无未保存改动');
  ui.calls.changed(initial()); assert.equal(ui.row(0).querySelector('.phrase-en').value, 'English 0');
});

test('a failed save keeps drafts protected from external sync and can be retried', async () => {
  const ui = await renderer({ savePhrasesConfig: async () => ({ success: false, error: 'disk full' }) });
  ui.type(0, 'en', 'Unsaved'); await ui.save(); ui.calls.changed(initial());
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'Unsaved');
  assert.match(ui.status(), /1 行有未保存/);
  assert.equal(ui.nodes.get('btn-save-phrases').disabled, false);
  ui.api.savePhrasesConfig = async () => ({ success: true }); await ui.save();
  assert.equal(ui.status(), '无未保存改动');
});

test('simultaneous saves merge different rows and late acknowledgments keep the newest state', async () => {
  let disk = JSON.stringify(initial()), temporary;
  const store = new PhrasesStore({ filePath: 'test-phrases', fsImpl: {
    readFileSync: () => disk, writeFileSync: (_path, contents) => { temporary = contents; },
    renameSync: () => { disk = temporary; }, unlinkSync() {},
  } });
  const replies = [];
  const savePhrasesConfig = payload => {
    const result = store.save(payload); const reply = deferred(); replies.push({ result, reply });
    return reply.promise;
  };
  const a = await renderer({ savePhrasesConfig }), b = await renderer({ savePhrasesConfig });
  a.type(0, 'en', 'Editor A'); b.type(1, 'en', 'Editor B');
  const savingA = a.save(), savingB = b.save();
  assert.equal(store.load()[0].en, 'Editor A');
  assert.equal(store.load()[1].en, 'Editor B');
  // The latest event may arrive before either editor receives its own reply.
  const latest = replies[1].result;
  a.calls.changed(latest); b.calls.changed(latest);
  replies[1].reply.resolve(latest); replies[0].reply.resolve(replies[0].result);
  await Promise.all([savingA, savingB]);
  for (const ui of [a, b]) {
    assert.equal(ui.row(0).querySelector('.phrase-en').value, 'Editor A');
    assert.equal(ui.row(1).querySelector('.phrase-en').value, 'Editor B');
    assert.equal(ui.status(), '无未保存改动');
  }
});

test('same-row edits keep the draft and offer an explicit conflict overwrite', async () => {
  let disk = JSON.stringify(initial()), temporary;
  const store = new PhrasesStore({ filePath: 'test-phrases', fsImpl: {
    readFileSync: () => disk, writeFileSync: (_path, contents) => { temporary = contents; },
    renameSync: () => { disk = temporary; }, unlinkSync() {},
  } });
  const savePhrasesConfig = async payload => store.save(payload);
  const a = await renderer({ savePhrasesConfig }), b = await renderer({ savePhrasesConfig });
  a.type(0, 'en', 'Editor A'); b.type(0, 'en', 'Editor B');
  await a.save(); b.calls.changed(store.snapshot()); await b.save();
  assert.equal(store.load()[0].en, 'Editor A');
  assert.equal(b.row(0).querySelector('.phrase-en').value, 'Editor B');
  assert.match(b.toast(), /本次未保存/); assert.match(b.status(), /保存冲突/);
  assert.equal(b.nodes.get('btn-save-phrases').textContent, '确认覆盖冲突并保存');
  // A third edit after the conflict must be detected again, rather than bypassing checks.
  a.type(0, 'en', 'Editor A newer'); await a.save(); await b.save();
  assert.equal(store.load()[0].en, 'Editor A newer'); assert.match(b.toast(), /本次未保存/);
  await b.save(); assert.equal(store.load()[0].en, 'Editor B'); assert.equal(b.status(), '无未保存改动');
});

test('new edits during an acknowledged save use that committed row as their next base', async () => {
  const request = deferred(); let saved;
  const ui = await renderer({ savePhrasesConfig: payload => { saved = JSON.parse(JSON.stringify(payload)); return request.promise; } });
  ui.type(0, 'en', 'Submitted'); const saving = ui.save(); ui.type(0, 'en', 'New draft');
  request.resolve({ success: true, phrases: saved.phrases, revision: 1 }); await saving;
  ui.api.savePhrasesConfig = async payload => { saved = JSON.parse(JSON.stringify(payload)); return { success: true, phrases: payload.phrases, revision: 2 }; };
  await ui.save(); assert.equal(saved.basePhrases[0].en, 'Submitted'); assert.equal(saved.phrases[0].en, 'New draft');
});

test('loading saved phrases cannot overwrite a template chosen before initialization finishes', async () => {
  const request = deferred(); const ui = await renderer({ getPhrasesConfig: () => request.promise });
  for (const id of ['btn-import-preset', 'btn-translate-all-phrases', 'btn-reset-default-phrases', 'btn-save-phrases']) {
    assert.equal(ui.nodes.get(id).disabled, true, id);
    ui.nodes.get(id).click();
  }
  assert.equal(ui.nodes.get('phrases-rows-container').children.length, 0);
  request.resolve({ phrases: initial(), revision: 0 }); await tick();
  assert.equal(ui.row(0).querySelector('.phrase-en').value, 'English 0');
  assert.equal(ui.nodes.get('btn-reset-default-phrases').disabled, false);
});

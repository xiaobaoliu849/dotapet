import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANGUAGES, LANGUAGE_CHOICES, resolveLanguage, loadStrings, translate } from '../src/i18n/index.js';

test('the saved choice wins; otherwise the first system language we have, else English', () => {
  assert.equal(resolveLanguage('zh', ['en-US']), 'zh');
  assert.equal(resolveLanguage('en', ['zh-CN']), 'en');
  assert.equal(resolveLanguage('system', ['zh-CN', 'en-US']), 'zh');
  assert.equal(resolveLanguage('system', ['zh-Hant-TW']), 'zh');
  assert.equal(resolveLanguage('system', ['de-DE', 'en-GB']), 'en');
  assert.equal(resolveLanguage('system', ['ru-RU']), 'ru');
  assert.equal(resolveLanguage('system', ['uk-UA', 'ru-RU']), 'uk');
  assert.equal(resolveLanguage('system', ['de-DE']), 'en', 'no match falls back to English');
  assert.equal(resolveLanguage('klingon', []), 'en', 'an unknown saved choice is ignored');
  assert.deepEqual(LANGUAGE_CHOICES, ['system', ...LANGUAGES.map(language => language.id)]);
});

test('translate fills placeholders and falls back to the Chinese source', () => {
  const strings = { '已导入 {0} 个密钥': 'Imported {0} key(s)' };
  assert.equal(translate(strings, '已导入 {0} 个密钥', 3), 'Imported 3 key(s)');
  assert.equal(translate(strings, '未翻译 {0}', 'x'), '未翻译 x');
  assert.deepEqual(loadStrings('zh'), {});
});

for (const { id } of LANGUAGES.filter(language => language.id !== 'zh')) {
  test(`${id} dictionary: every translation keeps its placeholders and has no Chinese left`, () => {
    const strings = JSON.parse(fs.readFileSync(new URL(`../src/i18n/${id}.json`, import.meta.url), 'utf8'));
    const placeholders = text => (text.match(/\{\d\}/g) || []).sort().join();
    for (const [source, translation] of Object.entries(strings)) {
      assert.equal(typeof translation, 'string', source);
      assert.equal(placeholders(translation), placeholders(source), `placeholders differ: ${source}`);
      assert.doesNotMatch(translation, /[㐀-鿿]/, `Chinese left in: ${source}`);
      assert.doesNotMatch(source, /\{\d\}\{\d\}/, `adjacent placeholders cannot be matched back: ${source}`);
    }
  });
}

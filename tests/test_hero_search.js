import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heroMatchesSearch, HERO_SEARCH_ALIASES } from '../src/services/heroSearch.js';
const heroes = JSON.parse(fs.readFileSync(new URL('../heroes.config.json', import.meta.url), 'utf8')).heroes;
const search = query => Object.values(heroes).filter(hero => heroMatchesSearch(hero, query)).map(hero => hero.id);

test('every search example and common acronym resolves to the intended configured hero', () => {
  for (const [query, id] of [['卡尔', 'invoker'], ['SF', 'shadow_fiend'], ['白牛', 'spirit_breaker'],
    ['蓝猫', 'storm_spirit'], ['AM', 'anti_mage'], ['PA', 'phantom_assassin'], ['TA', 'templar_assassin']]) {
    assert.deepEqual(search(query), [id], query);
  }
});

test('names, canonical ids, curated pinyin and punctuation work together', () => {
  for (const query of ['祈求者', ' invoker ', 'kaer']) assert.ok(search(query).includes('invoker'));
  for (const query of ['Anti Mage', 'ANTI-MAGE', 'anti_mage', 'ＡＭ']) assert.ok(search(query).includes('anti_mage'));
  assert.ok(search('bainiu').includes('spirit_breaker'));
  assert.equal(search('').length, Object.keys(heroes).length);
  assert.deepEqual(search('unknown-hero-xyz'), []);
  assert.equal(heroMatchesSearch({ id: 'custom', aliases: ['自定义昵称'] }, '昵称'), true);
});

test('all curated alias groups refer to existing heroes and are searchable', () => {
  for (const [id, aliases] of Object.entries(HERO_SEARCH_ALIASES)) {
    assert.ok(heroes[id], id);
    for (const alias of aliases) assert.equal(heroMatchesSearch(heroes[id], alias), true, `${id}: ${alias}`);
  }
});

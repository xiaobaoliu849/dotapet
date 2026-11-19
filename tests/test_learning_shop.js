import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SHOP_REALMS, SHOP_CATEGORIES, CATEGORY_BY_KEY,
  classifyItem, realmCounts, groupItemsByCategory, searchShopItems, isActiveItem,
} from '../src/learning/itemShop.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
const shopCategories = JSON.parse(fs.readFileSync(new URL('../src/learning/item-shop-categories.json', import.meta.url)));
const items = catalog.lessons.filter(l => l.kind === 'item');

test('official shop categories manifest has valid schema and covers basic, upgrade and neutral shelves', () => {
  assert.equal(shopCategories.schema, 1);
  assert.ok(shopCategories.sha256 && shopCategories.sha256.length === 64);
  assert.ok(shopCategories.count > 200);
  const basicCats = SHOP_CATEGORIES.filter(c => c.shelf === 'basic');
  const upgradeCats = SHOP_CATEGORIES.filter(c => c.shelf === 'upgrade');
  const neutralCats = SHOP_CATEGORIES.filter(c => c.shelf === 'neutral');
  assert.equal(basicCats.length, 5);
  assert.equal(upgradeCats.length, 6);
  assert.equal(neutralCats.length, 5);
});

test('every catalog item classifies cleanly into a known realm and category with zero drops', () => {
  const counts = realmCounts(items, shopCategories);
  assert.equal(counts.shop + counts.neutral + counts.archive, items.length);
  assert.ok(counts.shop >= 170, `Expected at least 170 shop items, got ${counts.shop}`);
  assert.ok(counts.neutral >= 40, `Expected at least 40 neutral items, got ${counts.neutral}`);
  for (const item of items) {
    const info = classifyItem(item, shopCategories);
    assert.ok(SHOP_REALMS.some(r => r.key === info.realm), item.id);
    assert.ok(CATEGORY_BY_KEY[info.category], `${item.id} -> ${info.category}`);
  }
  const shopGroups = groupItemsByCategory(items, shopCategories, 'shop');
  assert.equal(shopGroups.length, 11);
  for (const group of shopGroups) {
    assert.ok(group.items.length >= 8, `Expected populated shop column for ${group.category.key}`);
  }
});

test('key Dota 2 items land in their exact official shop columns and Roshan drops land in roshan_map', () => {
  const byEn = name => items.find(i => i.en === name);
  assert.equal(classifyItem(byEn('Tango'), shopCategories).category, 'consumables');
  assert.equal(classifyItem(byEn('Iron Branch'), shopCategories).category, 'attributes');
  assert.equal(classifyItem(byEn('Black King Bar'), shopCategories).category, 'armor');
  assert.equal(classifyItem(byEn("Shiva's Guard"), shopCategories).category, 'armor');
  assert.equal(classifyItem(byEn('Vanguard'), shopCategories).category, 'armor');
  assert.equal(classifyItem(byEn('Divine Rapier'), shopCategories).category, 'weapons');
  assert.equal(classifyItem(byEn('Aegis of the Immortal'), shopCategories).category, 'roshan_map');
  assert.equal(classifyItem(byEn('Cheese'), shopCategories).category, 'roshan_map');
});

test('ranked shop search matches exact aliases, Chinese nicknames, and official category names', () => {
  const bkb = searchShopItems(items, 'bkb', shopCategories);
  assert.equal(bkb[0].en, 'Black King Bar');

  const blink = searchShopItems(items, '跳刀', shopCategories);
  assert.equal(blink[0].en, 'Blink Dagger');

  const shiva = searchShopItems(items, '冰甲', shopCategories);
  assert.equal(shiva[0].en, "Shiva's Guard");

  const armor = searchShopItems(items, '防具', shopCategories);
  assert.ok(armor.length >= 15);
  assert.ok(armor.some(i => i.en === 'Black King Bar'));

  const ac = searchShopItems(items, 'ac', shopCategories);
  assert.equal(ac[0].en, 'Assault Cuirass');

  assert.equal(isActiveItem(bkb[0]), true);
});

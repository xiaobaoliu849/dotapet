import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SHOP_REALMS, SHOP_CATEGORIES, CATEGORY_BY_KEY,
  classifyItem, realmCounts, groupItemsByCategory, searchShopItems, isActiveItem,
} from '../src/learning/itemShop.js';
import { resolveItemDetails } from '../src/learning/itemDetails.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
const shopCategories = JSON.parse(fs.readFileSync(new URL('../src/learning/item-shop-categories.json', import.meta.url)));
const itemDetails = JSON.parse(fs.readFileSync(new URL('../src/learning/item-details.json', import.meta.url)));
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
  // Patch 7.42: 4 Neutral Tiers (0/15/30/50m) + Neutral Enchantments
  assert.equal(neutralCats.length, 5);
  assert.deepEqual(neutralCats.map(c => c.key), ['tier1', 'tier2', 'tier3', 'tier4', 'enchantments']);
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

test('key Dota 2 items land in their exact official shop columns, Patch 7.42 neutral tiers, and Roshan drops', () => {
  const byEn = name => items.find(i => i.en === name);
  assert.equal(classifyItem(byEn('Tango'), shopCategories).category, 'consumables');
  assert.equal(classifyItem(byEn('Iron Branch'), shopCategories).category, 'attributes');
  assert.equal(classifyItem(byEn('Black King Bar'), shopCategories).category, 'armor');
  assert.equal(classifyItem(byEn("Shiva's Guard"), shopCategories).category, 'armor');
  assert.equal(classifyItem(byEn('Vanguard'), shopCategories).category, 'armor');
  assert.equal(classifyItem(byEn('Divine Rapier'), shopCategories).category, 'weapons');
  assert.equal(classifyItem(byEn('Aegis of the Immortal'), shopCategories).category, 'roshan_map');
  assert.equal(classifyItem(byEn('Cheese'), shopCategories).category, 'roshan_map');
  // Patch 7.42 Neutral Tiers 1-4 & Enchantments (Tier 5 merged into Tier 4)
  assert.equal(classifyItem(byEn('Chipped Vest'), shopCategories).category, 'tier1');
  assert.equal(classifyItem(byEn('Safety Bubble'), shopCategories).category, 'tier2');
  assert.equal(classifyItem(byEn('Stormcrafter'), shopCategories).category, 'tier3');
  assert.equal(classifyItem(byEn('Fallen Sky'), shopCategories).category, 'tier4');
  assert.equal(classifyItem(byEn('Book of the Dead'), shopCategories).category, 'tier4');
  assert.equal(classifyItem(byEn('Minotaur Horn'), shopCategories).category, 'tier4');
  assert.equal(classifyItem(byEn("Giant's Ring"), shopCategories).category, 'tier4');
  assert.equal(classifyItem(byEn('Divine Regalia'), shopCategories).category, 'tier4');
  assert.equal(classifyItem(byEn('Evolved'), shopCategories).category, 'enchantments');
  // Cycled-out neutral items live in archive
  assert.equal(classifyItem(byEn('Stygian Desolator'), shopCategories).category, 'enchantments_legacy');
  assert.equal(classifyItem(byEn('Spider Legs'), shopCategories).category, 'enchantments_legacy');
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

test('every Shop and Neutral item has rich stats, description, notes or lore with zero unresolved tokens', () => {
  const cloak = items.find(i => i.id === 'item:31');
  const cloakDetails = resolveItemDetails(cloak, itemDetails);
  assert.ok(cloakDetails.stats.some(s => s.en === 'Magic Resistance' && s.value.includes('%')));
  assert.ok(cloakDetails.loreEn.length > 10 && cloakDetails.loreZh.length > 5);
  assert.ok(cloakDetails.notesEn.length >= 1 && cloakDetails.notesZh.length >= 1);

  const evolved = items.find(i => i.id === 'item:1596');
  const evolvedDetails = resolveItemDetails(evolved, itemDetails);
  assert.ok(evolvedDetails.stats.some(s => s.en === 'Primary Attribute'));
  assert.ok(evolvedDetails.notesEn.every(n => !/%[\w]+%/.test(n)));
  assert.ok(evolvedDetails.notesZh.every(n => !/%[\w]+%/.test(n)));

  for (const item of items) {
    const info = classifyItem(item, shopCategories);
    const d = resolveItemDetails(item, itemDetails);
    for (const st of d.stats) {
      assert.ok(!st.en.includes('$') && !st.zh.includes('$'), `${item.id} unresolved stat token: ${st.en}`);
    }
    if (info.realm === 'shop' || info.realm === 'neutral') {
      const hasContent = Boolean(item.descriptionEn?.trim() || d.stats.length || d.notesEn.length || d.loreEn);
      assert.ok(hasContent, `Active ${info.realm} item has blank details: ${item.id} ${item.en}`);
    }
  }
});

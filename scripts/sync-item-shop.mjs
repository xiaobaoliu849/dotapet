import fs from 'node:fs';
import { createHash } from 'node:crypto';

const SHOP_URL = 'https://www.dota2.com.cn/itemscategory/json';
const VALVE_ITEM_DATA_URL = 'https://www.dota2.com/datafeed/itemdata?language=english&item_id=';

const CATEGORY_MAP = {
  basic: {
    '消耗品': 'consumables',
    '属性': 'attributes',
    '装备': 'equipment',
    '其它': 'miscellaneous',
    '其他': 'miscellaneous',
    '神秘商店': 'secret',
  },
  upgrade: {
    '配件': 'accessories',
    '辅助': 'support',
    '法器': 'magical',
    '防具': 'armor',
    '兵刃': 'weapons',
    '宝物': 'artifacts',
  },
};

// Official Patch 7.42 active Neutral Enchantments (Tiers 1–4, per Valve 7.42 patch notes).
const ACTIVE_ENCHANTMENT_IDS = [
  1865, // Vital (Tier 1-2)
  1577, // Quickened (Tier 1-3)
  1584, // Alert (Tier 1-3)
  1585, // Brawny (Tier 1-3)
  1583, // Mystical (Tier 1-3)
  1586, // Tough (Tier 1-3)
  1589, // Crude (Tier 2-3)
  1595, // Keen-eyed (Tier 2-3)
  1874, // Nimble (Tier 2-3)
  1597, // Titanic (Tier 2-3)
  1593, // Greedy (Tier 3)
  1596, // Evolved (Tier 4)
  1592, // Timeless (Tier 4)
  1588, // Fleetfooted (Tier 4)
  1594, // Vampiric (Tier 4)
  1866, // Hulking (Tier 4)
  1581, // Audacious (Tier 4)
  1587, // Feverish (Tier 4)
  1867, // Manic (Tier 4)
];

const response = await fetch(SHOP_URL, { signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error(`Official shop category source HTTP ${response.status}`);
const body = await response.text();
const sha256 = createHash('sha256').update(body).digest('hex');
const json = JSON.parse(body);
if (json.status !== 'success' || !json.result) throw new Error('Official shop category source returned an unexpected payload');

const entries = {};

// 1. Official Shop Basics (5 columns) and Upgrades (6 columns)
for (const section of ['basic', 'upgrade']) {
  const groups = Array.isArray(json.result[section]) ? json.result[section] : [];
  for (const group of groups) {
    const categoryKey = CATEGORY_MAP[section]?.[group.name];
    if (!categoryKey) throw new Error(`Unmapped official shop category: ${section} / ${group.name}`);
    const items = [...(group.items || [])].sort((a, b) => {
      const sa = Number(a.sort_value ?? 0);
      const sb = Number(b.sort_value ?? 0);
      if (sa !== sb) return sa - sb;
      return Number(a.cost ?? 0) - Number(b.cost ?? 0);
    });
    items.forEach((item, index) => {
      const numericId = Number(item.item_id);
      if (!Number.isInteger(numericId) || numericId <= 0) return;
      const id = `item:${numericId}`;
      entries[id] = {
        realm: 'shop',
        shelf: section,
        category: categoryKey,
        order: index,
        sortValue: Number(item.sort_value ?? index),
        shopCost: Number(item.cost ?? 0),
        internalName: item.name ? `item_${item.name}` : '',
        zh: item.name_loc || '',
      };
    });
  }
}

// 2. Official Neutral Item Tiers directly from Valve's live datafeed/itemdata (`item_neutral_tier`: 0..3 => Tier 1..4 in Patch 7.42)
const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url), 'utf8'));
const catalogItems = catalog.lessons.filter(l => l.kind === 'item');
const tierOrder = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
let neutralCount = 0;

const batchSize = 18;
for (let i = 0; i < catalogItems.length; i += batchSize) {
  const chunk = catalogItems.slice(i, i + batchSize);
  const fetched = await Promise.all(chunk.map(async item => {
    const numericId = Number(item.id.split(':')[1]);
    if (!Number.isInteger(numericId)) return null;
    const res = await fetch(`${VALVE_ITEM_DATA_URL}${numericId}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Valve itemdata HTTP ${res.status} for ${item.id}`);
    const data = await res.json();
    const rec = data.result?.data?.items?.[0];
    return { item, rec };
  }));
  for (const row of fetched) {
    if (!row?.rec) continue;
    const rawTier = row.rec.item_neutral_tier;
    if (Number.isInteger(rawTier) && rawTier >= 0 && rawTier <= 3) {
      const cat = `tier${rawTier + 1}`;
      entries[row.item.id] = {
        realm: 'neutral',
        shelf: 'neutral',
        category: cat,
        order: tierOrder[cat]++,
        sortValue: rawTier,
        shopCost: 0,
        internalName: row.rec.name || row.item.internalName || '',
        zh: row.item.zh || '',
      };
      neutralCount++;
    }
  }
}

// 3. Official Patch 7.42 active Neutral Enchantments
ACTIVE_ENCHANTMENT_IDS.forEach((numericId, index) => {
  const id = `item:${numericId}`;
  const item = catalogItems.find(l => l.id === id);
  if (!item) return;
  entries[id] = {
    realm: 'neutral',
    shelf: 'neutral',
    category: 'enchantments',
    order: index,
    sortValue: index,
    shopCost: 0,
    internalName: item.internalName || '',
    zh: item.zh || '',
  };
});

const count = Object.keys(entries).length;
const manifest = {
  schema: 1,
  patchNote: 'Shop categories from dota2.com.cn; Neutral Tiers 1-4 and Enchantments synced to Valve live item_neutral_tier (Patch 7.42).',
  fetchedAt: new Date().toISOString(),
  sourceUrl: SHOP_URL,
  valveNeutralSourceUrl: VALVE_ITEM_DATA_URL,
  sha256,
  count,
  neutralArtifactCount: neutralCount,
  neutralEnchantmentCount: ACTIVE_ENCHANTMENT_IDS.length,
  entries,
};

const outUrl = new URL('../src/learning/item-shop-categories.json', import.meta.url);
fs.writeFileSync(outUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Synced ${count} entries (${neutralCount} Valve live neutral artifacts across Tiers 1-4 + ${ACTIVE_ENCHANTMENT_IDS.length} active enchantments)`);

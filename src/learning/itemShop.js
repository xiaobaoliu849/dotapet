import { itemAliases } from './itemCoaching.js';

export const SHOP_REALMS = [
  { key: 'shop', en: 'Shop', zh: '商店物品', icon: 'store' },
  { key: 'neutral', en: 'Neutral', zh: '中立物品', icon: 'neutral' },
  { key: 'archive', en: 'Special & Archive', zh: '肉山与历史', icon: 'archive' },
];

export const SHOP_SHELVES = {
  basic: { key: 'basic', realm: 'shop', en: 'Basics', zh: '基础分类', accent: '#6b8e4e' },
  upgrade: { key: 'upgrade', realm: 'shop', en: 'Upgrades', zh: '合成分类', accent: '#416338' },
  neutral: { key: 'neutral', realm: 'neutral', en: 'Neutral Tiers', zh: '中立物品等级', accent: '#3b6e8c' },
  archive: { key: 'archive', realm: 'archive', en: 'Special & Archive', zh: '肉山、变体与历史', accent: '#7c6a4a' },
};

export const SHOP_CATEGORIES = [
  // Basics (5 official Dota 2 columns)
  { key: 'consumables', realm: 'shop', shelf: 'basic', en: 'Consumables', zh: '消耗品', accent: '#2f855a', tint: '#edf7f0', icon: 'consumables' },
  { key: 'attributes', realm: 'shop', shelf: 'basic', en: 'Attributes', zh: '属性', accent: '#b7791f', tint: '#fcf6e8', icon: 'attributes' },
  { key: 'equipment', realm: 'shop', shelf: 'basic', en: 'Equipment', zh: '装备', accent: '#b84a39', tint: '#fbf0ee', icon: 'equipment' },
  { key: 'miscellaneous', realm: 'shop', shelf: 'basic', en: 'Misc', zh: '其它', accent: '#3b6e9c', tint: '#eef5fb', icon: 'miscellaneous' },
  { key: 'secret', realm: 'shop', shelf: 'basic', en: 'Secret', zh: '神秘商店', accent: '#7b52ab', tint: '#f5effb', icon: 'secret' },
  // Upgrades (6 official Dota 2 columns)
  { key: 'accessories', realm: 'shop', shelf: 'upgrade', en: 'Accessories', zh: '配件', accent: '#3d8b52', tint: '#edf7ef', icon: 'accessories' },
  { key: 'support', realm: 'shop', shelf: 'upgrade', en: 'Support', zh: '辅助', accent: '#2b7a78', tint: '#eaf6f5', icon: 'support' },
  { key: 'magical', realm: 'shop', shelf: 'upgrade', en: 'Magical', zh: '法器', accent: '#3165b5', tint: '#edf3fc', icon: 'magical' },
  { key: 'armor', realm: 'shop', shelf: 'upgrade', en: 'Armor', zh: '防具', accent: '#7c4da8', tint: '#f5effa', icon: 'armor' },
  { key: 'weapons', realm: 'shop', shelf: 'upgrade', en: 'Weapons', zh: '兵刃', accent: '#b53d3d', tint: '#fbeeee', icon: 'weapons' },
  { key: 'artifacts', realm: 'shop', shelf: 'upgrade', en: 'Artifacts', zh: '宝物', accent: '#b37414', tint: '#fcf5e6', icon: 'artifacts' },
  // Neutral Tiers (5 official Dota 2 tiers)
  { key: 'tier1', realm: 'neutral', shelf: 'neutral', en: 'Tier 1', zh: '第 1 级', hintEn: '0m+', hintZh: '开局起', accent: '#607063', tint: '#f1f4ef', icon: 'tier' },
  { key: 'tier2', realm: 'neutral', shelf: 'neutral', en: 'Tier 2', zh: '第 2 级', hintEn: '15m+', hintZh: '15 分钟', accent: '#2e7d47', tint: '#edf7ef', icon: 'tier' },
  { key: 'tier3', realm: 'neutral', shelf: 'neutral', en: 'Tier 3', zh: '第 3 级', hintEn: '25m+', hintZh: '25 分钟', accent: '#2b6cb0', tint: '#edf4fc', icon: 'tier' },
  { key: 'tier4', realm: 'neutral', shelf: 'neutral', en: 'Tier 4', zh: '第 4 级', hintEn: '35m+', hintZh: '35 分钟', accent: '#7c4da8', tint: '#f5effa', icon: 'tier' },
  { key: 'tier5', realm: 'neutral', shelf: 'neutral', en: 'Tier 5', zh: '第 5 级', hintEn: '60m+', hintZh: '60 分钟', accent: '#b7791f', tint: '#fcf5e6', icon: 'tier' },
  // Special & Archive (Roshan/Map drops, Upgrade variants, Neutral enchantments & Legacy)
  { key: 'roshan_map', realm: 'archive', shelf: 'archive', en: 'Roshan & Map', zh: '肉山与地图掉落', accent: '#b7791f', tint: '#fcf6e8', icon: 'roshan' },
  { key: 'variants', realm: 'archive', shelf: 'archive', en: 'Upgrade Variants', zh: '多级与进阶变体', accent: '#3b6e9c', tint: '#eef5fb', icon: 'variants' },
  { key: 'enchantments_legacy', realm: 'archive', shelf: 'archive', en: 'Enchantments & Legacy', zh: '附魔与历史物品', accent: '#6b7567', tint: '#f2f4ef', icon: 'archive' },
];

export const CATEGORY_BY_KEY = Object.fromEntries(SHOP_CATEGORIES.map(c => [c.key, c]));

const ROSHAN_MAP_IDS = new Set([
  'item:117',  // Aegis of the Immortal
  'item:33',   // Cheese
  'item:1154', // Block of Cheese
  'item:260',  // Refresher Shard
  'item:1804', // Roshan's Banner
  'item:727',  // Aghanim's Blessing - Roshan
  'item:4204', // Healing Lotus
  'item:4205', // Great Healing Lotus
  'item:4206', // Greater Healing Lotus
  'item:1609', // Madstone Bundle
  'item:1652', // Bag of Gold
  'item:218',  // Observer and Sentry Wards
  'item:241',  // Tango (Shared)
  'item:45',   // Animal Courier
  'item:286',  // Flying Courier
]);

const VARIANT_ITEM_IDS = new Set([
  'item:220',  // Boots of Travel 2
  'item:201',  // Dagon 2
  'item:202',  // Dagon 3
  'item:203',  // Dagon 4
  'item:204',  // Dagon 5
  'item:271',  // Aghanim's Blessing
  'item:725',  // Aghanim's Shard - Consumable
  'item:692',  // Eternal Shroud
]);

export function isActiveItem(item) {
  const cds = item.mechanics?.cooldowns?.some(n => n > 0);
  const manas = item.mechanics?.mana_costs?.some(n => n > 0);
  const desc = `${item.descriptionEn || ''} ${item.descriptionZh || ''}`;
  return Boolean(cds || manas || /\bActive:|主动[:：]/i.test(desc));
}

export function classifyItem(item, shopCategories = null) {
  const entry = shopCategories?.entries?.[item.id];
  if (entry && CATEGORY_BY_KEY[entry.category]) {
    return {
      realm: entry.realm,
      shelf: entry.shelf,
      category: entry.category,
      order: Number.isFinite(entry.order) ? entry.order : 999,
      official: true,
    };
  }
  if (ROSHAN_MAP_IDS.has(item.id)) {
    return { realm: 'archive', shelf: 'archive', category: 'roshan_map', order: [...ROSHAN_MAP_IDS].indexOf(item.id), official: false };
  }
  if (VARIANT_ITEM_IDS.has(item.id)) {
    return { realm: 'archive', shelf: 'archive', category: 'variants', order: [...VARIANT_ITEM_IDS].indexOf(item.id), official: false };
  }
  return {
    realm: 'archive',
    shelf: 'archive',
    category: 'enchantments_legacy',
    order: item.mechanics?.item_cost ? 1000 + item.mechanics.item_cost : 5000,
    official: false,
  };
}

export function realmCounts(items, shopCategories = null) {
  const counts = { shop: 0, neutral: 0, archive: 0 };
  for (const item of items) {
    const info = classifyItem(item, shopCategories);
    counts[info.realm] = (counts[info.realm] || 0) + 1;
  }
  return counts;
}

export function groupItemsByCategory(items, shopCategories = null, realm = 'shop') {
  const categories = SHOP_CATEGORIES.filter(cat => cat.realm === realm);
  const buckets = new Map(categories.map(cat => [cat.key, []]));
  for (const item of items) {
    const info = classifyItem(item, shopCategories);
    if (info.realm !== realm) continue;
    const bucket = buckets.get(info.category);
    if (bucket) bucket.push({ item, info });
  }
  return categories.map(category => {
    const entries = buckets.get(category.key) || [];
    entries.sort((a, b) => {
      if (realm === 'shop') {
        const ca = a.item.mechanics?.item_cost || 0;
        const cb = b.item.mechanics?.item_cost || 0;
        if (ca !== cb) return ca - cb;
      }
      if (a.info.order !== b.info.order) return a.info.order - b.info.order;
      const ca = a.item.mechanics?.item_cost || 0;
      const cb = b.item.mechanics?.item_cost || 0;
      if (ca !== cb) return ca - cb;
      return (a.item.en || '').localeCompare(b.item.en || '');
    });
    return { category, items: entries.map(e => e.item) };
  });
}

const REALM_RANK = { shop: 0, neutral: 1, archive: 2 };

export function searchShopItems(items, query, shopCategories = null) {
  const q = String(query || '').trim().toLocaleLowerCase();
  if (!q) return items;
  const scored = [];
  for (const item of items) {
    const en = (item.en || '').toLocaleLowerCase();
    const zh = (item.zh || '').toLocaleLowerCase();
    const aliases = itemAliases(item).map(a => a.toLocaleLowerCase());
    const info = classifyItem(item, shopCategories);
    const cat = CATEGORY_BY_KEY[info.category];
    const catTerms = cat ? [cat.en, cat.zh, cat.key, cat.realm].map(s => s.toLocaleLowerCase()) : [];
    const descEn = (item.descriptionEn || '').toLocaleLowerCase();
    const descZh = (item.descriptionZh || '').toLocaleLowerCase();

    let score = 0;
    if (en === q || zh === q || aliases.includes(q)) score = 100;
    else if (en.startsWith(q) || zh.startsWith(q) || aliases.some(a => a.startsWith(q))) score = 80;
    else if (en.includes(q) || zh.includes(q) || aliases.some(a => a.includes(q))) score = 60;
    else if (catTerms.some(t => t.includes(q))) score = 40;
    else if (descEn.includes(q) || descZh.includes(q)) score = 20;

    if (score > 0) scored.push({ item, info, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = REALM_RANK[a.info.realm] ?? 9;
    const rb = REALM_RANK[b.info.realm] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.info.order !== b.info.order) return a.info.order - b.info.order;
    return (a.item.en || '').localeCompare(b.item.en || '');
  });
  return scored.map(row => row.item);
}

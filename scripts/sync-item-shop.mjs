import fs from 'node:fs';
import { createHash } from 'node:crypto';

const SHOP_URL = 'https://www.dota2.com.cn/itemscategory/json';

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
  neutral: {
    '第1级': 'tier1',
    '第2级': 'tier2',
    '第3级': 'tier3',
    '第4级': 'tier4',
    '第5级': 'tier5',
  },
};

const response = await fetch(SHOP_URL, { signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error(`Official shop category source HTTP ${response.status}`);
const body = await response.text();
const sha256 = createHash('sha256').update(body).digest('hex');
const json = JSON.parse(body);
if (json.status !== 'success' || !json.result) throw new Error('Official shop category source returned an unexpected payload');

const entries = {};
let count = 0;

for (const section of ['basic', 'upgrade', 'neutral']) {
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
        realm: section === 'neutral' ? 'neutral' : 'shop',
        shelf: section,
        category: categoryKey,
        order: index,
        sortValue: Number(item.sort_value ?? index),
        shopCost: Number(item.cost ?? 0),
        internalName: item.name ? `item_${item.name}` : '',
        zh: item.name_loc || '',
      };
      count++;
    });
  }
}

const manifest = {
  schema: 1,
  fetchedAt: new Date().toISOString(),
  sourceUrl: SHOP_URL,
  sha256,
  count,
  entries,
};

const outUrl = new URL('../src/learning/item-shop-categories.json', import.meta.url);
fs.writeFileSync(outUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Synced ${count} official Dota 2 shop/neutral item category entries to src/learning/item-shop-categories.json`);

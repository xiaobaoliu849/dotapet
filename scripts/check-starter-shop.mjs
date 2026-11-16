import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { STARTER_ITEMS } from '../src/learning/starterPath.js';

const shopURL = 'https://www.dota2.com.cn/itemscategory/json';
const valveURL = 'https://www.dota2.com/datafeed/itemlist?language=english';
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Official source HTTP ${response.status}`);
  const body = await response.text();
  return { data: JSON.parse(body), sha256: createHash('sha256').update(body).digest('hex') };
}
const [shop, valve] = await Promise.all([get(shopURL), get(valveURL)]);
if (shop.data.status !== 'success') throw new Error('Official shop category source unavailable');
const rows = [];
function collect(value, trail = []) {
  if (Array.isArray(value)) { for (const row of value) collect(row, trail); return; }
  if (!value || typeof value !== 'object') return;
  if (value.item_id) rows.push({ ...value, category: trail.join(' / ') });
  else for (const [key, child] of Object.entries(value)) collect(child, [...trail, key === 'items' ? '' : (child?.name || key)].filter(Boolean));
}
// Only ordinary shop categories count here; neutral and historical reference entries do not.
for (const key of ['basic', 'upgrade']) collect(shop.data.result[key], [key]);
const valveRows = valve.data.result?.data?.itemabilities;
if (!rows.length || !Array.isArray(valveRows)) throw new Error('Incomplete official sources');
const entries = {};
for (const [id, item] of Object.entries(STARTER_ITEMS)) {
  const numericId = Number(id.split(':')[1]);
  const category = rows.find(row => Number(row.item_id) === numericId);
  const official = valveRows.find(row => row.id === numericId);
  if (!category || !official || `item_${category.name}` !== item.internalName || official.name !== item.internalName) {
    throw new Error(`Starter item not verified in both official sources: ${id}`);
  }
  entries[id] = { internalName: item.internalName, en: official.name_loc, zh: category.name_loc,
    category: category.category, shopListed: true, valveListed: true, shopCost: Number(category.cost) };
}
const evidence = { schema: 1, checkedAt: new Date().toISOString(),
  sources: [{ url: shopURL, sha256: shop.sha256 }, { url: valveURL, sha256: valve.sha256 }],
  limitation: 'Listed in official shop categories and Valve feed at this time. Not independently checked in the running game client; source listings can lag gameplay updates.',
  gameClientChecked: false, entries };
fs.writeFileSync(new URL('../src/learning/starter-shop-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Verified ${Object.keys(entries).length} starter items in official shop categories and Valve feed.`);

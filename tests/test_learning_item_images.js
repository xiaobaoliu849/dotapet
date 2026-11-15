import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemImageUrl, pairRecords } from '../src/learning/model.js';

test('itemImageUrl builds official Steam CDN item image URL from internal name', () => {
  assert.equal(
    itemImageUrl({ name: 'item_blink' }),
    'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/blink.png',
  );
  assert.equal(itemImageUrl({}), '');
});

test('pairRecords attaches imageUrl to item lessons', () => {
  const [lesson] = pairRecords(
    [{ id: 1, name: 'item_blink', name_loc: 'Blink Dagger', desc_loc: 'Blink', item_cost: 2250 }],
    [{ id: 1, name: 'item_blink', name_loc: '闪烁匕首', desc_loc: '闪烁' }],
    'item',
  );
  assert.equal(lesson.imageUrl, 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/blink.png');
});

test('all item lessons in catalog.json have official Steam CDN imageUrl', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url), 'utf8'));
  const items = catalog.lessons.filter(l => l.kind === 'item');
  assert.equal(items.length > 0, true);
  for (const item of items) {
    assert.match(
      item.imageUrl || '',
      /^https:\/\/cdn\.cloudflare\.steamstatic\.com\/apps\/dota2\/images\/dota_react\/items\/[a-z0-9_]+\.png$/,
      `Missing or invalid imageUrl for ${item.id} (${item.en})`,
    );
  }
});

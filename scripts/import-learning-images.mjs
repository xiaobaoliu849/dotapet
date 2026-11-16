import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ITEM_IMAGE_BASE, itemImageSlug } from '../src/learning/itemImages.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'src/renderer/assets/learning-items');
const manifestFile = path.join(root, 'src/learning/item-images.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const items = read(path.join(root, 'src/learning/catalog.json')).lessons.filter(row => row.kind === 'item');
const png = buffer => buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0;
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

if (process.argv.includes('--verify')) {
  const manifest = read(manifestFile);
  for (const item of items) {
    const entry = manifest.entries[item.id];
    if (!entry) {
      if (!manifest.missing.some(row => row.id === item.id)) throw new Error(`Unaccounted item: ${item.id}`);
      continue;
    }
    if (!/^\d+\.png$/.test(entry.file)) throw new Error(`Unsafe image path: ${item.id}`);
    const buffer = fs.readFileSync(path.join(output, entry.file));
    if (!png(buffer) || hash(buffer) !== entry.sha256) throw new Error(`Invalid image: ${item.id}`);
  }
  console.log(`Verified ${Object.keys(manifest.entries).length} bundled item PNGs; ${manifest.missing.length} explicit artwork gaps.`);
  process.exit(0);
}

const reference = path.resolve(process.argv[2] || 'D:/Projects/dota-2-bilingual-lexicon');
const archived = read(path.join(reference, 'data/official/items_official.json')).items;
const slugs = new Map(archived.map(row => [`item:${row.id}`, itemImageSlug(row.internal_name)]));
// Read public data only; do not import executable code or personal settings from the reference project.
const response = await fetch('https://www.dota2.com/datafeed/itemlist?language=english', { signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error(`Valve item list HTTP ${response.status}`);
const list = (await response.json()).result?.data?.itemabilities;
if (!Array.isArray(list) || list.length < 100) throw new Error('Incomplete Valve item list');
for (const row of list) slugs.set(`item:${row.id}`, itemImageSlug(row.name));
fs.mkdirSync(output, { recursive: true });
const entries = {}, missing = [];
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < items.length) {
    const item = items[cursor++], slug = slugs.get(item.id);
    if (!slug) { missing.push({ id: item.id, name: item.en, reason: 'No official internal name' }); continue; }
    const source = `${ITEM_IMAGE_BASE}${slug}.png`, file = item.id.split(':')[1] + '.png';
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const image = await fetch(source, { signal: AbortSignal.timeout(15000) });
        if (!image.ok) throw new Error(`HTTP ${image.status}`);
        const buffer = Buffer.from(await image.arrayBuffer());
        if (!png(buffer)) throw new Error('Not a valid PNG');
        fs.writeFileSync(path.join(output, file), buffer);
        entries[item.id] = { name: item.en, slug, file, source, sha256: hash(buffer) };
        failure = null;
        break;
      } catch (error) { failure = error; }
    }
    if (failure) missing.push({ id: item.id, name: item.en, slug, reason: failure.message });
  }
}));
const manifest = { schema: 1, fetchedAt: new Date().toISOString(), source: 'Valve Steam CDN; internal names from Valve itemlist and local bilingual lexicon official export',
  entries: Object.fromEntries(Object.entries(entries).sort()), missing: missing.sort((a, b) => a.id.localeCompare(b.id)) };
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Bundled ${Object.keys(entries).length}/${items.length} item images. Missing: ${JSON.stringify(missing)}`);

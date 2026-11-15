import fs from 'node:fs';
import { fetchCatalog } from '../src/learning/update.js';
const target = new URL('../src/learning/catalog.json', import.meta.url);
const old = JSON.parse(fs.readFileSync(target, 'utf8'));
const catalog = await fetchCatalog({ onProgress: ({ done, total }) => { if (done % 40 === 0 || done === total) console.log(`Dota learning: ${done}/${total}`); } });
catalog.lessons.push(...old.lessons.filter(r => r.kind === 'phrase'));
fs.writeFileSync(new URL('../src/learning/catalog.json.tmp', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
fs.renameSync(new URL('../src/learning/catalog.json.tmp', import.meta.url), target);
console.log(`Saved ${catalog.lessons.length} lessons; fetched ${catalog.fetchedAt}. Patch version unverified; see official patch notes.`);

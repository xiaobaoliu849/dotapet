import fs from 'node:fs';
import { fetchCatalog } from '../src/learning/update.js';
import { diffCatalog } from '../src/learning/contentAudit.js';
import { buildPatchChangesManifest } from '../src/learning/patchChanges.js';
const target = new URL('../src/learning/catalog.json', import.meta.url);
const old = JSON.parse(fs.readFileSync(target, 'utf8'));
const shopCategories = JSON.parse(fs.readFileSync(new URL('../src/learning/item-shop-categories.json', import.meta.url), 'utf8'));
const catalog = await fetchCatalog({ onProgress: ({ done, total }) => { if (done % 40 === 0 || done === total) console.log(`Dota learning: ${done}/${total}`); } });
catalog.lessons.push(...old.lessons.filter(r => r.kind === 'phrase'));
const diff = diffCatalog(old, catalog);
fs.mkdirSync(new URL('../docs/audits/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../docs/audits/last-refresh-before.json', import.meta.url), JSON.stringify(old, null, 2) + '\n');
fs.writeFileSync(new URL('../docs/audits/last-refresh-changes.json', import.meta.url), JSON.stringify(diff, null, 2) + '\n');
if (diff.changes.length) {
  const manifest = buildPatchChangesManifest({
    diff,
    beforeCatalog: old,
    afterCatalog: catalog,
    shopCategories,
    patch: catalog.patch,
    previousPatch: old.patch && old.patch !== catalog.patch ? old.patch : null,
    releasedAt: catalog.patchDate || null,
  });
  fs.writeFileSync(new URL('../src/learning/patch-changes.json.tmp', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
  fs.renameSync(new URL('../src/learning/patch-changes.json.tmp', import.meta.url), new URL('../src/learning/patch-changes.json', import.meta.url));
}
fs.writeFileSync(new URL('../src/learning/catalog.json.tmp', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
fs.renameSync(new URL('../src/learning/catalog.json.tmp', import.meta.url), target);
console.log(`Saved ${catalog.lessons.length} lessons; fetched ${catalog.fetchedAt}. ${catalog.patch ? `Verified Patch ${catalog.patch}.` : 'Patch version unverified; see official patch notes.'}`);

import fs from 'node:fs';
import { buildPatchChangesManifest } from '../src/learning/patchChanges.js';

const readJson = rel => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
const diff = readJson('../docs/audits/last-refresh-changes.json');
const beforeCatalog = readJson('../docs/audits/last-refresh-before.json');
const afterCatalog = readJson('../src/learning/catalog.json');
const shopCategories = readJson('../src/learning/item-shop-categories.json');
const announcement = readJson('../docs/audits/official-announcement-check.json');

const latestPatch = afterCatalog.patch || announcement?.latestPatchListEntry?.patchNumber || null;
if (latestPatch && beforeCatalog.patch === latestPatch) {
  throw new Error('Patch comparison needs a catalog from before the release. The last refresh used the same verified patch.');
}
const previousGameplay = (announcement?.headlines || [])
  .map(h => h.title?.match(/\b(\d+\.\d+[a-z]?)\b/i)?.[1])
  .find(v => v && v !== latestPatch) || null;
const releasedAt = afterCatalog.patchDate
  || announcement?.latestGameplayAnnouncement?.publishedAt
  || announcement?.latestPatchListEntry?.publishedAt
  || null;

const manifest = buildPatchChangesManifest({
  diff,
  beforeCatalog,
  afterCatalog,
  shopCategories,
  patch: latestPatch,
  previousPatch: previousGameplay,
  releasedAt,
});

const target = new URL('../src/learning/patch-changes.json', import.meta.url);
fs.writeFileSync(new URL('../src/learning/patch-changes.json.tmp', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
fs.renameSync(new URL('../src/learning/patch-changes.json.tmp', import.meta.url), target);

console.log(`Built patch-changes.json for Patch ${manifest.patch} (vs ${manifest.previousPatch || 'previous'}):`, manifest.counts);

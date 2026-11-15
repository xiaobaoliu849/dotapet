import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cleanText, balanceFacts } from '../src/learning/model.js';
const reference = path.resolve(process.argv[2] || 'D:/Projects/dota-2-bilingual-lexicon');
const read = file => JSON.parse(fs.readFileSync(path.join(reference, file), 'utf8'));
const heroes = read('data/official/heroes_official_v2.json'), items = read('data/official/items_official.json');
const manifest = JSON.parse(fs.readFileSync(new URL('../src/learning/audio-manifest.json', import.meta.url)));
const old = new Map(), itemScripts = new Map();
// Extract literal string fields only. Never execute the reference project's TypeScript.
const ts = fs.readFileSync(path.join(reference, 'data/items.ts'), 'utf8');
for (const block of ts.match(/\{[^{}]*\}/g) || []) {
  const literal = name => {
    const match = block.match(new RegExp('\\b' + name + ':\\s*("(?:[^"\\\\]|\\\\.)*")'));
    return match ? JSON.parse(match[1]) : '';
  };
  const name = literal('name_en');
  if (name) itemScripts.set(name, literal('description_tts_en') || literal('description_en'));
}
function remember(record, kind, parent = '') {
  const id = `${kind}:${record.id}`;
  const descriptionEn = cleanText(record.description_en || record.hype_en);
  let candidateSpeech = kind === 'hero' ? cleanText(record.bio_tts_en || record.bio_en)
    : `${record.name_en}. ${cleanText(kind === 'item' ? itemScripts.get(record.name_en) || record.description_tts_en || record.description_en : record.description_tts_en || record.description_en)}`;
  if (manifest.entries[id] && manifest.entries[id].name !== record.name_en) candidateSpeech = '';
  const audio = manifest.entries[id];
  old.set(id, { id, kind, parent, en: record.name_en, zh: record.name_cn, descriptionEn,
    descriptionZh: cleanText(record.description_cn || record.hype_cn),
    ...(kind === 'hero' ? { biographyEn: cleanText(record.bio_en), biographyZh: cleanText(record.bio_cn) } : { mechanics: balanceFacts(kind === 'item' ? { ...record, item_cost: record.cost } : record) }),
    candidateSpeech, evidence: kind === 'item' && itemScripts.has(record.name_en) ? 'Inferred from archived data/items.ts used by generation script' : 'Inferred from archived official export used by generation script',
    ...(audio ? { recordingSha256: createHash('sha256').update(fs.readFileSync(new URL('../src/renderer/assets/learning-audio/' + audio.file, import.meta.url))).digest('hex') } : {}) });
}
for (const hero of heroes.heroes) {
  remember(hero, 'hero');
  for (const ability of [...hero.abilities || [], ...hero.innate_abilities || []]) remember(ability, 'ability', `${hero.name_en} · ${hero.name_cn}`);
}
for (const item of items.items) remember(item, 'item');
const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
for (const phrase of catalog.lessons.filter(lesson => lesson.kind === 'phrase')) old.set(phrase.id, { ...phrase, candidateSpeech: phrase.en, evidence: 'Archived expression text; MP3 transcript unverified' });
const baseline = { schema: 1, source: 'Public archived official exports (March 29, 2026) and items.ts generation-input candidates', fetchedAt: heroes.sync_time, transcriptVerified: false, entries: Object.fromEntries(old) };
fs.writeFileSync(new URL('../src/learning/audio-baseline.json', import.meta.url), JSON.stringify(baseline, null, 2) + '\n');
console.log(`Saved ${old.size} baseline entries; ${itemScripts.size} item script candidates. No MP3 transcripts verified.`);

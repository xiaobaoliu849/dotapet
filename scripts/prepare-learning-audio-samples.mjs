import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe } from '../src/learning/model.js';
import { narrationText } from '../src/learning/contentAudit.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url)));
const queue = JSON.parse(fs.readFileSync(new URL('../docs/audits/audio-regeneration-queue.json', import.meta.url)));
const hash = text => createHash('sha256').update(text).digest('hex');
const selected = [
  ['ability:1447', 'Persecutor. Attacks slow enemies based on how much mana they are missing. The slow starts at sixty percent mana, and reaches its maximum at zero mana. It has no effect if the enemy is above sixty percent mana.', ['sixty percent', 'zero'], 'Preserves the current 60% threshold and 0% maximum-slow endpoint.'],
  ['ability:5022', "Marksmanship. Drow's experiences in battle grant her a chance to launch arrows with incredible accuracy and effectiveness. Pierces through the enemy's defenses, ignoring their base armor. This ability is disabled if there is an enemy hero within three hundred range.", ['three hundred'], 'Preserves the current 300 range disable threshold and base-armor wording.'],
  ['ability:5048', 'Sacred Arrow. Fires a long-range arrow with deadly precision, which stuns and damages the first enemy unit it strikes. The stun starts at zero point zero one seconds. Its maximum duration is two point three, three point two, four point one, or five seconds, at ability levels one through four, respectively. Up to one hundred and eighty bonus damage is added, based on the distance the arrow travels to its target. It instantly kills the first non-ancient creep that it hits.', ['zero point zero one', 'two point three', 'three point two', 'four point one', 'five', 'one hundred and eighty'], 'Expands the slash-separated maximum stun values into an explicit four-level list without changing the numbers.'],
  ['ability:5062', 'Necromastery. Shadow Fiend steals the soul from units he kills, gaining one bonus damage per soul. Hero kills grant four souls. On death, he releases thirty percent of them from bondage.', ['one', 'four', 'thirty percent'], 'Preserves 1 damage per soul, 4 souls per hero kill and the 30% loss on death.'],
  ['item:1097', "Disperser. Active: Suppress. Dispels both the wearer and the target. Enemy targets are slowed for four seconds. Allied targets gain bonus movement speed and forty percent slow resistance for four seconds. The caster always receives the ally benefit on cast. The movement speed reduction and increase both start at one hundred percent and gradually decrease to zero percent over the buff's duration. Dispel type: basic dispel. Passive: Mana Break. Each attack burns forty mana from the target, and deals one physical damage per mana burned. Illusions do not burn mana.", ['four seconds', 'forty percent', 'one hundred percent', 'zero percent', 'forty mana', 'one physical'], 'Preserves duration, slow resistance, ramp-down and the illusion exclusion; expands movespeed for clearer speech.'],
  ['item:119', "Shiva's Guard. Active: Arctic Blast. Emits a freezing wave that deals two hundred and twenty-five magical damage to enemies and reduces their movement speed by forty percent for four seconds. Radius: eight hundred and twenty-five. Passive: Freezing Aura. Reduces the attack speed of all enemies by forty. Aura radius: twelve hundred.", ['two hundred and twenty five', 'forty percent', 'four seconds', 'eight hundred and twenty five', 'forty', 'twelve hundred'], 'Reads negative reduction modifiers as reductions, preserving their magnitudes and the separate blast/aura radii.'],
  ['item:147', 'Manta Style. Active: Mirror Image. Creates two images of your hero that last eighteen seconds. Melee images deal thirty-three percent damage, while ranged images deal twenty-five percent. Illusions take three hundred percent damage. Dispel type: basic dispel.', ['two', 'eighteen seconds', 'thirty three percent', 'twenty five percent', 'three hundred percent'], 'Preserves image duration, separate melee/ranged outgoing damage and incoming illusion damage.'],
  ['item:121', "Bloodstone. Its active ability, Bloodpact, increases Bloodstone's spell lifesteal to sixty percent for five seconds. Its passive, Spell Weakness Aura, causes enemy units within twelve hundred range to take ten percent more damage from spells.", ['sixty percent', 'five seconds', 'ten percent', 'twelve hundred'], 'Preserves lifesteal as a total of 60%, not an additional 60%, and the 10% spell damage vulnerability.'],
];
async function data(endpoint, params = {}) {
  const url = new URL(endpoint, 'https://www.dota2.com/datafeed/');
  url.search = new URLSearchParams({ language: 'english', ...params });
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Valve HTTP ${response.status}`);
  const json = await response.json(); return { data: json.result.data, url: url.href };
}
const list = (await data('itemlist')).data.itemabilities;
const entries = [];
for (const [id, script, numberChecks, reviewNotes] of selected) {
  const lesson = catalog.lessons.find(row => row.id === id), candidate = queue.entries.find(row => row.id === id);
  if (!lesson || candidate?.reason !== 'baseline-changed') throw new Error(`Not an audited changed-source candidate: ${id}`);
  let record, source, availability;
  if (lesson.kind === 'item') {
    const result = await data('itemdata', { item_id: id.split(':')[1] }); source = result.url; record = result.data.items[0];
    const recommendation = list.find(row => row.id === record.id);
    if (!recommendation?.is_lategame_suggested || !(record.item_cost > 0)) throw new Error(`Item needs availability review: ${id}`);
    availability = { evidence: 'Listed as a late-game recommendation in the current official feed, with a positive item cost; not independently checked in the game client', itemCost: record.item_cost, lateGameSuggested: true };
  } else {
    const hero = catalog.lessons.find(row => row.kind === 'hero' && row.en === lesson.parent.split(' · ')[0]);
    const result = await data('herodata', { hero_id: hero.id.split(':')[1] }); source = result.url;
    record = result.data.heroes[0].abilities.find(row => row.id === Number(id.split(':')[1]));
  }
  if (!record || record.name_loc !== lesson.en || describe(record) !== lesson.descriptionEn) throw new Error(`Live source changed; refresh and re-audit before synthesis: ${id}`);
  const sourceText = narrationText(lesson, 'explanation');
  if (hash(sourceText) !== candidate.textSha256 || /%\w+%/.test(script)) throw new Error(`Invalid reviewed script: ${id}`);
  entries.push({ id, name: lesson.en, script, scriptSha256: hash(script), sourceText, sourceTextSha256: hash(sourceText),
    sourceUrl: source, sourceCheckedAt: new Date().toISOString(), catalogFetchedAt: catalog.fetchedAt,
    sourceReviewed: true, sourceReviewNotes: reviewNotes, numberChecks, ...(availability ? { itemAvailability: availability } : {}),
    listeningApproved: false, promoted: false });
}
const target = new URL('../docs/audio-samples/batch-plan.json', import.meta.url); fs.mkdirSync(new URL('./', target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ schema: 1, voice: 'en-US-JennyNeural', rate: '+0%', pitch: '+0Hz', volume: '+0%',
  purpose: 'Eight audition samples; do not replace bundled recordings before listening review', entries }, null, 2) + '\n');
console.log(`Prepared ${entries.length} source-reviewed scripts; no audio generated or replaced.`);

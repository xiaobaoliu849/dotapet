import { SPOKEN_PHRASES } from './spokenPhrases.js';

/** Require 3 consecutive correct recalls (7-day Leitner tier) before counting a lesson as mastered. */
export const MASTERY_BOX_THRESHOLD = 3;

export const MASTERY_PILLARS = [
  { key: 'hero', en: 'Heroes', zh: '英雄', icon: '🦸' },
  { key: 'ability', en: 'Hero Abilities', zh: '英雄技能', icon: '🔮' },
  { key: 'item', en: 'Items & Actives', zh: '物品技能', icon: '🛡️' },
  { key: 'phrase', en: 'English Phrases', zh: '实战口语', icon: '💬' },
];

export function summarizeMastery(lessons = [], progress = {}) {
  const groups = { hero: [], ability: [], item: [], phrase: [] };
  for (const lesson of lessons) {
    if (groups[lesson.kind]) groups[lesson.kind].push(lesson.id);
  }
  for (const phrase of SPOKEN_PHRASES) groups.phrase.push(phrase.id);

  return MASTERY_PILLARS.map((pillar) => {
    const ids = [...new Set(groups[pillar.key] || [])];
    let practiced = 0;
    let mastered = 0;
    let saved = 0;
    for (const id of ids) {
      const entry = progress[id];
      if (!entry) continue;
      if (entry.saved) saved++;
      if ((entry.attempts || 0) > 0) practiced++;
      if ((entry.box || 0) >= MASTERY_BOX_THRESHOLD) mastered++;
    }
    const total = ids.length;
    const pct = total ? Math.round((practiced / total) * 100) : 0;
    const masteredPct = total ? Math.round((mastered / total) * 100) : 0;
    return { ...pillar, total, practiced, mastered, saved, pct, masteredPct };
  });
}

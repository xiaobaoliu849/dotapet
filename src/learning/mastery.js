import { canQuizLesson } from './model.js';
import { learningCollection } from './spokenPhrases.js';

/** Require 3 consecutive correct recalls (7-day Leitner tier) before counting a lesson as mastered. */
export const MASTERY_BOX_THRESHOLD = 3;

export const MASTERY_PILLARS = [
  { key: 'hero', en: 'Heroes', zh: '英雄', icon: '🦸' },
  { key: 'ability', en: 'Hero Abilities', zh: '英雄技能', icon: '🔮' },
  { key: 'item', en: 'Items & Actives', zh: '物品技能', icon: '🛡️' },
  { key: 'phrase', en: 'English Phrases', zh: '实战口语', icon: '💬' },
];

export function summarizeMastery(lessons = [], progress = {}) {
  const groups = new Map(MASTERY_PILLARS.map(pillar => [pillar.key, []]));
  for (const lesson of learningCollection(lessons)) groups.get(lesson.kind)?.push(lesson);

  return MASTERY_PILLARS.map((pillar) => {
    let total = 0;
    let practiced = 0;
    let mastered = 0;
    let saved = 0;
    for (const lesson of groups.get(pillar.key)) {
      const entry = progress[lesson.id];
      if (entry?.saved) saved++;
      if (!canQuizLesson(lesson)) continue;
      total++;
      if (!entry) continue;
      if ((entry.attempts || 0) > 0) practiced++;
      if ((entry.box || 0) >= MASTERY_BOX_THRESHOLD) mastered++;
    }
    const pct = total ? Math.round((practiced / total) * 100) : 0;
    const masteredPct = total ? Math.round((mastered / total) * 100) : 0;
    return { ...pillar, total, practiced, mastered, saved, pct, masteredPct };
  });
}

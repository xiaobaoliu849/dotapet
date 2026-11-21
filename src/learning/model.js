import { itemAliases } from './itemCoaching.js';
import { ITEM_IMAGE_BASE, itemImageSlug } from './itemImages.js';

export function cleanText(value = '') {
  return String(value).replace(/<br\s*\/?\s*>|<\/h\d>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

export function describe(record) {
  const values = new Map((record.special_values || []).map(v => [v.name.toLowerCase(), v.values_float || []]));
  const fields = { abilitycastrange: 'cast_ranges', abilityduration: 'durations', abilitychanneltime: 'channel_times', abilitycooldown: 'cooldowns', abilitymanacost: 'mana_costs', abilitydamage: 'damages' };
  return cleanText(record.desc_loc).replace(/%([\w]+)%/g, (token, key) => {
    key = key.toLowerCase();
    const numbers = values.get(key) || values.get(key.replace(/^bonus_/, '')) || record[fields[key]];
    return numbers?.length ? [...new Set(numbers)].join(' / ') : token;
  }).replace(/%%/g, '%');
}

/** Preserve balance facts separately: not every cooldown or numeric tweak appears in prose. */
export function balanceFacts(record) {
  const facts = {};
  for (const key of ['cooldowns', 'mana_costs', 'cast_ranges', 'damages', 'channel_times', 'durations', 'item_cost']) {
    if (record[key] !== undefined) facts[key] = record[key];
  }
  facts.special_values = (record.special_values || []).map(value => ({ name: value.name,
    values: value.values_float || [], shard: value.values_shard || [], scepter: value.values_scepter || [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return facts;
}

export function itemImageUrl(record) {
  const slug = itemImageSlug(record?.name || '');
  return slug ? `${ITEM_IMAGE_BASE}${slug}.png` : '';
}

export function pairRecords(english, chinese, kind, parent = '') {
  const translations = new Map(chinese.map(r => [r.id, r]));
  return english.flatMap(record => {
    const cn = translations.get(record.id);
    if (!cn?.name_loc || !record.name_loc) throw new Error(`Missing bilingual pair: ${kind}:${record.id}`);
    const imageUrl = kind === 'item' ? itemImageUrl(record) : '';
    return [{ id: `${kind}:${record.id}`, kind, parent, en: cleanText(record.name_loc), zh: cleanText(cn.name_loc),
      descriptionEn: describe(record), descriptionZh: describe(cn),
      ...(imageUrl ? { imageUrl } : {}),
      ...(kind === 'item' && record.name ? { internalName: record.name } : {}),
      ...(kind === 'hero' ? { biographyEn: cleanText(record.bio_loc), biographyZh: cleanText(cn.bio_loc) } : { mechanics: balanceFacts(record) }) }];
  });
}

export function filterLessons(lessons, { kind = 'all', search = '', saved = false, progress = {} } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return lessons.filter(r => (kind === 'all' || r.kind === kind) && (!saved || progress[r.id]?.saved)
    && [r.en, r.zh, r.parent, r.descriptionEn, r.descriptionZh, ...(r.kind === 'item' ? itemAliases(r) : [])]
      .some(s => (s || '').toLocaleLowerCase().includes(query)));
}

export function recordAnswer(previous = {}, correct, now = Date.now(), { earlyReview = false } = {}) {
  if (earlyReview && correct && (previous.attempts || 0) > 0 && previous.due && previous.due > now) {
    return {
      ...previous,
      attempts: (previous.attempts || 0) + 1,
      correct: (previous.correct || 0) + 1,
    };
  }
  const box = correct ? Math.min((previous.box || 0) + 1, 5) : 0;
  return { ...previous, box, attempts: (previous.attempts || 0) + 1, correct: (previous.correct || 0) + Number(correct),
    due: now + (correct ? [0, 1, 3, 7, 14, 30][box] * 86400000 : 60000) };
}

function quizLabelKey(label) {
  return typeof label === 'string' ? label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

export function canQuizLesson(lesson) {
  const en = quizLabelKey(lesson?.en);
  const zh = quizLabelKey(lesson?.zh);
  return Boolean(en && zh && en !== zh);
}

export function makeQuestion(lesson, lessons, direction = 'en', random = Math.random) {
  if (!canQuizLesson(lesson)) return null;
  const field = direction === 'en' ? 'zh' : 'en';
  const promptKey = quizLabelKey(lesson[direction]);
  const validAnswers = new Set([quizLabelKey(lesson[field])]);
  const distractors = new Map();
  for (const candidate of lessons) {
    if (candidate.kind !== lesson.kind || !canQuizLesson(candidate)) continue;
    const answerKey = quizLabelKey(candidate[field]);
    // A shared label can have several correct translations, such as 远行鞋 for both Boots of Travel variants.
    if (quizLabelKey(candidate[direction]) === promptKey) validAnswers.add(answerKey);
    else distractors.set(answerKey, candidate[field]);
  }
  for (const answer of validAnswers) distractors.delete(answer);
  const pool = [...distractors.values()];
  const shuffle = array => {
    for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
    return array;
  };
  if (!pool.length) return null;
  return { id: lesson.id, prompt: lesson[direction], answer: lesson[field], options: shuffle([lesson[field], ...shuffle(pool).slice(0, 3)]) };
}

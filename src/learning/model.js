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

export function pairRecords(english, chinese, kind, parent = '') {
  const translations = new Map(chinese.map(r => [r.id, r]));
  return english.flatMap(record => {
    const cn = translations.get(record.id);
    if (!cn?.name_loc || !record.name_loc) throw new Error(`Missing bilingual pair: ${kind}:${record.id}`);
    return [{ id: `${kind}:${record.id}`, kind, parent, en: cleanText(record.name_loc), zh: cleanText(cn.name_loc),
      descriptionEn: describe(record), descriptionZh: describe(cn),
      ...(kind === 'hero' ? { biographyEn: cleanText(record.bio_loc), biographyZh: cleanText(cn.bio_loc) } : { mechanics: balanceFacts(record) }) }];
  });
}

export function filterLessons(lessons, { kind = 'all', search = '', saved = false, progress = {} } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return lessons.filter(r => (kind === 'all' || r.kind === kind) && (!saved || progress[r.id]?.saved)
    && [r.en, r.zh, r.parent, r.descriptionEn, r.descriptionZh].some(s => s.toLocaleLowerCase().includes(query)));
}

export function recordAnswer(previous = {}, correct, now = Date.now()) {
  const box = correct ? Math.min((previous.box || 0) + 1, 5) : 0;
  return { ...previous, box, attempts: (previous.attempts || 0) + 1, correct: (previous.correct || 0) + Number(correct),
    due: now + (correct ? [0, 1, 3, 7, 14, 30][box] * 86400000 : 60000) };
}

export function makeQuestion(lesson, lessons, direction = 'en', random = Math.random) {
  if (!lesson?.en || !lesson?.zh || lesson.en.trim().toLowerCase() === lesson.zh.trim().toLowerCase()) return null;
  const field = direction === 'en' ? 'zh' : 'en';
  const pool = [...new Set(lessons.filter(r => r.kind === lesson.kind && r[field] !== lesson[field]).map(r => r[field]))];
  const shuffle = array => {
    for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
    return array;
  };
  if (!pool.length) return null;
  return { id: lesson.id, prompt: lesson[direction], answer: lesson[field], options: shuffle([lesson[field], ...shuffle(pool).slice(0, 3)]) };
}

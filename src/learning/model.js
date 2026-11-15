export function cleanText(value = '') {
  return String(value).replace(/<br\s*\/?\s*>|<\/h\d>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

export function describe(record) {
  const values = new Map((record.special_values || []).map(v => [v.name, v.values_float || []]));
  return cleanText(record.desc_loc).replace(/%([\w]+)%/g, (token, key) => {
    const numbers = values.get(key.replace(/^bonus_/, ''));
    return numbers?.length ? [...new Set(numbers)].join(' / ') : token;
  });
}

export function pairRecords(english, chinese, kind, parent = '') {
  const translations = new Map(chinese.map(r => [r.id, r]));
  return english.flatMap(record => {
    const cn = translations.get(record.id);
    if (!cn?.name_loc || !record.name_loc) throw new Error(`Missing bilingual pair: ${kind}:${record.id}`);
    return [{ id: `${kind}:${record.id}`, kind, parent, en: cleanText(record.name_loc), zh: cleanText(cn.name_loc),
      descriptionEn: describe(record), descriptionZh: describe(cn) }];
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
  const field = direction === 'en' ? 'zh' : 'en';
  const pool = [...new Set(lessons.filter(r => r.kind === lesson.kind && r[field] !== lesson[field]).map(r => r[field]))];
  const shuffle = array => {
    for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
    return array;
  };
  if (!pool.length) return null;
  return { id: lesson.id, prompt: lesson[direction], answer: lesson[field], options: shuffle([lesson[field], ...shuffle(pool).slice(0, 3)]) };
}

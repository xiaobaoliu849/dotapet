import { filterLessons, makeQuestion } from './model.js';

export const STUDY_DEFAULTS = { size: 5, scope: 'all', kind: 'all', search: '', direction: 'en' };

export function studyOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid study options');
  const options = { ...STUDY_DEFAULTS, ...value };
  if (![5, 10].includes(options.size) || !['all', 'saved'].includes(options.scope)
    || !['all', 'hero', 'ability', 'item', 'phrase'].includes(options.kind)
    || !['en', 'zh'].includes(options.direction) || typeof options.search !== 'string' || options.search.length > 120) {
    throw new Error('Invalid study options');
  }
  return Object.fromEntries(Object.keys(STUDY_DEFAULTS).map(key => [key, options[key]]));
}

/** Mistakes due now, then other due reviews, then unseen lessons. Never pull future reviews forward. */
export function planStudy(lessons, progress, value = {}, now = Date.now(), random = Math.random) {
  const options = studyOptions(value);
  const eligible = filterLessons(lessons, { ...options, saved: options.scope === 'saved', progress })
    .filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= now);
  const rank = lesson => {
    const record = progress[lesson.id];
    return record?.attempts ? (record.box === 0 ? 0 : 1) : 2;
  };
  const ordered = eligible.map(lesson => ({ lesson, rank: rank(lesson), tie: random() }))
    .sort((a, b) => a.rank - b.rank
      || (a.rank < 2 ? (progress[a.lesson.id]?.due || 0) - (progress[b.lesson.id]?.due || 0) : 0)
      || a.tie - b.tie);
  const items = [];
  for (const { lesson } of ordered) {
    const question = makeQuestion(lesson, lessons, options.direction, random);
    if (question) items.push({ lesson: { ...lesson }, question });
    if (items.length === options.size) break;
  }
  return { options, items };
}

export function localDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function studySummary(session) {
  const correct = session.answers.filter(answer => answer.correct).length;
  return { id: session.id, day: localDay(session.completedAt), completedAt: session.completedAt,
    total: session.answers.length, correct, scope: session.options.scope,
    mistakes: session.answers.filter(answer => !answer.correct).map(answer => answer.id) };
}

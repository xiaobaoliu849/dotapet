import { canQuizLesson, filterLessons, makeQuestion } from './model.js';
import { starterUnit } from './starterPath.js';

export const STUDY_DEFAULTS = { size: 5, scope: 'all', kind: 'all', search: '', direction: 'en' };

export function reviewCounts(lessons, progress, now = Date.now()) {
  let reviews = 0, unseen = 0;
  for (const lesson of lessons) {
    if (!canQuizLesson(lesson)) continue;
    const record = progress[lesson.id];
    if (!record?.attempts) unseen++;
    else if (!record.due || record.due <= now) reviews++;
  }
  return { reviews, unseen };
}

export function studyOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid study options');
  const options = { ...STUDY_DEFAULTS, ...value };
  if (![5, 10].includes(options.size) || (!['all', 'saved'].includes(options.scope) && !starterUnit(options.scope))
    || !['all', 'hero', 'ability', 'item', 'phrase'].includes(options.kind)
    || !['en', 'zh'].includes(options.direction) || typeof options.search !== 'string' || options.search.length > 120) {
    throw new Error('Invalid study options');
  }
  if (starterUnit(options.scope)) Object.assign(options, { kind: 'item', search: '', size: 5 });
  return Object.fromEntries(Object.keys(STUDY_DEFAULTS).map(key => [key, options[key]]));
}

/** Mistakes due now, then other due reviews, then unseen lessons. Never pull future reviews forward. */
export function planStudy(lessons, progress, value = {}, now = Date.now(), random = Math.random) {
  const options = studyOptions(value);
  const unit = starterUnit(options.scope);
  const collection = unit ? lessons.filter(lesson => unit.lessonIds.includes(lesson.id)) : lessons;
  const eligible = filterLessons(collection, { ...options, saved: options.scope === 'saved', progress })
    .filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= now);
  const rank = lesson => {
    const record = progress[lesson.id];
    return record?.attempts ? (record.box === 0 ? 0 : 1) : 2;
  };
  const ordered = eligible.map(lesson => ({ lesson, rank: rank(lesson), tie: unit ? unit.lessonIds.indexOf(lesson.id) : random() }))
    .sort((a, b) => a.rank - b.rank
      || (a.rank < 2 ? (progress[a.lesson.id]?.due || 0) - (progress[b.lesson.id]?.due || 0) : 0)
      || a.tie - b.tie);
  const items = [];
  for (const { lesson } of ordered) {
    const question = makeQuestion(lesson, unit ? collection : lessons, options.direction, random);
    if (question) items.push({ lesson: { ...lesson }, question });
    if (items.length === options.size) break;
  }
  return { options, items };
}

/** Direct single-lesson drill by exact ID (works even when scheduled for a future review; never collides by name). */
export function planFocusedLesson(lessons, progress, value = {}, now = Date.now(), random = Math.random) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid focused lesson options');
  const lessonId = typeof value.lessonId === 'string' ? value.lessonId.trim() : '';
  const direction = value.direction || 'en';
  if (!lessonId || !['en', 'zh'].includes(direction)) throw new Error('Invalid focused lesson options');
  const lesson = lessons.find(row => row.id === lessonId);
  if (!lesson) throw new Error('Unknown lesson');
  const options = { size: 1, scope: 'focus', kind: lesson.kind, search: '', direction, focusId: lesson.id };
  if (!canQuizLesson(lesson)) return { options, items: [], unquizzable: true };
  const question = makeQuestion(lesson, lessons, direction, random);
  if (!question) return { options, items: [], unquizzable: true };
  const record = progress[lesson.id];
  const earlyReview = Boolean(record?.attempts && record.due && record.due > now);
  return { options, items: [{ lesson: { ...lesson }, question, earlyReview }], unquizzable: false };
}

export function localDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function studySummary(session) {
  const correct = session.answers.filter(answer => answer.correct).length;
  return { id: session.id, day: localDay(session.completedAt), completedAt: session.completedAt,
    total: session.answers.length, correct, scope: session.options.scope,
    ...(session.options.focusId ? { focusId: session.options.focusId } : {}),
    mistakes: session.answers.filter(answer => !answer.correct).map(answer => answer.id) };
}

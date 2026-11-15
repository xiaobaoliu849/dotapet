import { cleanText } from './model.js';

// Ignore typography and markup, but retain words, numbers, percentages and signs.
export function contentKey(value = '') {
  return (cleanText(value).normalize('NFKC').toLowerCase().match(/[+-]?\d+(?:\.\d+)?%?|[\p{L}\p{M}]+/gu) || []).join(' ');
}

export function narrationText(lesson, content) {
  if (content === 'biography') return lesson.biographyEn || '';
  if (content === 'expression') return lesson.en;
  return lesson.descriptionEn ? `${lesson.en}. ${lesson.descriptionEn}` : '';
}

export function audioFreshness(entry, lesson, baseline) {
  if (!entry || entry.name !== lesson.en) return { status: 'missing' };
  const currentText = narrationText(lesson, entry.content);
  if (!currentText) return { status: 'needs-stats-template' };
  if (/%\w+%/.test(currentText)) return { status: 'unresolved-current' };
  const reference = baseline?.entries?.[lesson.id];
  if (!reference?.candidateSpeech) return { status: 'unknown-transcript', currentText };
  const same = contentKey(reference.candidateSpeech) === contentKey(currentText);
  const core = entry.content === 'explanation' ? contentKey(lesson.descriptionEn) : '';
  const containsCore = core && (` ${contentKey(reference.candidateSpeech)} `).includes(` ${core} `);
  // Old item scripts often include stats and notes that today's description field omits.
  // An unchanged main explanation is not evidence that this extra spoken context became wrong.
  return { status: same ? 'baseline-matches' : containsCore ? 'baseline-extra-context' : 'baseline-changed', currentText,
    baselineText: reference.candidateSpeech, evidence: reference.evidence };
}

export function diffCatalog(before, after) {
  const previous = new Map(before.lessons.map(lesson => [lesson.id, lesson]));
  const changes = [];
  for (const lesson of after.lessons) {
    const old = previous.get(lesson.id); previous.delete(lesson.id);
    if (!old) { changes.push({ id: lesson.id, name: lesson.en, kind: lesson.kind, type: 'added' }); continue; }
    const fields = ['en', 'zh', 'descriptionEn', 'descriptionZh', 'biographyEn', 'biographyZh']
      .filter(field => old[field] !== undefined && contentKey(old[field]) !== contentKey(lesson[field]));
    // Older snapshots did not capture these facts; a new field is not evidence of a gameplay change.
    const mechanicsChanges = [];
    if (old.mechanics && lesson.mechanics) {
      for (const key of Object.keys(old.mechanics).filter(key => key !== 'special_values')) {
        if (lesson.mechanics[key] !== undefined && JSON.stringify(old.mechanics[key]) !== JSON.stringify(lesson.mechanics[key])) {
          mechanicsChanges.push({ field: key, before: old.mechanics[key], after: lesson.mechanics[key] });
        }
      }
      const values = new Map((lesson.mechanics.special_values || []).map(value => [value.name, value]));
      for (const value of old.mechanics.special_values || []) {
        const next = values.get(value.name);
        if (next && JSON.stringify(value) !== JSON.stringify(next)) mechanicsChanges.push({ field: value.name, before: value, after: next });
      }
    }
    if (fields.length || mechanicsChanges.length) changes.push({ id: lesson.id, name: lesson.en, kind: lesson.kind, type: 'changed', fields, mechanics: Boolean(mechanicsChanges.length), mechanicsChanges,
      before: Object.fromEntries(fields.map(field => [field, old[field]])), after: Object.fromEntries(fields.map(field => [field, lesson[field]])) });
  }
  for (const old of previous.values()) changes.push({ id: old.id, name: old.en, kind: old.kind, type: 'removed' });
  return { from: before.fetchedAt, to: after.fetchedAt, changes };
}

export function auditContent(catalog, manifest, baseline) {
  const rows = catalog.lessons.map(lesson => {
    const entry = manifest.entries[lesson.id];
    return { id: lesson.id, name: lesson.en, kind: lesson.kind, parent: lesson.parent,
      ...audioFreshness(entry, lesson, baseline) };
  });
  return { schema: 1, catalogFetchedAt: catalog.fetchedAt, baselineSource: baseline.source,
    evidenceNote: 'Baseline candidates are inferred from archived generation inputs. MP3 transcripts have not been verified by listening or speech recognition.',
    counts: rows.reduce((counts, row) => { counts[row.status] = (counts[row.status] || 0) + 1; return counts; }, {}), rows };
}

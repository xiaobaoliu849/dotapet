import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { auditContent, narrationText, diffCatalog } from '../src/learning/contentAudit.js';

const root = new URL('../', import.meta.url);
const read = relative => JSON.parse(fs.readFileSync(new URL(relative, root), 'utf8'));
const catalog = read('src/learning/catalog.json'), manifest = read('src/learning/audio-manifest.json');
const baseline = read('src/learning/audio-baseline.json');
const audit = auditContent(catalog, manifest, baseline);
const historical = diffCatalog({ fetchedAt: baseline.fetchedAt, lessons: Object.values(baseline.entries) }, catalog);
const regeneration = audit.rows.filter(row => row.status === 'baseline-changed' || row.status === 'missing')
  .flatMap(row => {
    const lesson = catalog.lessons.find(lesson => lesson.id === row.id);
    const text = narrationText(lesson, manifest.entries[row.id]?.content || (lesson.kind === 'phrase' ? 'expression' : 'explanation'));
    if (!text || /%\w+%/.test(text)) return [];
    return [{ id: row.id, name: row.name, reason: row.status, text, textSha256: createHash('sha256').update(text).digest('hex'), catalogFetchedAt: catalog.fetchedAt,
      priority: row.status === 'baseline-changed' ? 1 : 2, reviewed: false, ...(row.kind === 'item' ? { purchaseAvailabilityVerified: false } : {}) }];
  });
regeneration.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
const directory = new URL('docs/audits/', root); fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(new URL('latest-content-audit.json', directory), JSON.stringify(audit, null, 2) + '\n');
fs.writeFileSync(new URL('historical-data-comparison.json', directory), JSON.stringify(historical, null, 2) + '\n');
fs.writeFileSync(new URL('audio-regeneration-queue.json', directory), JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), note: 'Review these candidate scripts before synthesis. No audio has been generated or replaced.', entries: regeneration }, null, 2) + '\n');
const report = [
  '# DotaPad content and audio audit', '', `Current catalog fetched: ${catalog.fetchedAt}`, '',
  audit.evidenceNote, '', '## Findings', '', '| Classification | Lessons |', '| --- | ---: |',
  ...Object.entries(audit.counts).map(([status, count]) => `| ${status} | ${count} |`), '',
  `Candidate scripts ready for review: **${regeneration.length}**. No MP3s were generated, deleted or replaced.`, '',
  `Lessons with observed numeric differences in shared archived/current fields: **${historical.changes.filter(row => row.mechanics).length}**. Separate [numeric and bilingual comparison](historical-data-comparison.json). Entries absent from the archive are coverage differences, not proof of newly introduced or removed gameplay content. Missing historical fields are not treated as changes.`, '',
  '“Baseline matches” means archived candidate text matches current narration text; it does not verify what the MP3 actually says. “Baseline changed” is a review priority, not proof that the audio is wrong. Unresolved source placeholders are excluded from synthesis.', '',
  '“Baseline extra context” means the current main description is present unchanged in the archived candidate, which also includes other notes or stats. That extra context requires review; it is not automatically labelled obsolete or queued for replacement.', '',
  '“Needs stats template” means the feed provides an empty prose description (typically a stat-only item); it needs a narration template based on current attributes, not placeholder repair. “Unresolved current” means a nonempty description still contains a source token.', '',
  'The official item feed includes historical/internal entries. Missing-item candidates require an active-item availability review before synthesis; their queue records explicitly start with purchaseAvailabilityVerified=false.', '',
  '## Review priority: changed baseline wording', '', '| Lesson | Topic | ID |', '| --- | --- | --- |',
  ...audit.rows.filter(row => row.status === 'baseline-changed').map(row => `| ${row.name.replace(/\|/g, '\\|')} | ${row.parent || row.kind} | ${row.id} |`), '',
  'Full before/after candidate scripts: [JSON audit](latest-content-audit.json). Reviewed regeneration candidates: [queue](audio-regeneration-queue.json) (all start unreviewed).', '',
  '## Policy', '',
  'Keep official bilingual lesson text and balance facts current. Version each generated recording with the exact script hash and catalog retrieval time. Regenerate only reviewed changed scripts; reuse recordings whose verified script still matches. Treat biographies and everyday expressions separately from balance-sensitive explanations. Do not wait for a predicted patch date.', '',
];
fs.writeFileSync(new URL('CONTENT_AUDIT.md', directory), report.join('\n'));
console.log(JSON.stringify({ ...audit.counts, regenerationCandidates: regeneration.length, report: fileURLToPath(new URL('CONTENT_AUDIT.md', directory)) }, null, 2));

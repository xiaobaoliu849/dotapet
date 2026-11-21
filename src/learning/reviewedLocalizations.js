import { createHash } from 'node:crypto';
import fs from 'node:fs';

const reviewed = JSON.parse(fs.readFileSync(new URL('./reviewed-localizations.json', import.meta.url), 'utf8'));

/** Fill known translation gaps for this exact patch while preserving updated feed translations. */
export function applyReviewedLocalizations(catalog) {
  if (catalog.patch !== reviewed.patch) return catalog;

  const lessons = catalog.lessons.map(lesson => {
    const localization = reviewed.lessons[lesson.id];
    if (!localization || lesson.en !== localization.en) return lesson;

    const useName = localization.zh && (!lesson.zh || lesson.zh === lesson.en);
    const description = localization.description;
    const useDescription = description && lesson.descriptionEn
      && (!lesson.descriptionZh || lesson.descriptionZh === lesson.descriptionEn)
      && createHash('sha256').update(lesson.descriptionEn).digest('hex') === description.feedEnglishSha256;

    if (!useName && !useDescription) return lesson;
    return { ...lesson, ...(useName && { zh: localization.zh }), ...(useDescription && { descriptionZh: description.zh }) };
  });
  return { ...catalog, lessons };
}

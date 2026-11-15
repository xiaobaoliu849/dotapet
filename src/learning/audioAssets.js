/** Match the bilingual project's canonical and legacy filenames within the correct subject folder. */
export function audioCandidates(lesson) {
  const safe = value => value.replace(/[‘’]/g, "'").replace(/[^a-zA-Z0-9\s']/g, '').trim().replace(/\s+/g, '_');
  const hero = (lesson.kind === 'hero' ? lesson.en : lesson.parent.split(' · ')[0]).replace(/[^a-zA-Z0-9]/g, '');
  if (lesson.kind === 'hero') return [`heroes/${hero}/Bio.mp3`];
  const folder = lesson.kind === 'ability' ? `heroes/${hero}` : lesson.kind === 'item' ? 'items' : 'phrases';
  const name = safe(lesson.en);
  return [...new Set([name, name.replace(/'/g, '')])].map(name => `${folder}/${name}.mp3`);
}

export function recordedAudio(manifest, lesson) {
  const entry = manifest.entries[lesson.id];
  // Fresh catalogs may rename a lesson. Do not attach an old recording to the new name silently.
  return entry?.name === lesson.en ? entry : null;
}

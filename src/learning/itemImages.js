export const ITEM_IMAGE_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/';

export function itemImageSlug(internalName = '') {
  if (typeof internalName !== 'string') return '';
  const slug = internalName.trim().replace(/^item_/, '');
  return /^[a-z0-9_]+$/.test(slug) ? slug : '';
}

/** Match stable IDs and identity; never guess an asset filename from a translated display name. */
export function itemImageSources(lesson, manifest = { entries: {} }) {
  if (lesson.kind !== 'item') return [];
  const entry = manifest.entries?.[lesson.id];
  // Older cached catalogs carry imageUrl, while new refreshes also retain internalName.
  const legacySlug = typeof lesson.imageUrl === 'string'
    ? lesson.imageUrl.match(/^https:\/\/cdn\.(?:cloudflare\.)?steamstatic\.com\/apps\/dota2\/images\/dota_react\/items\/([a-z0-9_]+)\.png$/)?.[1] : '';
  const slug = itemImageSlug(lesson.internalName || '') || legacySlug || '';
  const matches = entry && (slug ? slug === entry.slug : lesson.en === entry.name);
  const local = matches && /^\d+\.png$/.test(entry.file) ? `assets/learning-items/${entry.file}` : '';
  const primary = slug ? `${ITEM_IMAGE_BASE}${slug}.png` : '';
  const mirror = primary.replace('cdn.cloudflare.steamstatic.com', 'cdn.steamstatic.com');
  return [...new Set([local, primary, mirror].filter(Boolean))];
}

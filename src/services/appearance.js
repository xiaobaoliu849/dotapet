// Shared by the desktop renderer, customization editor and persistent store.
export const APPEARANCE_STYLES = Object.freeze({
  original: { name: '原始色彩', filter: 'none' },
  moonlight: { name: '月光蓝', filter: 'sepia(.35) hue-rotate(155deg) saturate(1.35)' },
  warm: { name: '暖金色', filter: 'sepia(.65) saturate(1.3)' },
  monochrome: { name: '黑白', filter: 'grayscale(1)' },
});

const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
export function validCharacterKey(key) { return typeof key === 'string' && /^(hero|pet):[a-z0-9_]{1,80}$/.test(key); }

export function normalizeProfile(value = {}) {
  const a = value?.appearance || {};
  const b = value?.background || {};
  return {
    appearance: {
      assetId: id(a.assetId), builtinId: id(a.builtinId),
      style: Object.hasOwn(APPEARANCE_STYLES, a.style) ? a.style : 'original',
      fit: a.fit === 'cover' ? 'cover' : 'contain',
      scale: clamp(a.scale, .5, 1.6, 1), x: clamp(a.x, 0, 100, 50), y: clamp(a.y, 0, 100, 50),
    },
    background: {
      mode: ['image', 'color'].includes(b.mode) ? b.mode : 'transparent',
      assetId: id(b.assetId), color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#243341',
      scope: b.scope === 'scene' ? 'scene' : 'panel', fit: b.fit === 'contain' ? 'contain' : 'cover',
      opacity: clamp(b.opacity, 0, 1, .65), dim: clamp(b.dim, 0, .85, .25),
    },
    accent: /^#[0-9a-f]{6}$/i.test(value?.accent) ? value.accent : null,
  };
}

// A catalog entry is an appearance only if its images actually differ.
export function classifySkin(hero, skin) {
  if (!skin?.sprites?.idle) return 'theme';
  const changes = ['idle', 'speaking', 'action'].some(state =>
    (skin.sprites[state] || skin.sprites.idle) !== (hero.sprites?.[state] || hero.sprites?.idle || hero.photoUrl));
  return changes ? 'appearance' : 'theme';
}

export function resolveAppearance(profile, assets, defaultSrc, builtins = {}, state = 'idle') {
  const p = normalizeProfile(profile);
  const imported = assets.find(asset => asset.id === p.appearance.assetId);
  const builtin = builtins[p.appearance.builtinId];
  const src = imported?.url || builtin?.sprites?.[state] || builtin?.sprites?.idle || defaultSrc;
  return { src, imported: Boolean(imported), profile: p, filter: APPEARANCE_STYLES[p.appearance.style].filter };
}

export function applyImageAppearance(image, resolved) {
  if (!image || !resolved) return;
  if (image.getAttribute('src') !== resolved.src) image.src = resolved.src || '';
  const a = resolved.profile.appearance;
  image.style.objectFit = a.fit;
  image.style.objectPosition = `${a.x}% ${a.y}%`;
  // Independent CSS transform properties compose with the pet's animated transform.
  image.style.scale = String(a.scale);
  image.style.translate = `${(a.x - 50) * .35}px ${(a.y - 50) * .35}px`;
  image.style.filter = resolved.filter;
  image.classList.toggle('custom-appearance', resolved.imported);
}

export function applyBackground(layer, profile, assets) {
  if (!layer) return;
  const b = normalizeProfile(profile).background;
  const asset = assets.find(item => item.id === b.assetId);
  layer.style.backgroundImage = b.mode === 'image' && asset ? `url(${JSON.stringify(asset.url)})` : 'none';
  layer.style.backgroundColor = b.mode === 'color' ? b.color : 'transparent';
  layer.style.backgroundSize = b.fit;
  layer.style.backgroundPosition = 'center';
  layer.style.backgroundRepeat = 'no-repeat';
  layer.style.opacity = String(b.opacity);
  layer.style.filter = `brightness(${1 - b.dim})`;
  layer.hidden = b.mode === 'transparent' || (b.mode === 'image' && !asset);
}

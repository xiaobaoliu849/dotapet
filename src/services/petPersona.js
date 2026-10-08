/**
 * Pet persona bridge — turns a desktop-pet manifest (assets/pets/<name>/pet.json)
 * into the pseudo-hero shape CloudVoiceEngine consumes for voice personas.
 *
 * The pet lives in the renderer's PetStateMachine; without this bridge the
 * voice engine keeps talking as the last-equipped hero even while the summoner
 * has a courier walking on the desktop. Main process imports this to build the
 * persona from the renderer-synced manifest; tests import it to pin the shape.
 */

export const PET_PERSONA_KIND = 'pet';

// States whose quotes read best as spoken catchphrases; ordered by voice
// suitability. Kept in one place so the extraction stays testable.
const CATCHPHRASE_STATES = ['idle', 'speak', 'special', 'fetch', 'pet'];

function uniqStrings(values) {
  return [...new Set(values.filter((q) => typeof q === 'string' && q.trim()))];
}

/**
 * Spoken catchphrases for a pet. The renderer syncs a lean payload with this
 * pre-extracted, but both shapes stay supported so the raw manifest works too.
 */
export function extractPetCatchphrases(pet) {
  if (Array.isArray(pet?.catchphrases)) {
    return uniqStrings(pet.catchphrases);
  }
  const states = pet?.states || {};
  return uniqStrings(CATCHPHRASE_STATES.map((key) => states[key]?.quote));
}

// pet.json carries no nameEn; the parenthesised tail of the displayName is the
// canonical English name ("经典信使 · 小毛驴 (Donkey)" -> "Donkey").
function extractNameEn(pet) {
  const match = String(pet.displayName || '').match(/\(([^)]+)\)\s*$/);
  return (match && match[1]) || pet.name || '';
}

/**
 * Build the pet pseudo-hero for the voice engine.
 * Accepts either the raw pet.json manifest (with `states`) or the lean subset
 * the renderer syncs (with pre-extracted `catchphrases`).
 * Returns null when the payload cannot identify a pet, so callers can fall
 * back to the equipped hero instead of injecting a nameless persona.
 */
export function buildPetPseudoHero(pet) {
  if (!pet || typeof pet.name !== 'string' || !pet.name.trim()) return null;
  return {
    id: `pet:${pet.name}`,
    kind: PET_PERSONA_KIND,
    nameZh: pet.displayName || pet.name,
    nameEn: extractNameEn(pet),
    attribute: 'pet',
    themeColor: pet.themeColor || '#f59e0b',
    systemPrompt: pet.description || '',
    catchphrases: extractPetCatchphrases(pet).slice(0, 6),
  };
}

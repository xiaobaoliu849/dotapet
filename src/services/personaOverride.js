/**
 * Companion persona override — the personality, tone and backstory the user
 * wrote for one character in the customizer (profiles['hero:x' | 'pet:x'].persona).
 *
 * It rides on the persona object handed to the voice engine as `customPersona`;
 * the engine puts it in place of the built-in lore. The user's own nickname and
 * chat preferences are appended separately and are never touched here.
 */
import { normalizePersona } from './appearance.js';

export function personaForKey(profiles, key) {
  return normalizePersona(profiles?.[key]?.persona);
}

/** Returns the same object when there is no persona; never mutates the hero config. */
export function applyPersonaOverride(hero, persona) {
  const customPersona = normalizePersona(persona);
  if (!hero || !customPersona) return hero;
  return { ...hero, customPersona };
}

/**
 * DOTA 2 Official GSI Hero Name to VoiceSpirit Hero ID Mapping
 * Handles standard names and legacy internal Dota 2 engine names.
 */

// Legacy and internal alias mappings where DOTA 2 internal name differs from modern/config ID
const HERO_INTERNAL_ALIASES = {
  antimage: 'anti_mage',
  nevermore: 'shadow_fiend',
  windrunner: 'windranger',
  zuus: 'zeus',
  necrolyte: 'necrophos',
  rattletrap: 'clockwerk',
  obsidian_destroyer: 'outworld_destroyer',
  magnataur: 'magnus',
  treant: 'treant_protector',
  skeleton_king: 'wraith_king',
  skeletal_king: 'wraith_king',
  doom_bringer: 'doom',
  shredder: 'timbersaw',
  wisp: 'io',
  furion: 'natures_prophet',
  queenofpain: 'queen_of_pain',
  centaur: 'centaur_warrunner',
  abyssal_underlord: 'underlord',
  monkey_king: 'monkey_king',
  sandking: 'sand_king',
  shadowshaman: 'shadow_shaman',
  stormspirit: 'storm_spirit',
  vengefulspirit: 'vengeful_spirit',
  drowranger: 'drow_ranger',
  phantomlancer: 'phantom_lancer',
  witchdoctor: 'witch_doctor',
  earthshaker: 'earthshaker',
  bloodseeker: 'bloodseeker',
  juggernaut: 'juggernaut',
  crystalmaiden: 'crystal_maiden',
  crystal_maiden: 'crystal_maiden',
  faceless_void: 'faceless_void',
  phantom_assassin: 'phantom_assassin',
  templar_assassin: 'templar_assassin',
  dragon_knight: 'dragon_knight',
  night_stalker: 'night_stalker',
  bounty_hunter: 'bounty_hunter',
  dark_seer: 'dark_seer',
  clinkz: 'clinkz',
  omniknight: 'omniknight',
  enchantress: 'enchantress',
  huskar: 'huskar',
  broodmother: 'broodmother',
  viper: 'viper',
  luna: 'luna',
  dragonknight: 'dragon_knight',
  dazzle: 'dazzle',
  chen: 'chen',
  spectre: 'spectre',
  ancient_apparition: 'ancient_apparition',
  ursa: 'ursa',
  spirit_breaker: 'spirit_breaker',
  gyrocopter: 'gyrocopter',
  alchemist: 'alchemist',
  invoker: 'invoker',
  silencer: 'silencer',
  brewmaster: 'brewmaster',
  shadow_demon: 'shadow_demon',
  lone_druid: 'lone_druid',
  chaos_knight: 'chaos_knight',
  meepo: 'meepo',
  ogre_magi: 'ogre_magi',
  undying: 'undying',
  rubick: 'rubick',
  disruptor: 'disruptor',
  nyx_assassin: 'nyx_assassin',
  naga_siren: 'naga_siren',
  keeper_of_the_light: 'keeper_of_the_light',
  visage: 'visage',
  slark: 'slark',
  medusa: 'medusa',
  troll_warlord: 'troll_warlord',
  bristleback: 'bristleback',
  tusk: 'tusk',
  skywrath_mage: 'skywrath_mage',
  elder_titan: 'elder_titan',
  legion_commander: 'legion_commander',
  techies: 'techies',
  ember_spirit: 'ember_spirit',
  earth_spirit: 'earth_spirit',
  terrorblade: 'terrorblade',
  phoenix: 'phoenix',
  oracle: 'oracle',
  winter_wyvern: 'winter_wyvern',
  arc_warden: 'arc_warden',
  pangolier: 'pangolier',
  dark_willow: 'dark_willow',
  grimstroke: 'grimstroke',
  mars: 'mars',
  void_spirit: 'void_spirit',
  snapfire: 'snapfire',
  hoodwink: 'hoodwink',
  dawnbreaker: 'dawnbreaker',
  marci: 'marci',
  primal_beast: 'primal_beast',
  muerta: 'muerta',
  ringmaster: 'ringmaster',
  kez: 'kez',
};

/**
 * Normalizes DOTA 2 GSI hero name (e.g. "npc_dota_hero_nevermore") to VoiceSpirit heroId
 * @param {string} rawHeroName 
 * @param {object} availableHeroes optional map of valid hero IDs
 * @returns {string|null}
 */
export function normalizeGsiHeroName(rawHeroName, availableHeroes = null) {
  if (!rawHeroName || typeof rawHeroName !== 'string') return null;

  // Strip prefix
  let cleaned = rawHeroName.replace(/^npc_dota_hero_/, '').trim().toLowerCase();
  if (!cleaned) return null;

  // Check alias map
  if (HERO_INTERNAL_ALIASES[cleaned]) {
    const aliasId = HERO_INTERNAL_ALIASES[cleaned];
    if (!availableHeroes || availableHeroes[aliasId]) {
      return aliasId;
    }
  }

  // Check direct match
  if (availableHeroes && availableHeroes[cleaned]) {
    return cleaned;
  }

  // Try converting camelCase or hyphen to snake_case
  const snake = cleaned.replace(/[-\s]/g, '_');
  if (availableHeroes && availableHeroes[snake]) {
    return snake;
  }

  return HERO_INTERNAL_ALIASES[cleaned] || snake;
}

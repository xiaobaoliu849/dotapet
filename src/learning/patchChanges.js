// Pure bilingual formatting and indexing for Dota 2 patch change markers (no invented values).
import { classifyItem } from './itemShop.js';

const CANONICAL_FIELD_ALIAS = {
  abilitycooldown: 'cooldown',
  cooldowns: 'cooldown',
  cooldown: 'cooldown',
  abilitymanacost: 'mana_cost',
  mana_costs: 'mana_cost',
  mana_cost: 'mana_cost',
  abilitycastrange: 'cast_range',
  cast_ranges: 'cast_range',
  cast_range: 'cast_range',
  abilityduration: 'duration',
  durations: 'duration',
  duration: 'duration',
  abilitydamage: 'damage',
  damages: 'damage',
  damage: 'damage',
  abilitychanneltime: 'channel_time',
  channel_times: 'channel_time',
  channel_time: 'channel_time',
  abilitycharges: 'charges',
  abilitychargerestoretime: 'charge_restore_time',
  abilitycastpoint: 'cast_point',
};

const FIELD_LABELS = {
  item_cost: { en: 'Cost', zh: '价格', unit: 'g' },
  cooldown: { en: 'Cooldown', zh: '冷却时间', unit: 's' },
  mana_cost: { en: 'Mana Cost', zh: '魔法消耗' },
  cast_range: { en: 'Cast Range', zh: '施法距离' },
  duration: { en: 'Duration', zh: '持续时间', unit: 's' },
  damage: { en: 'Damage', zh: '伤害' },
  channel_time: { en: 'Channel Time', zh: '持续施法时间', unit: 's' },
  charges: { en: 'Charges', zh: '能量点数' },
  charge_restore_time: { en: 'Charge Restore Time', zh: '充能时间', unit: 's' },
  cast_point: { en: 'Cast Point', zh: '施法前摇', unit: 's' },
  radius: { en: 'Radius', zh: '作用范围' },
  aoe: { en: 'Radius', zh: '作用范围' },
  bonus_aoe: { en: 'AoE Radius', zh: '作用范围加成' },
  aoe_bonus: { en: 'AoE Radius', zh: '作用范围加成' },
  spell_amp: { en: 'Spell Amp', zh: '技能增强', unit: '%' },
  bonus_spell_amp: { en: 'Spell Amp', zh: '技能增强', unit: '%' },
  bonus_damage: { en: 'Bonus Damage', zh: '攻击力加成' },
  base_damage: { en: 'Base Damage', zh: '基础伤害' },
  bonus_attack_speed: { en: 'Attack Speed', zh: '攻击速度' },
  attack_speed: { en: 'Attack Speed', zh: '攻击速度' },
  attack_slow: { en: 'Attack Slow', zh: '攻速降低' },
  bonus_movement_speed: { en: 'Move Speed', zh: '移动速度' },
  bonus_movement: { en: 'Move Speed', zh: '移动速度' },
  movement_speed: { en: 'Move Speed', zh: '移动速度' },
  speed_bonus: { en: 'Move Speed Bonus', zh: '移速加成' },
  movement_speed_pct: { en: 'Move Speed %', zh: '移速百分比' },
  movement_speed_percent_bonus: { en: 'Move Speed Bonus', zh: '移速加成', unit: '%' },
  movement_speed_percent_bonus_melee: { en: 'Melee Move Speed Bonus', zh: '近战移速加成', unit: '%' },
  windwalk_movement_speed: { en: 'Invis Move Speed', zh: '隐身移速加成', unit: '%' },
  movement_slow: { en: 'Move Slow', zh: '移速减缓', unit: '%' },
  movespeed_slow: { en: 'Move Slow', zh: '移速减缓', unit: '%' },
  slow: { en: 'Slow', zh: '减速', unit: '%' },
  slow_duration: { en: 'Slow Duration', zh: '减速持续时间', unit: 's' },
  stun_duration: { en: 'Stun Duration', zh: '眩晕时间', unit: 's' },
  debuff_duration: { en: 'Debuff Duration', zh: '负面效果时长', unit: 's' },
  buff_duration: { en: 'Buff Duration', zh: '增益持续时间', unit: 's' },
  illusion_duration: { en: 'Illusion Duration', zh: '幻象持续时间', unit: 's' },
  root_duration: { en: 'Root Duration', zh: '缠绕时间', unit: 's' },
  silence_duration: { en: 'Silence Duration', zh: '沉默时间', unit: 's' },
  fear_duration: { en: 'Fear Duration', zh: '恐惧时间', unit: 's' },
  hex_duration: { en: 'Hex Duration', zh: '妖术时间', unit: 's' },
  sleep_duration: { en: 'Sleep Duration', zh: '睡眠时间', unit: 's' },
  armor: { en: 'Armor', zh: '护甲' },
  bonus_armor: { en: 'Armor', zh: '护甲' },
  armor_reduction: { en: 'Armor Reduction', zh: '护甲降低' },
  bonus_strength: { en: 'Strength', zh: '力量' },
  bonus_agility: { en: 'Agility', zh: '敏捷' },
  bonus_intellect: { en: 'Intelligence', zh: '智力' },
  bonus_all_stats: { en: 'All Attributes', zh: '全属性' },
  bonus_health: { en: 'Health', zh: '生命值' },
  bonus_mana: { en: 'Mana', zh: '魔法值' },
  health_regen: { en: 'Health Regen', zh: '生命恢复' },
  bonus_health_regen: { en: 'Health Regen', zh: '生命恢复' },
  bonus_hp_regen: { en: 'Health Regen', zh: '生命恢复' },
  hp_regen_amp: { en: 'Health Regen Amp', zh: '生命恢复增强', unit: '%' },
  heal_amp: { en: 'Heal Amp', zh: '治疗增强', unit: '%' },
  health_restoration: { en: 'Health Restoration', zh: '生命恢复增强', unit: '%' },
  mana_regen: { en: 'Mana Regen', zh: '魔法恢复' },
  bonus_mana_regen: { en: 'Mana Regen', zh: '魔法恢复' },
  mana_regen_multiplier: { en: 'Mana Regen Amp', zh: '回蓝增强', unit: '%' },
  evasion: { en: 'Evasion', zh: '闪避', unit: '%' },
  bonus_evasion: { en: 'Evasion', zh: '闪避', unit: '%' },
  magic_resist: { en: 'Magic Resistance', zh: '魔法抗性', unit: '%' },
  bonus_magic_resistance: { en: 'Magic Resistance', zh: '魔法抗性', unit: '%' },
  tooltip_resist: { en: 'Magic Resistance', zh: '魔法抗性', unit: '%' },
  status_resistance: { en: 'Status Resistance', zh: '状态抗性', unit: '%' },
  slow_resistance: { en: 'Slow Resistance', zh: '减速抗性', unit: '%' },
  lifesteal: { en: 'Lifesteal', zh: '攻击吸血', unit: '%' },
  spell_lifesteal: { en: 'Spell Lifesteal', zh: '技能吸血', unit: '%' },
  cooldown_reduction: { en: 'Cooldown Reduction', zh: '冷却减少', unit: '%' },
  attack_range: { en: 'Attack Range', zh: '攻击距离' },
  bonus_attack_range: { en: 'Attack Range', zh: '攻击距离' },
  projectile_speed: { en: 'Projectile Speed', zh: '弹道速度' },
  max_distance: { en: 'Max Distance', zh: '最大距离' },
  range: { en: 'Range', zh: '距离' },
  distance: { en: 'Distance', zh: '距离' },
  heal: { en: 'Heal', zh: '治疗量' },
  health_restore: { en: 'Health Restore', zh: '生命回复' },
  hp_restore: { en: 'HP Restore', zh: '生命回复' },
  mana_restore: { en: 'Mana Restore', zh: '魔法回复' },
  damage_per_second: { en: 'Damage / Sec', zh: '每秒伤害' },
  dps: { en: 'Damage / Sec', zh: '每秒伤害' },
  strength_damage: { en: 'Strength Damage', zh: '力量系数伤害' },
  max_stacks: { en: 'Max Stacks', zh: '最大叠加层数' },
  cleave_pct: { en: 'Cleave', zh: '分裂伤害', unit: '%' },
  crit_mult: { en: 'Crit Damage', zh: '暴击倍率', unit: '%' },
  crit_chance: { en: 'Crit Chance', zh: '暴击几率', unit: '%' },
  incoming_illusion_damage: { en: 'Illusion Incoming Dmg', zh: '幻象承伤', unit: '%' },
  strike_damage: { en: 'Strike Damage', zh: '打击伤害' },
  stack_bonus_damage: { en: 'Damage per Stack', zh: '每层额外伤害' },
  inner_radius: { en: 'Inner Radius', zh: '内圈范围' },
  frostbite_radius: { en: 'Frostbite Radius', zh: '冰封范围' },
  burrow_speed: { en: 'Burrow Speed', zh: '掘地速度' },
  bonus_gpm: { en: 'Gold / Min', zh: '每分钟金钱' },
  bonus_xpm: { en: 'XP / Min', zh: '每分钟经验' },
  day_vision: { en: 'Day Vision', zh: '日间视野' },
  night_vision: { en: 'Night Vision', zh: '夜间视野' },
  bonus_night_vision: { en: 'Night Vision', zh: '夜间视野' },
  barrier: { en: 'Barrier', zh: '护盾值' },
  shield: { en: 'Barrier', zh: '护盾值' },
  block_damage_melee: { en: 'Melee Damage Block', zh: '近战格挡' },
  block_damage_ranged: { en: 'Ranged Damage Block', zh: '远程格挡' },
  cast_range_bonus: { en: 'Cast Range', zh: '施法距离' },
  bonus_spell_damage: { en: 'Spell Damage', zh: '技能伤害' },
  armor_aura: { en: 'Aura Armor', zh: '光环护甲' },
  bonus_aoe_armor: { en: 'AoE Armor', zh: '范围护甲' },
  aura_radius: { en: 'Aura Radius', zh: '光环范围' },
  aura_health_regen: { en: 'Aura Health Regen', zh: '光环生命恢复' },
  aura_spell_vulnerability: { en: 'Spell Amp Aura', zh: '光环技能易伤', unit: '%' },
  proc_damage_creeps: { en: 'Creep Proc Damage', zh: '小兵触发伤害' },
  blast_movement_speed: { en: 'Blast Move Slow', zh: '冲击波移速减缓', unit: '%' },
  blast_radius: { en: 'Blast Radius', zh: '冲击波范围' },
  spell_lifesteal_while_active: { en: 'Active Spell Lifesteal', zh: '主动技能吸血', unit: '%' },
  burn_dps_units: { en: 'Unit Burn DPS', zh: '对单位灼烧秒伤' },
  burn_slow: { en: 'Burn Slow', zh: '灼烧减速', unit: '%' },
  impact_damage_units: { en: 'Unit Impact Damage', zh: '对单位冲击伤害' },
  cold_slow_melee: { en: 'Melee Cold Slow', zh: '近战冰冷减速', unit: '%' },
  cold_slow_ranged: { en: 'Ranged Cold Slow', zh: '远程冰冷减速', unit: '%' },
  bonus_cooldown: { en: 'Cooldown Reduction', zh: '冷却减少', unit: '%' },
  active_mres_reduction: { en: 'Active Magic Resist Reduction', zh: '主动魔抗降低', unit: '%' },
  int_damage_multiplier: { en: 'Int Damage Multiplier', zh: '智力伤害倍率' },
  disarm_melee: { en: 'Melee Disarm', zh: '近战缴械', unit: 's' },
  disarm_range: { en: 'Ranged Disarm', zh: '远程缴械', unit: 's' },
  damage_return_creep: { en: 'Creep Return Damage', zh: '对小兵反弹伤害' },
  damage_return_hero: { en: 'Hero Return Damage', zh: '对英雄反弹伤害' },
  leap_distance: { en: 'Leap Distance', zh: '跳跃距离' },
  crit_multiplier: { en: 'Crit Damage', zh: '暴击倍率', unit: '%' },
  projectile_damage: { en: 'Projectile Damage', zh: '弹道伤害' },
  max_mana: { en: 'Max Mana', zh: '最大魔法值' },
  magic_res: { en: 'Magic Resistance', zh: '魔法抗性', unit: '%' },
  manacost_reduction: { en: 'Mana Cost Reduction', zh: '魔法消耗降低', unit: '%' },
  mana_reduction_pct: { en: 'Mana Cost Reduction', zh: '魔法消耗降低', unit: '%' },
  health_bonus: { en: 'Health', zh: '生命值' },
  knockback_resist: { en: 'Knockback Resistance', zh: '击退抗性', unit: '%' },
  bat_reduce: { en: 'Base Attack Time Reduction', zh: '基础攻击间隔降低', unit: '%' },
  debuff_amp: { en: 'Debuff Duration', zh: '负面效果时长', unit: '%' },
  primary_stat: { en: 'Primary Attribute', zh: '主属性' },
  primary_stat_universal: { en: 'All Attributes (Universal)', zh: '全属性（全才）' },
  base_attack_damage: { en: 'Base Attack Damage', zh: '基础攻击力', unit: '%' },
  slow_pct: { en: 'Slow', zh: '减速', unit: '%' },
  splash_pct: { en: 'Splash Damage', zh: '溅射伤害', unit: '%' },
  hp_dmg: { en: 'HP-Based Damage', zh: '生命百分比伤害', unit: '%' },
};

const SCOPE_LABELS = {
  shard: { en: 'Shard', zh: '魔晶' },
  scepter: { en: 'Scepter', zh: '神杖' },
};

const FIELD_ORDER = ['item_cost', 'cooldown', 'mana_cost', 'cast_range', 'damage', 'duration', 'radius', 'channel_time'];

function roundNumber(n) {
  return Math.round(n * 100) / 100;
}

export function formatNumericSeries(raw, unit = '') {
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '—';
    return `${roundNumber(raw)}${unit}`;
  }
  if (!Array.isArray(raw) || !raw.length) return '—';
  const nums = raw.filter(n => typeof n === 'number' && Number.isFinite(n));
  if (!nums.length) return '—';
  const unique = [...new Set(nums.map(roundNumber))];
  const body = unique.length === 1 ? String(unique[0]) : nums.map(roundNumber).join(' / ');
  return `${body}${unit}`;
}

function humanizeFieldKey(rawKey, scope = null) {
  let clean = String(rawKey || '').trim();
  if (scope === 'shard') clean = clean.replace(/^shard_/i, '');
  if (scope === 'scepter') clean = clean.replace(/^scepter_/i, '');
  const lower = clean.toLowerCase();
  const canonical = CANONICAL_FIELD_ALIAS[lower] || lower;
  const known = FIELD_LABELS[canonical];
  if (known) {
    return { key: canonical, en: known.en, zh: known.zh, unit: known.unit || '' };
  }
  // Infer conservative unit only from unambiguous suffixes
  let unit = '';
  if (/(?:^|_)(?:pct|percent|percentage)(?:_|$)/i.test(clean)) unit = '%';
  else if (/(?:^|_)(?:duration|cooldown|interval|delay|channel_time|restore_time)(?:_|$)/i.test(clean)) unit = 's';

  const stripped = clean
    .replace(/^ability/i, '')
    .replace(/(?:^|_)(?:pct|percent|percentage|tooltip)(?=_|$)/gi, '')
    .replace(/_+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  const title = stripped
    ? stripped.replace(/\b\w/g, ch => ch.toUpperCase())
      .replace(/\bAoe\b/g, 'AoE')
      .replace(/\bHp\b/g, 'HP')
      .replace(/\bMp\b/g, 'MP')
      .replace(/\bDps\b/g, 'DPS')
      .replace(/\bXp\b/g, 'XP')
      .replace(/\bGpm\b/g, 'GPM')
      .replace(/\bXpm\b/g, 'XPM')
      .replace(/\bBat\b/g, 'BAT')
      .replace(/\bPct\b/g, '%')
    : clean;
  return { key: canonical, en: title, zh: title, unit };
}

function sameSeries(a, b) {
  const norm = v => {
    if (Array.isArray(v)) {
      const nums = v.filter(n => typeof n === 'number' && Number.isFinite(n)).map(roundNumber);
      if (!nums.length) return '';
      const u = [...new Set(nums)];
      return u.length === 1 ? String(u[0]) : nums.join('/');
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(roundNumber(v));
    return '';
  };
  return norm(a) === norm(b);
}

/**
 * Normalizes raw diffCatalog() mechanicsChanges into deduplicated, human-readable bilingual rows.
 * Handles overlapping Valve fields (e.g. `cooldowns` + `AbilityCooldown`) and Shard/Scepter sub-diffs.
 */
export function normalizeMechanicsChanges(mechanicsChanges = []) {
  if (!Array.isArray(mechanicsChanges) || !mechanicsChanges.length) return [];
  const rows = [];
  const seen = new Set();

  const pushRow = (rawField, scope, beforeVal, afterVal) => {
    if (sameSeries(beforeVal, afterVal)) return;
    const meta = humanizeFieldKey(rawField, scope);
    const dedupeKey = `${meta.key}::${scope || 'base'}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const before = formatNumericSeries(beforeVal, meta.unit);
    const after = formatNumericSeries(afterVal, meta.unit);
    if (before === after) return;
    rows.push({
      key: meta.key,
      en: meta.en,
      zh: meta.zh,
      scope: scope || null,
      before,
      after,
    });
  };

  // Process special_value objects first (they carry shard & scepter details), then top-level arrays/scalars.
  const ordered = [...mechanicsChanges].sort((a, b) => {
    const aObj = a?.before && typeof a.before === 'object' && !Array.isArray(a.before) ? 0 : 1;
    const bObj = b?.before && typeof b.before === 'object' && !Array.isArray(b.before) ? 0 : 1;
    return aObj - bObj;
  });

  for (const item of ordered) {
    if (!item || !item.field) continue;
    const before = item.before;
    const after = item.after;
    if (before && typeof before === 'object' && !Array.isArray(before) && after && typeof after === 'object' && !Array.isArray(after)) {
      pushRow(item.field, null, before.values, after.values);
      pushRow(item.field, 'shard', before.shard, after.shard);
      pushRow(item.field, 'scepter', before.scepter, after.scepter);
    } else {
      pushRow(item.field, null, before, after);
    }
  }

  rows.sort((a, b) => {
    const ai = FIELD_ORDER.indexOf(a.key);
    const bi = FIELD_ORDER.indexOf(b.key);
    const ar = ai === -1 ? 99 : ai;
    const br = bi === -1 ? 99 : bi;
    if (ar !== br) return ar - br;
    const as = a.scope ? 1 : 0;
    const bs = b.scope ? 1 : 0;
    return as - bs;
  });

  return rows;
}

export function formatPatchStatLabel(stat, chinese = false) {
  if (!stat) return '';
  const base = chinese ? (stat.zh || stat.en) : (stat.en || stat.zh);
  if (!stat.scope || !SCOPE_LABELS[stat.scope]) return base;
  const tag = SCOPE_LABELS[stat.scope];
  return chinese ? `${base}（${tag.zh}）` : `${base} (${tag.en})`;
}

export function buildPatchChangesManifest({
  diff,
  beforeCatalog = null,
  afterCatalog = null,
  shopCategories = null,
  patch = null,
  previousPatch = null,
  releasedAt = null,
} = {}) {
  const beforeById = new Map((beforeCatalog?.lessons || []).map(l => [l.id, l]));
  const afterById = new Map((afterCatalog?.lessons || []).map(l => [l.id, l]));
  const heroByParent = new Map(
    (afterCatalog?.lessons || [])
      .filter(l => l.kind === 'hero')
      .map(h => [`${h.en} · ${h.zh}`, h]),
  );

  const entries = {};
  const removed = [];

  for (const change of diff?.changes || []) {
    if (!change?.id) continue;
    if (change.type === 'added') {
      entries[change.id] = {
        type: 'added',
        kind: change.kind,
      };
      continue;
    }
    if (change.type === 'removed') {
      const prev = beforeById.get(change.id);
      const parent = prev?.parent || '';
      const hero = heroByParent.get(parent) || null;
      removed.push({
        id: change.id,
        kind: change.kind,
        en: prev?.en || change.name || '',
        zh: prev?.zh || prev?.en || change.name || '',
        parent,
        heroId: hero?.id || null,
      });
      continue;
    }
    if (change.type === 'changed') {
      const stats = normalizeMechanicsChanges(change.mechanicsChanges || []);
      const fields = Array.isArray(change.fields) ? change.fields : [];
      const textChanged = fields.some(f => f === 'descriptionEn' || f === 'descriptionZh' || f === 'en' || f === 'zh');
      if (!stats.length && !textChanged) continue;
      const entry = {
        type: 'changed',
        kind: change.kind,
        stats,
        textChanged,
      };
      if (change.before?.descriptionEn && change.before.descriptionEn !== afterById.get(change.id)?.descriptionEn) {
        entry.beforeDescEn = change.before.descriptionEn;
      }
      if (change.before?.descriptionZh && change.before.descriptionZh !== afterById.get(change.id)?.descriptionZh) {
        entry.beforeDescZh = change.before.descriptionZh;
      }
      entries[change.id] = entry;
    }
  }

  const manifest = {
    schema: 1,
    patch: patch || afterCatalog?.patch || null,
    previousPatch: previousPatch || null,
    releasedAt: releasedAt || afterCatalog?.patchDate || null,
    from: diff?.from || beforeCatalog?.fetchedAt || null,
    to: diff?.to || afterCatalog?.fetchedAt || null,
    removed,
    entries,
  };

  // Attach summary counts for quick inspection & testing
  const summary = summarizePatchChanges(manifest, afterCatalog?.lessons || [], shopCategories);
  manifest.counts = {
    addedShopItems: summary.newShopItems.length,
    addedNeutralItems: summary.newNeutralItems.length,
    addedOtherItems: summary.newOtherItems.length,
    changedShopItems: summary.changedByRealm.shop.length,
    changedNeutralItems: summary.changedByRealm.neutral.length,
    changedArchiveItems: summary.changedByRealm.archive.length,
    addedAbilities: summary.newAbilities.length,
    changedAbilities: summary.changedAbilities.length,
    removedAbilities: summary.removedAbilities.length,
    affectedHeroes: summary.affectedHeroes.length,
  };

  return manifest;
}

export function getLessonPatchChange(manifest, lessonId) {
  if (!manifest?.entries || !lessonId) return null;
  return manifest.entries[lessonId] || null;
}

export function getHeroPatchSummary(manifest, hero, abilities = []) {
  if (!manifest || !hero) {
    return { addedCount: 0, changedCount: 0, removedAbilities: [], totalCount: 0, status: null };
  }
  const parentKey = `${hero.en} · ${hero.zh}`;
  let addedCount = 0;
  let changedCount = 0;
  for (const ab of abilities) {
    const ch = getLessonPatchChange(manifest, ab.id);
    if (!ch) continue;
    if (ch.type === 'added') addedCount++;
    else if (ch.type === 'changed') changedCount++;
  }
  const removedAbilities = (manifest.removed || []).filter(
    r => r.kind === 'ability' && (r.heroId === hero.id || r.parent === parentKey),
  );
  const totalCount = addedCount + changedCount + removedAbilities.length;
  const status = addedCount > 0 ? 'added' : totalCount > 0 ? 'changed' : null;
  return { addedCount, changedCount, removedAbilities, totalCount, status };
}

export function summarizePatchChanges(manifest, lessons = [], shopCategories = null) {
  const newShopItems = [];
  const newNeutralItems = [];
  const newOtherItems = [];
  const changedItems = [];
  const changedByRealm = { shop: [], neutral: [], archive: [] };
  const newAbilities = [];
  const changedAbilities = [];
  const removedAbilities = (manifest?.removed || []).filter(r => r.kind === 'ability');
  const heroes = [];
  const abilitiesByParent = new Map();

  for (const lesson of lessons) {
    if (lesson.kind === 'hero') {
      heroes.push(lesson);
    } else if (lesson.kind === 'ability') {
      const list = abilitiesByParent.get(lesson.parent) || [];
      list.push(lesson);
      abilitiesByParent.set(lesson.parent, list);
    }
  }

  for (const lesson of lessons) {
    const ch = getLessonPatchChange(manifest, lesson.id);
    if (!ch) continue;
    if (lesson.kind === 'item') {
      const realm = classifyItem(lesson, shopCategories).realm;
      if (ch.type === 'added') {
        if (realm === 'shop') newShopItems.push(lesson);
        else if (realm === 'neutral') newNeutralItems.push(lesson);
        else newOtherItems.push(lesson);
      } else if (ch.type === 'changed') {
        const row = { lesson, change: ch, realm };
        changedItems.push(row);
        (changedByRealm[realm] || changedByRealm.archive).push(row);
      }
    } else if (lesson.kind === 'ability') {
      if (ch.type === 'added') newAbilities.push(lesson);
      else if (ch.type === 'changed') changedAbilities.push({ lesson, change: ch });
    }
  }

  // Sort new shop items by gold cost ascending, new neutrals by tier order
  newShopItems.sort((a, b) => (a.mechanics?.item_cost || 0) - (b.mechanics?.item_cost || 0));
  newNeutralItems.sort((a, b) => {
    const ca = classifyItem(a, shopCategories).category;
    const cb = classifyItem(b, shopCategories).category;
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.en || '').localeCompare(b.en || '');
  });
  changedItems.sort((a, b) => {
    const rank = { shop: 0, neutral: 1, archive: 2 };
    if (rank[a.realm] !== rank[b.realm]) return rank[a.realm] - rank[b.realm];
    const sa = a.change.stats?.length || 0;
    const sb = b.change.stats?.length || 0;
    if (sb !== sa) return sb - sa;
    return (a.lesson.en || '').localeCompare(b.lesson.en || '');
  });

  const affectedHeroes = [];
  for (const hero of heroes) {
    const abs = abilitiesByParent.get(`${hero.en} · ${hero.zh}`) || [];
    const summary = getHeroPatchSummary(manifest, hero, abs);
    if (summary.totalCount > 0) affectedHeroes.push({ hero, summary });
  }
  affectedHeroes.sort((a, b) => {
    if (b.summary.addedCount !== a.summary.addedCount) return b.summary.addedCount - a.summary.addedCount;
    if (b.summary.removedAbilities.length !== a.summary.removedAbilities.length) return b.summary.removedAbilities.length - a.summary.removedAbilities.length;
    if (b.summary.totalCount !== a.summary.totalCount) return b.summary.totalCount - a.summary.totalCount;
    return (a.hero.en || '').localeCompare(b.hero.en || '');
  });

  return {
    patch: manifest?.patch || null,
    previousPatch: manifest?.previousPatch || null,
    releasedAt: manifest?.releasedAt || null,
    newShopItems,
    newNeutralItems,
    newOtherItems,
    changedItems,
    changedByRealm,
    newAbilities,
    changedAbilities,
    removedAbilities,
    affectedHeroes,
  };
}

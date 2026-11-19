// Pure bilingual formatting for Valve item stats, notes, and lore (no invented numbers).

export const HEADING_TOKENS = {
  '$damage': { en: 'Attack Damage', zh: '攻击力' },
  '$attack': { en: 'Attack Speed', zh: '攻击速度' },
  '$armor': { en: 'Armor', zh: '护甲' },
  '$spell_resist': { en: 'Magic Resistance', zh: '魔法抗性', pct: true },
  '$str': { en: 'Strength', zh: '力量' },
  '$agi': { en: 'Agility', zh: '敏捷' },
  '$int': { en: 'Intelligence', zh: '智力' },
  '$all': { en: 'All Attributes', zh: '全属性' },
  '$health': { en: 'Health', zh: '生命值' },
  '$mana': { en: 'Mana', zh: '魔法值' },
  '$hp_regen': { en: 'Health Regen', zh: '生命恢复' },
  '$mana_regen': { en: 'Mana Regen', zh: '魔法恢复' },
  '$move_speed': { en: 'Movement Speed', zh: '移动速度' },
  '$evasion': { en: 'Evasion', zh: '闪避', pct: true },
  '$cast_range': { en: 'Cast Range', zh: '施法距离' },
  '$attack_range': { en: 'Attack Range', zh: '攻击距离' },
  '$spell_amp': { en: 'Spell Amplification', zh: '技能增强', pct: true },
  '$lifesteal': { en: 'Lifesteal', zh: '攻击吸血', pct: true },
  '$spell_lifesteal': { en: 'Spell Lifesteal', zh: '技能吸血', pct: true },
  '$status_resist': { en: 'Status Resistance', zh: '状态抗性', pct: true },
  '$slow_resist': { en: 'Slow Resistance', zh: '减速抗性', pct: true },
  '$selected_attrib': { en: 'Selected Attribute', zh: '所选属性' },
  '$primary_attribute': { en: 'Primary Attribute', zh: '主属性' },
  '$dota_ability_variable_mana_regen': { en: 'Mana Regen', zh: '魔法恢复' },
  '$projectile_speed': { en: 'Projectile Speed', zh: '弹道速度' },
  '$night_vision': { en: 'Night Vision', zh: '夜间视野' },
  '$day_vision': { en: 'Day Vision', zh: '日间视野' },
};

const FALLBACK_SV_MAP = {
  bonus_damage: { en: 'Attack Damage', zh: '攻击力' },
  base_attack_damage: { en: 'Base Attack Damage', zh: '基础攻击力', pct: true },
  bonus_attack_speed: { en: 'Attack Speed', zh: '攻击速度' },
  attack_speed: { en: 'Attack Speed', zh: '攻击速度' },
  bonus_speed: { en: 'Attack Speed', zh: '攻击速度' },
  bonus_armor: { en: 'Armor', zh: '护甲' },
  armor: { en: 'Armor', zh: '护甲' },
  tooltip_resist: { en: 'Magic Resistance', zh: '魔法抗性', pct: true },
  bonus_magical_armor: { en: 'Magic Resistance', zh: '魔法抗性', pct: true },
  bonus_magic_resistance: { en: 'Magic Resistance', zh: '魔法抗性', pct: true },
  magic_resist: { en: 'Magic Resistance', zh: '魔法抗性', pct: true },
  magic_res: { en: 'Magic Resistance', zh: '魔法抗性', pct: true },
  bonus_strength: { en: 'Strength', zh: '力量' },
  bonus_agility: { en: 'Agility', zh: '敏捷' },
  bonus_intellect: { en: 'Intelligence', zh: '智力' },
  bonus_all_stats: { en: 'All Attributes', zh: '全属性' },
  bonus_health: { en: 'Health', zh: '生命值' },
  health_bonus: { en: 'Health', zh: '生命值' },
  max_health: { en: 'Max Health', zh: '最大生命值', pct: true },
  bonus_mana: { en: 'Mana', zh: '魔法值' },
  max_mana: { en: 'Max Mana', zh: '最大魔法值' },
  bonus_health_regen: { en: 'Health Regen', zh: '生命恢复' },
  bonus_hp_regen: { en: 'Health Regen', zh: '生命恢复' },
  bonus_regen: { en: 'Health Regen', zh: '生命恢复' },
  health_regen: { en: 'Health Regen', zh: '生命恢复' },
  max_health_regen: { en: 'Max Health Regen', zh: '最大生命恢复', pct: true },
  bonus_mana_regen: { en: 'Mana Regen', zh: '魔法恢复' },
  mana_regen: { en: 'Mana Regen', zh: '魔法恢复' },
  bonus_movement_speed: { en: 'Movement Speed', zh: '移动速度' },
  movement_speed: { en: 'Movement Speed', zh: '移动速度' },
  movespeed: { en: 'Movement Speed', zh: '移动速度' },
  movespeed_pct: { en: 'Movement Speed', zh: '移动速度', pct: true },
  movement_speed_percent_bonus: { en: 'Movement Speed', zh: '移动速度', pct: true },
  bonus_evasion: { en: 'Evasion', zh: '闪避', pct: true },
  evasion: { en: 'Evasion', zh: '闪避', pct: true },
  bonus_cast_range: { en: 'Cast Range', zh: '施法距离' },
  cast_range_bonus: { en: 'Cast Range', zh: '施法距离' },
  bonus_attack_range: { en: 'Attack Range', zh: '攻击距离' },
  attack_range: { en: 'Attack Range', zh: '攻击距离' },
  melee_attack_range: { en: 'Melee Attack Range', zh: '近战攻击距离' },
  bonus_spell_amp: { en: 'Spell Amplification', zh: '技能增强', pct: true },
  spell_amp: { en: 'Spell Amplification', zh: '技能增强', pct: true },
  bonus_lifesteal: { en: 'Lifesteal', zh: '攻击吸血', pct: true },
  attack_lifesteal: { en: 'Lifesteal', zh: '攻击吸血', pct: true },
  bonus_spell_lifesteal: { en: 'Spell Lifesteal', zh: '技能吸血', pct: true },
  spell_lifesteal: { en: 'Spell Lifesteal', zh: '技能吸血', pct: true },
  status_resistance: { en: 'Status Resistance', zh: '状态抗性', pct: true },
  slow_resist: { en: 'Slow Resistance', zh: '减速抗性', pct: true },
  slow_resistance: { en: 'Slow Resistance', zh: '减速抗性', pct: true },
  knockback_resist: { en: 'Knockback Resistance', zh: '击退抗性', pct: true },
  bonus_night_vision: { en: 'Night Vision', zh: '夜间视野' },
  bonus_gpm: { en: 'Gold Per Minute', zh: '每分钟金钱' },
  bonus_xpm: { en: 'XP Per Minute', zh: '每分钟经验' },
  cooldown_reduction: { en: 'Cooldown Reduction', zh: '冷却时间减少', pct: true },
  manacost_reduction: { en: 'Mana Cost Reduction', zh: '魔法消耗降低', pct: true },
  mana_reduction_pct: { en: 'Mana Cost Reduction', zh: '魔法消耗降低', pct: true },
  debuff_amp: { en: 'Debuff Duration', zh: '负面效果持续时间', pct: true },
  aoe_bonus: { en: 'AoE Radius', zh: '作用范围' },
  health_restoration: { en: 'Health Restoration', zh: '生命恢复增强', pct: true },
  heal_amp: { en: 'Heal Amplification', zh: '治疗增强', pct: true },
  hp_regen_amp: { en: 'Health Regen Amp', zh: '生命恢复增强', pct: true },
  item_potency: { en: 'Item Potency', zh: '物品效能', pct: true },
  bat_reduce: { en: 'Base Attack Time Reduction', zh: '基础攻击间隔降低', pct: true },
  cast_speed: { en: 'Cast Speed', zh: '施法速度', pct: true },
  cast_speed_pct: { en: 'Cast Speed', zh: '施法速度', pct: true },
  primary_stat: { en: 'Primary Attribute', zh: '主属性' },
  primary_stat_universal: { en: 'All Attributes (Universal)', zh: '全属性（全才）' },
  vision_reduce: { en: 'Vision', zh: '视野', pct: true, penalty: true },
  intelligence_pct: { en: 'Intelligence', zh: '智力', pct: true, penalty: true },
  max_mana_pct: { en: 'Max Mana', zh: '最大魔法值', pct: true, penalty: true },
  hp_regen_reduce: { en: 'Health Regen', zh: '生命恢复', penalty: true },
};

export function cleanValveText(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?\s*>|<\/h\d>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .trim();
}

export function formatStatNumbers(values = [], isPct = false, sign = '+') {
  const nums = (values || []).filter(n => typeof n === 'number' && Number.isFinite(n));
  if (!nums.length || nums.every(n => n === 0)) return '';
  const unique = [...new Set(nums)];
  const formatted = unique.map(n => {
    const rounded = Math.round(n * 100) / 100;
    const prefix = rounded < 0 ? '' : sign;
    return `${prefix}${rounded}${isPct ? '%' : ''}`;
  });
  return formatted.join(' / ');
}

export function resolveValveHeading(headingEn = '', headingZh = '') {
  const rawEn = cleanValveText(headingEn);
  const rawZh = cleanValveText(headingZh);
  const match = rawEn.match(/^([+-]?)\s*(\$[a-z0-9_]+)$/i);
  if (match) {
    const sign = match[1] || '+';
    const token = match[2].toLowerCase();
    const mapped = HEADING_TOKENS[token];
    if (mapped) return { sign, en: mapped.en, zh: mapped.zh, pct: Boolean(mapped.pct) };
  }
  const cleanLabel = str => str.replace(/^[+-]\s*/, '').replace(/[:：]\s*$/, '').trim();
  const sign = rawEn.startsWith('-') ? '-' : '+';
  const en = cleanLabel(rawEn);
  const zh = cleanLabel(rawZh) || en;
  if (!en || /^\$/.test(en)) return null;
  return { sign, en, zh, pct: false };
}

export function extractStatsFromMechanics(lesson) {
  const svs = lesson?.mechanics?.special_values || [];
  const out = [];
  const seenEn = new Set();
  for (const sv of svs) {
    const key = String(sv.name || '').toLowerCase();
    const spec = FALLBACK_SV_MAP[key];
    if (!spec || seenEn.has(spec.en)) continue;
    const sign = spec.penalty ? '-' : '+';
    const value = formatStatNumbers(sv.values || [], Boolean(spec.pct), sign);
    if (!value) continue;
    seenEn.add(spec.en);
    out.push({ value, en: spec.en, zh: spec.zh });
  }
  return out;
}

export function resolveItemDetails(lesson, detailsManifest = null) {
  if (!lesson || lesson.kind !== 'item') return { stats: [], notesEn: [], notesZh: [], loreEn: '', loreZh: '' };
  const entry = detailsManifest?.entries?.[lesson.id];
  const sameIdentity = entry && (!entry.en || entry.en === lesson.en);
  const stats = sameIdentity && entry.stats?.length ? entry.stats : extractStatsFromMechanics(lesson);
  const notesEn = sameIdentity && Array.isArray(entry.notesEn) ? entry.notesEn.filter(Boolean) : [];
  const notesZh = sameIdentity && Array.isArray(entry.notesZh) ? entry.notesZh.filter(Boolean) : [];
  const loreEn = sameIdentity ? (entry.loreEn || '') : '';
  const loreZh = sameIdentity ? (entry.loreZh || '') : '';
  return { stats, notesEn, notesZh, loreEn, loreZh };
}

// Editorial language examples, independent of patch-sensitive balance numbers.
const cues = {
  'Blink Dagger': { aliases: ['blink', '跳刀'], en: 'Wait for my Blink Dagger, then we can fight.', zh: '等我出跳刀，我们再打。' },
  'Black King Bar': { aliases: ['bkb', '黑皇杖'], en: 'My BKB is on cooldown. Wait before we fight.', zh: '我的 BKB 还在冷却，等一下再打。' },
  'Town Portal Scroll': { aliases: ['tp', 'tp scroll', '回城', '回城卷轴'], en: 'My TP is on cooldown. I cannot join yet.', zh: '我的回城还在冷却，暂时来不了。' },
  'Smoke of Deceit': { aliases: ['smoke', 'sod', '雾', '开雾'], en: 'Group up. I have smoke.', zh: '集合，我有雾。' },
  'Dust of Appearance': { aliases: ['dust', '粉', '撒粉'], en: 'Bring dust for the next fight.', zh: '下次团战带粉。' },
  'Observer Ward': { aliases: ['obs', 'ward', '假眼'], en: 'We need an observer ward near Roshan.', zh: '我们需要在肉山附近放个假眼。' },
  'Sentry Ward': { aliases: ['sentry', '真眼'], en: 'Put a sentry here, please.', zh: '请在这里放个真眼。' },
  'Tango': { aliases: ['吃树'], en: 'Can you share a Tango with me?', zh: '能分我一个吃树吗？' },
  'Healing Salve': { aliases: ['salve', '大药'], en: 'I have a salve for you.', zh: '我有个大药可以给你用。' },
  'Magic Stick': { aliases: ['stick', '小魔棒'], en: 'My stick has charges. I can stay in lane.', zh: '我的魔棒有能量，还能继续对线。' },
  'Boots of Speed': { aliases: ['boots', '鞋', '草鞋'], en: 'I need boots so I can move faster.', zh: '我需要出鞋，提高移速。' },
  'Aegis of the Immortal': { aliases: ['aegis', '不朽盾', '盾'], en: 'Let our carry take the Aegis.', zh: '让我们的一号位拿盾。' },
  'Divine Rapier': { aliases: ['rapier', '圣剑'], en: 'Protect our carry. They have a Rapier.', zh: '保护我们的一号位，他有圣剑。' },
  'Scythe of Vyse': { aliases: ['hex', '羊刀'], en: 'My Hex is ready. We can catch them.', zh: '我的羊刀好了，可以抓他们。' },
  'Boots of Travel': { aliases: ['bots', '飞鞋'], en: 'I am saving for Boots of Travel.', zh: '我正在攒钱出飞鞋。' },
  'Force Staff': { aliases: ['force', '推推', '推推棒'], en: 'Use Force Staff to help me get out.', zh: '用推推帮我脱身。' },
  "Eul's Scepter of Divinity": { aliases: ['euls', 'eul', '风杖'], en: 'My Eul’s is ready.', zh: '我的风杖好了。' },
};

const vocabulary = [
  { pattern: /\bcooldown\b/i, en: 'cooldown', zh: '冷却时间' },
  { pattern: /\bdispel\b/i, en: 'dispel', zh: '驱散' },
  { pattern: /\bchannel(?:ing|ed)?\b/i, en: 'channel', zh: '持续施法' },
  { pattern: /\bstun(?:s|ned|ning)?\b/i, en: 'stun', zh: '眩晕' },
  { pattern: /\bregeneration\b/i, en: 'regeneration', zh: '恢复' },
  { pattern: /\bmovement speed\b/i, en: 'movement speed', zh: '移动速度' },
  { pattern: /\barmor\b/i, en: 'armor', zh: '护甲' },
  { pattern: /\bdamage\b/i, en: 'damage', zh: '伤害' },
];

export function itemCoaching(lesson) {
  if (lesson.kind !== 'item') return null;
  const cue = cues[lesson.en];
  return { aliases: cue?.aliases || [],
    en: cue?.en || `I have ${lesson.en}.`,
    zh: cue?.zh || `我有${lesson.zh}。`,
    vocabulary: vocabulary.filter(word => word.pattern.test(lesson.descriptionEn || '')).slice(0, 4)
      .map(({ en, zh }) => ({ en, zh })) };
}

export const itemAliases = lesson => cues[lesson.en]?.aliases || [];

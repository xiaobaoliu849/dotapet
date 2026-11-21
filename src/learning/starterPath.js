import { quizLabelKey } from './model.js';

export const STARTER_UNITS = [
  { id: 'starter-lane', en: '1. Stay in lane', zh: '1. 认识对线补给',
    goalEn: 'Ask for healing, move faster, and tell your team when you can teleport.', goalZh: '学会要补给、说移速，以及告诉队友能否传送支援。',
    lessonIds: ['item:44', 'item:39', 'item:34', 'item:29', 'item:46'] },
  { id: 'starter-team', en: '2. See and move together', zh: '2. 做视野，一起行动',
    goalEn: 'Talk about wards, invisible enemies, smoke, and positioning.', goalZh: '学会说眼位、隐身敌人、开雾和走位。',
    lessonIds: ['item:42', 'item:43', 'item:40', 'item:188', 'item:1'] },
];

export const STARTER_ITEMS = {
  'item:44': { internalName: 'item_tango', en: 'Use it to recover health by eating a tree.', zh: '吃掉一棵树，恢复生命。' },
  'item:39': { internalName: 'item_flask', en: 'Use it to help a hero recover health.', zh: '使用后帮助英雄恢复生命。', aliases: ['salve'] },
  'item:34': { internalName: 'item_magic_stick', en: 'Use stored charges to restore health and mana.', zh: '使用储存的能量，恢复生命和魔法。', aliases: ['stick'] },
  'item:29': { internalName: 'item_boots', en: 'A basic item that increases movement speed.', zh: '增加移动速度的基础物品。', aliases: ['boots'] },
  'item:46': { internalName: 'item_tpscroll', en: 'Use it to teleport to a friendly building.', zh: '用它传送到友方建筑。', aliases: ['tp', 'tp scroll'] },
  'item:42': { internalName: 'item_ward_observer', en: 'Place this ward to see an area of the map.', zh: '放下这个眼，获得地图上一个区域的视野。', aliases: ['obs'] },
  'item:43': { internalName: 'item_ward_sentry', en: 'Helps reveal invisible enemies and enemy wards.', zh: '帮助发现隐身敌人和敌方眼位。', aliases: ['sentry'] },
  'item:40': { internalName: 'item_dust', en: 'Use it to reveal invisible enemies nearby.', zh: '使用后可以发现附近的隐身敌人。', aliases: ['dust'] },
  'item:188': { internalName: 'item_smoke_of_deceit', en: 'Helps your team move together unseen by enemy wards.', zh: '帮助队伍一起移动，避开敌方眼位的侦察。', aliases: ['smoke'] },
  'item:1': { internalName: 'item_blink', en: 'Use it to teleport a short distance and change position.', zh: '用它短距离传送，改变站位。', aliases: ['blink'] },
};

export const starterUnit = scope => STARTER_UNITS.find(unit => unit.id === scope);
export const isLearningStep = active => Number.isInteger(active?.guideIndex) && active.guideIndex < active.items.length;
export const MAX_TYPED_ANSWER_LENGTH = 80;

export function supportsTypedStarterRecall(session, item) {
  return session.options.direction === 'zh'
    && Boolean(starterUnit(session.options.scope)?.lessonIds.includes(item.lesson.id));
}

export function matchesStarterAnswer(item, answer) {
  const key = quizLabelKey(answer);
  const accepted = [item.question.answer, ...(STARTER_ITEMS[item.lesson.id]?.aliases || [])];
  return Boolean(key) && accepted.some(name => quizLabelKey(name) === key);
}

export function starterAvailability(evidence, id, lesson = null) {
  const entry = evidence?.entries?.[id];
  const matchesLesson = !lesson || (lesson.id === id && lesson.kind === 'item' && lesson.en === entry?.en
    && (!lesson.internalName || lesson.internalName === entry?.internalName));
  return matchesLesson && entry?.internalName === STARTER_ITEMS[id]?.internalName && entry?.shopListed === true && entry?.valveListed === true;
}

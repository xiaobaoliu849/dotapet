/**
 * DOTA 2 Slang & Tactical Callout Dictionary (ZH / EN / RU-CIS)
 *
 * Implements the fast-path terminology lookup described in
 * docs/COMPANION_CHINA_TRANSLATION_PLAN.md:
 * 1. Instant 0ms translation for high-frequency DOTA 2 slang & callouts
 *    (EN / RU / ZH) without waiting for cloud API calls.
 * 2. Multi-token slang phrase assembly when offline or cloud is unavailable.
 * 3. Context-aware disambiguation hints injected into Cloud LLM prompts so
 *    terms like "smoke" (开雾), "dust" (粉/显影之尘), "ss" (miss/消失),
 *    "tormentor" (痛苦魔方), or "lotus" (莲花池) are never mistranslated
 *    as literal everyday words ("抽烟", "灰尘", etc.).
 */

/**
 * High-frequency exact callouts (normalized lowercase key -> instant translation).
 * Keys cover English (SEA/EU/NA), Russian/Cyrillic (CIS/EU East), and Chinese (CN).
 */
export const INSTANT_SLANG_CALLOUTS = {
  // --- Smoke / Gank (绝不翻成“抽烟”) ---
  'smoke': {
    translated: '开雾抓人 / 偷盾',
    meaningZh: '⚡ [DOTA黑话·本地词表] smoke = 开诡计之雾（开雾抓人或偷肉山，切勿译为抽烟）',
    intent: 'strategy',
    suggestions: ['smoke ready, gather', 'wait my item then smoke', 'let us smoke rosh'],
  },
  'smk': {
    translated: '开雾抓人',
    meaningZh: '⚡ [DOTA黑话·本地词表] smk (smoke) = 开诡计之雾集结进攻',
    intent: 'strategy',
    suggestions: ['smoke ready', 'come smoke', 'wait bkb then smoke'],
  },
  'sod': {
    translated: '诡计之雾 (Smoke of Deceit)',
    meaningZh: '⚡ [DOTA黑话·本地词表] sod = 诡计之雾（开雾）',
    intent: 'strategy',
    suggestions: ['buy smoke', 'smoke now', 'care enemy smoke'],
  },
  'smoke gank': {
    translated: '开雾抓人',
    meaningZh: '⚡ [DOTA黑话·本地词表] 提议集合开诡计之雾去抓单',
    intent: 'strategy',
    suggestions: ['come smoke', 'smoke ready', 'who has smoke?'],
  },
  'smoke rosh': {
    translated: '开雾偷肉山',
    meaningZh: '⚡ [DOTA黑话·本地词表] 提议开诡计之雾直接进肉山坑打盾',
    intent: 'strategy',
    suggestions: ['smoke rosh now', 'buy smoke for rosh', 'ward before rosh'],
  },
  'care smoke': {
    translated: '小心对面开雾！',
    meaningZh: '⚡ [DOTA黑话·本地词表] 警告队友敌方可能正在开雾抓人，注意站位或退后',
    intent: 'request',
    suggestions: ['b b b', 'stay high ground', 'stick together'],
  },
  'смок': {
    translated: '开雾（俄服黑话 смок = smoke）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 смок = 开诡计之雾抓人/打盾',
    intent: 'strategy',
    suggestions: ['go smoke', 'smoke ready', 'wait bkb'],
  },
  'го смок': {
    translated: '来开雾走起（俄服 го смок = go smoke）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 го смок = 集合开雾出击',
    intent: 'strategy',
    suggestions: ['ok go smoke', 'coming', 'wait me'],
  },

  // --- Roshan & Aegis ---
  'rosh': {
    translated: '打肉山 / 注意肉山',
    meaningZh: '⚡ [DOTA黑话·本地词表] rosh = 肉山（提议打肉山拿不朽盾，或提醒防范敌方打盾）',
    intent: 'strategy',
    suggestions: ['go rosh now', 'smoke rosh', 'check rosh pit'],
  },
  'rs': {
    translated: '打肉山 (Roshan)',
    meaningZh: '⚡ [DOTA黑话·本地词表] rs = 东南亚/国服常用缩写，指打肉山 (Roshan)',
    intent: 'strategy',
    suggestions: ['go rs now', 'care rs', 'take aegis'],
  },
  'roshan': {
    translated: '肉山 (Roshan)',
    meaningZh: '⚡ [DOTA黑话·本地词表] roshan = 肉山，击杀掉落不朽之守护（盾）',
    intent: 'strategy',
    suggestions: ['go rosh now', 'check rosh', 'wait rosh respawn'],
  },
  'aegis': {
    translated: '不朽盾 (Aegis)',
    meaningZh: '⚡ [DOTA黑话·本地词表] aegis = 不朽之守护（肉山盾，5分钟有效）',
    intent: 'info',
    suggestions: ['push with aegis', 'aegis expiring soon', 'take aegis'],
  },
  'рош': {
    translated: '打肉山（俄服 рош = Roshan）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 рош = 肉山 (Roshan)',
    intent: 'strategy',
    suggestions: ['go rosh', 'smoke rosh', 'care rosh'],
  },
  'го рош': {
    translated: '走，去打肉山！（俄服 го рош = go rosh）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 го рош = 集合去打肉山拿盾',
    intent: 'strategy',
    suggestions: ['go rosh now', 'coming rosh', 'ward rosh first'],
  },

  // --- Missing / Lane Callouts (ss / mia) ---
  'ss': {
    translated: '线上敌人消失 (Missing)！小心被抓',
    meaningZh: '⚡ [DOTA黑话·本地词表] ss = Miss / Missing（对线敌方英雄不见了，小心被游走 Gank）',
    intent: 'request',
    suggestions: ['careful guys', 'ty for ss', 'b b b'],
  },
  'ss mid': {
    translated: '中路敌人不见了！注意防Gank',
    meaningZh: '⚡ [DOTA黑话·本地词表] ss mid = 中路敌方英雄消失，边路小心被游走',
    intent: 'request',
    suggestions: ['care mid', 'playing safe', 'tp ready'],
  },
  'ss top': {
    translated: '上路敌人不见了！小心游走',
    meaningZh: '⚡ [DOTA黑话·本地词表] ss top = 上路敌方英雄消失',
    intent: 'request',
    suggestions: ['care', 'b b b', 'thanks'],
  },
  'ss bot': {
    translated: '下路敌人不见了！小心游走',
    meaningZh: '⚡ [DOTA黑话·本地词表] ss bot = 下路敌方英雄消失',
    intent: 'request',
    suggestions: ['care', 'b b b', 'thanks'],
  },
  'mia': {
    translated: '敌人消失 (Missing in Action)',
    meaningZh: '⚡ [DOTA黑话·本地词表] mia = 线上敌方英雄不见了，注意防守',
    intent: 'request',
    suggestions: ['careful', 'b b b', 'ty'],
  },
  'miss': {
    translated: '线上敌人消失 (Miss)',
    meaningZh: '⚡ [DOTA黑话·本地词表] miss = 线上看不见人，小心被抓',
    intent: 'request',
    suggestions: ['careful', 'b b b', 'ty'],
  },
  'сс': {
    translated: '敌人消失！（俄服 сс = ss / miss）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 сс = 线上敌方英雄消失，小心被抓',
    intent: 'request',
    suggestions: ['ok care', 'b b b', 'ty'],
  },
  'сс мид': {
    translated: '中路不见了！（俄服 сс мид = ss mid）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 сс мид = 中路英雄消失，小心被抓',
    intent: 'request',
    suggestions: ['ok care', 'b b b', 'ty'],
  },

  // --- Retreat / Danger ---
  'b': {
    translated: '撤退！(Back)',
    meaningZh: '⚡ [DOTA黑话·本地词表] b = Get back（立刻撤退，别恋战！）',
    intent: 'request',
    suggestions: ['b b b', 'coming back', 'dont fight'],
  },
  'b b': {
    translated: '快撤退！(Get back)',
    meaningZh: '⚡ [DOTA黑话·本地词表] 连续发 b = 紧急撤退信号！',
    intent: 'request',
    suggestions: ['b b b', 'backing now', 'careful'],
  },
  'b b b': {
    translated: '赶紧撤退！危险！',
    meaningZh: '⚡ [DOTA黑话·本地词表] b b b = 最高优先级紧急撤退信号，对面来抓或没技能了',
    intent: 'request',
    suggestions: ['backing!', 'dont dive', 'run'],
  },
  'back': {
    translated: '撤退 (Get back)',
    meaningZh: '⚡ [DOTA黑话·本地词表] back = 撤退，不要深追',
    intent: 'request',
    suggestions: ['b b b', 'ok backing', 'stay safe'],
  },
  'get back': {
    translated: '立刻撤退！',
    meaningZh: '⚡ [DOTA黑话·本地词表] get back = 赶紧后撤',
    intent: 'request',
    suggestions: ['b b b', 'ok backing', 'care'],
  },
  'назад': {
    translated: '撤退！（俄服 назад = get back）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 назад = 撤退，别上了',
    intent: 'request',
    suggestions: ['b b b', 'ok', 'backing'],
  },

  // --- Key Items & Objectives ---
  'bkb': {
    translated: '黑皇杖 (BKB 魔免)',
    meaningZh: '⚡ [DOTA黑话·本地词表] bkb = 黑皇杖（开启获得技能免疫，团战核心装）',
    intent: 'info',
    suggestions: ['wait my bkb', 'bkb on cd', 'they used bkb'],
  },
  'no bkb': {
    translated: '没BKB / 对面BKB没好',
    meaningZh: '⚡ [DOTA黑话·本地词表] no bkb = BKB 处于冷却或尚未做出，注意拉扯',
    intent: 'info',
    suggestions: ['wait bkb cd', 'go now they no bkb', 'play safe'],
  },
  'бкб': {
    translated: '黑皇杖 BKB（俄服 бкб）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 бкб = 黑皇杖 (BKB)',
    intent: 'info',
    suggestions: ['wait bkb', 'my bkb ready', 'bkb cd'],
  },
  'dust': {
    translated: '显影之尘（带粉抓隐身，绝非灰尘）',
    meaningZh: '⚡ [DOTA黑话·本地词表] dust = 显影之尘（俗称“粉”，用来反隐身英雄，切勿译为灰尘）',
    intent: 'request',
    suggestions: ['i have dust', 'buy dust pls', 'carry dust'],
  },
  'buy dust': {
    translated: '请买粉（显影之尘）反隐！',
    meaningZh: '⚡ [DOTA黑话·本地词表] 提醒队友购买显影之尘克制敌方隐身英雄或微光/隐刀',
    intent: 'request',
    suggestions: ['i bought dust', 'buying dust now', 'need sentry too'],
  },
  'даст': {
    translated: '带粉 / 显影之尘（俄服 даст = dust）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 даст = 显影之尘（反隐粉）',
    intent: 'request',
    suggestions: ['i have dust', 'buy dust', 'ok'],
  },
  'tormentor': {
    translated: '打痛苦魔方（拿免费魔晶）',
    meaningZh: '⚡ [DOTA黑话·本地词表] tormentor = 痛苦魔方（20分钟刷新，击杀送全队阿哈利姆魔晶）',
    intent: 'strategy',
    suggestions: ['do tormentor now', 'gather tormentor', 'wait 5 for tormentor'],
  },
  'torm': {
    translated: '打痛苦魔方 (Tormentor)',
    meaningZh: '⚡ [DOTA黑话·本地词表] torm = 痛苦魔方缩写，提议集合打魔晶',
    intent: 'strategy',
    suggestions: ['go tormentor', 'come torm', 'need heal for torm'],
  },
  'терзатель': {
    translated: '打痛苦魔方（俄服 терзатель = Tormentor）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 терзатель = 痛苦魔方（击杀掉落魔晶）',
    intent: 'strategy',
    suggestions: ['go tormentor', 'coming', 'wait me'],
  },
  'wisdom': {
    translated: '抢智慧神符（7分钟经验符）',
    meaningZh: '⚡ [DOTA黑话·本地词表] wisdom = 智慧神符（每7分钟劣势路外侧刷新，提供巨额经验）',
    intent: 'strategy',
    suggestions: ['take wisdom rune', 'contest enemy wisdom', '7 min wisdom'],
  },
  'lotus': {
    translated: '采莲花池 / 清莲宝珠',
    meaningZh: '⚡ [DOTA黑话·本地词表] lotus = 边路莲花池（每3分钟刷新回血回蓝莲花）或装备清莲宝珠',
    intent: 'info',
    suggestions: ['take lotus', 'lotus ready', 'care lotus pool'],
  },
  'tp': {
    translated: '回城卷轴支援 (TP)',
    meaningZh: '⚡ [DOTA黑话·本地词表] tp = Town Portal Scroll（回城卷轴，请求传送支援或提醒带TP）',
    intent: 'request',
    suggestions: ['tp ready', 'no tp sorry', 'tp mid pls'],
  },
  'тп': {
    translated: 'TP传送支援（俄服 тп = TP）',
    meaningZh: '⚡ [DOTA黑话·本地词表] 俄语 тп = 回城卷轴传送',
    intent: 'request',
    suggestions: ['tp ready', 'no tp cd', 'coming'],
  },
  'hg': {
    translated: '高地 (High Ground)',
    meaningZh: '⚡ [DOTA黑话·本地词表] hg = 高地（push hg = 上高地，def hg = 守高地）',
    intent: 'strategy',
    suggestions: ['wait aegis before hg', 'dont dive hg', 'push hg now'],
  },
  'rax': {
    translated: '兵营 (Barracks)',
    meaningZh: '⚡ [DOTA黑话·本地词表] rax = 高地近战/远程兵营，拆掉出超级兵',
    intent: 'strategy',
    suggestions: ['hit rax only', 'take rax then b', 'mega creeps'],
  },
  'bb': {
    translated: '买活 (Buyback)',
    meaningZh: '⚡ [DOTA黑话·本地词表] bb = Buyback（买活复活，或 save bb 留钱买活）',
    intent: 'info',
    suggestions: ['save for bb', 'i have bb', 'they no bb'],
  },
  'no bb': {
    translated: '没有买活 (No Buyback)',
    meaningZh: '⚡ [DOTA黑话·本地词表] no bb = 没钱买活或买活在冷却中（敌方死后无法买活可一波）',
    intent: 'strategy',
    suggestions: ['end now they no bb', 'care i have no bb', 'push throne'],
  },
  'oom': {
    translated: '没蓝了 / 空蓝 (Out of Mana)',
    meaningZh: '⚡ [DOTA黑话·本地词表] oom = Out of Mana（没蓝放技能了，别强开团）',
    intent: 'info',
    suggestions: ['no mana b', 'use arcane boots', 'wait mana'],
  },
  'rat': {
    translated: '带线偷塔 (Rat Dota)',
    meaningZh: '⚡ [DOTA黑话·本地词表] rat = 避战带线偷塔牵制（切勿译为老鼠）',
    intent: 'strategy',
    suggestions: ['split push', 'carry tp for rat', 'defend base'],
  },
  'stack': {
    translated: '屯野 / 拉双野',
    meaningZh: '⚡ [DOTA黑话·本地词表] stack = 在整分钟前把野怪拉出野点屯双倍野怪',
    intent: 'request',
    suggestions: ['stack ancients pls', 'thanks for stack', 'taking stacks'],
  },
  'pull': {
    translated: '拉野控线',
    meaningZh: '⚡ [DOTA黑话·本地词表] pull = 拉小野融合兵线，把兵线控回己方塔前',
    intent: 'request',
    suggestions: ['pull lane pls', 'pulling now', 'block enemy camp'],
  },
  'deward': {
    translated: '反眼 / 排眼',
    meaningZh: '⚡ [DOTA黑话·本地词表] deward = 用真眼/宝石排掉敌方视野（假眼）',
    intent: 'request',
    suggestions: ['deward cliff pls', 'enemy ward here', 'buying sentries'],
  },

  // --- Chinese Tactical Short Calls -> Instant English (F8 in-game ready) ---
  '开雾': {
    translated: 'smoke now',
    meaningZh: '⚡ [DOTA黑话·本地词表] 开雾 -> smoke now（召集队友开诡计之雾）',
    intent: 'strategy',
    suggestions: ['smoke and gank', 'smoke rosh', 'gather for smoke'],
  },
  '来开雾': {
    translated: 'come smoke',
    meaningZh: '⚡ [DOTA黑话·本地词表] 来开雾 -> come smoke',
    intent: 'strategy',
    suggestions: ['smoke ready', 'group up for smoke', 'smoke rosh'],
  },
  '打肉': {
    translated: 'go rosh now',
    meaningZh: '⚡ [DOTA黑话·本地词表] 打肉 -> go rosh now',
    intent: 'strategy',
    suggestions: ['smoke rosh', 'rosh now', 'take aegis'],
  },
  '打肉山': {
    translated: 'go rosh now',
    meaningZh: '⚡ [DOTA黑话·本地词表] 打肉山 -> go rosh now',
    intent: 'strategy',
    suggestions: ['smoke rosh', 'check rosh pit', 'take aegis'],
  },
  '偷肉': {
    translated: 'smoke rosh',
    meaningZh: '⚡ [DOTA黑话·本地词表] 偷肉 -> smoke rosh',
    intent: 'strategy',
    suggestions: ['sneak rosh now', 'go rosh fast', 'ward rosh'],
  },
  '打魔方': {
    translated: 'do tormentor now',
    meaningZh: '⚡ [DOTA黑话·本地词表] 打魔方 -> do tormentor now（集合打痛苦魔方拿魔晶）',
    intent: 'strategy',
    suggestions: ['come tormentor', 'group for tormentor', '20 min tormentor'],
  },
  '痛苦魔方': {
    translated: 'do tormentor',
    meaningZh: '⚡ [DOTA黑话·本地词表] 痛苦魔方 -> do tormentor',
    intent: 'strategy',
    suggestions: ['do tormentor now', 'come torm', 'take shard'],
  },
  '带粉': {
    translated: 'buy dust pls',
    meaningZh: '⚡ [DOTA黑话·本地词表] 带粉 -> buy dust pls（买显影之尘抓隐身）',
    intent: 'request',
    suggestions: ['carry dust', 'need dust for invis', 'i have dust'],
  },
  '买粉': {
    translated: 'buy dust pls',
    meaningZh: '⚡ [DOTA黑话·本地词表] 买粉 -> buy dust pls',
    intent: 'request',
    suggestions: ['carry dust', 'need sentry and dust', 'i have dust'],
  },
  '中路miss': {
    translated: 'ss mid',
    meaningZh: '⚡ [DOTA黑话·本地词表] 中路miss -> ss mid',
    intent: 'request',
    suggestions: ['mid mia care', 'care mid gank', 'b b b'],
  },
  '上高': {
    translated: 'push high ground',
    meaningZh: '⚡ [DOTA黑话·本地词表] 上高 -> push high ground',
    intent: 'strategy',
    suggestions: ['push hg with aegis', 'hit rax only', 'group up push hg'],
  },
  '没蓝': {
    translated: 'no mana, b',
    meaningZh: '⚡ [DOTA黑话·本地词表] 没蓝 -> no mana, b',
    intent: 'info',
    suggestions: ['oom wait', 'need mana', 'dont fight no mana'],
  },
  '抢经验符': {
    translated: 'take wisdom rune',
    meaningZh: '⚡ [DOTA黑话·本地词表] 抢经验符 -> take wisdom rune',
    intent: 'strategy',
    suggestions: ['contest 7m wisdom rune', 'steal enemy wisdom', 'wisdom rune soon'],
  },
};

/**
 * Multi-language token glossary (EN / RU -> ZH explanation) for compound slang
 * sentences and LLM prompt disambiguation.
 *
 * Uses Unicode-aware boundaries `(?<![\p{L}\p{N}_])...(?![\p{L}\p{N}_])` with `/iu`
 * so Cyrillic slang terms like "рош", "сс", "тп", "хг", "кд" match inside Russian
 * sentences ("го сс мид", "дай тп") without false-matching inside normal Russian
 * words like "хорошо" (which contains "рош").
 */
export const SLANG_TOKEN_GLOSSARY = [
  { pattern: /(?<![\p{L}\p{N}_])(?:smoke|smk|sod|смок|смоки)(?![\p{L}\p{N}_])/iu, term: 'smoke/смок', zh: '开雾（使用诡计之雾突袭/抓人/偷盾，绝非“抽烟”）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:rosh|roshan|rs|рош|рошан)(?![\p{L}\p{N}_])/iu, term: 'rosh/rs/рош', zh: '肉山 (Roshan)' },
  { pattern: /(?<![\p{L}\p{N}_])(?:aegis|аегис)(?![\p{L}\p{N}_])/iu, term: 'aegis', zh: '不朽之守护（肉山盾）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:ss|mia|miss|сс|мисс)(?![\p{L}\p{N}_])/iu, term: 'ss/mia/miss', zh: '线上敌人消失（小心被游走Gank）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:bkb|бкб)(?![\p{L}\p{N}_])/iu, term: 'bkb/бкб', zh: '黑皇杖（BKB技能免疫）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:dust|даст)(?![\p{L}\p{N}_])/iu, term: 'dust/даст', zh: '显影之尘（反隐用的“粉”，绝非“灰尘”）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:tormentor|torm|терзатель)(?![\p{L}\p{N}_])/iu, term: 'tormentor/torm', zh: '痛苦魔方（20分钟刷新，击杀得魔晶，绝非“折磨者”）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:wisdom(?:\s+rune)?|руна мудрости)(?![\p{L}\p{N}_])/iu, term: 'wisdom', zh: '智慧神符（7分钟经验符）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:lotus|лотос)(?![\p{L}\p{N}_])/iu, term: 'lotus', zh: '莲花池（3分钟恢复莲花）或清莲宝珠' },
  { pattern: /(?<![\p{L}\p{N}_])(?:hg|high\s*ground|хг)(?![\p{L}\p{N}_])/iu, term: 'hg/high ground', zh: '高地（上高/守高）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:rax|barracks|бараки)(?![\p{L}\p{N}_])/iu, term: 'rax', zh: '高地兵营' },
  { pattern: /(?<![\p{L}\p{N}_])(?:bb|buyback|байбэк)(?![\p{L}\p{N}_])/iu, term: 'bb/buyback', zh: '买活' },
  { pattern: /(?<![\p{L}\p{N}_])(?:tp|тп)(?![\p{L}\p{N}_])/iu, term: 'tp/тп', zh: '回城卷轴（TP支援）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:oom|no\s*mana|нет маны)(?![\p{L}\p{N}_])/iu, term: 'oom', zh: '没蓝 / 空蓝 (Out of Mana)' },
  { pattern: /(?<![\p{L}\p{N}_])rat(?![\p{L}\p{N}_])/iu, term: 'rat', zh: '带线偷塔牵制 (Rat Dota，绝非“老鼠”)' },
  { pattern: /(?<![\p{L}\p{N}_])(?:stack|стак)(?![\p{L}\p{N}_])/iu, term: 'stack', zh: '屯野 / 拉双野' },
  { pattern: /(?<![\p{L}\p{N}_])(?:pull|пулл)(?![\p{L}\p{N}_])/iu, term: 'pull', zh: '拉野控线' },
  { pattern: /(?<![\p{L}\p{N}_])(?:deward|obs|sentry|девард|вард|сентри)(?![\p{L}\p{N}_])/iu, term: 'deward/obs/sentry', zh: '反眼 / 假眼 / 真眼' },
  { pattern: /(?<![\p{L}\p{N}_])(?:gem|гем)(?![\p{L}\p{N}_])/iu, term: 'gem', zh: '真视宝石' },
  { pattern: /(?<![\p{L}\p{N}_])(?:blink|dagger|блинк)(?![\p{L}\p{N}_])/iu, term: 'blink/dagger', zh: '闪烁匕首（跳刀）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:aghs|scepter|shard|аганим|шард)(?![\p{L}\p{N}_])/iu, term: 'aghs/shard', zh: 'A杖（阿哈利姆神杖）/ 魔晶' },
  { pattern: /(?<![\p{L}\p{N}_])(?:hex|vyse|хекс)(?![\p{L}\p{N}_])/iu, term: 'hex/vyse', zh: '羊刀（邪镰）' },
  { pattern: /(?<![\p{L}\p{N}_])(?:cd|кд)(?![\p{L}\p{N}_])/iu, term: 'cd/кд', zh: '冷却时间 (Cooldown)' },
  // Chinese slang disambiguation for ZH -> EN
  { pattern: /开雾|诡计之雾/, term: '开雾', zh: '英文必译为 smoke / smoke of deceit（切勿译为 smoking）' },
  { pattern: /买粉|带粉|显影之尘/, term: '带粉/买粉', zh: '英文必译为 buy dust / carry dust（切勿译为 powder/flour）' },
  { pattern: /痛苦魔方|打魔方|魔方/, term: '痛苦魔方/魔方', zh: '英文必译为 tormentor（切勿译为 rubik cube）' },
  { pattern: /肉山|打肉|偷盾|不朽盾/, term: '肉山/盾', zh: '英文必译为 rosh / aegis（切勿译为 meat mountain）' },
  { pattern: /上高|高地/, term: '上高/高地', zh: '英文必译为 push high ground / hg' },
  { pattern: /买活|没买|有买/, term: '买活', zh: '英文必译为 buyback / no bb / have bb' },
  { pattern: /拉野|屯野|封野/, term: '拉野/屯野/封野', zh: '英文必译为 pull creeps / stack camps / block camp' },
];

const MAX_SLANG_HINTS = 8;

/**
 * Normalize input text for exact dictionary lookup:
 * strips trailing punctuation (!, ?, ., ~, ！, ？, 。) and collapses spaces.
 */
export function normalizeSlangKey(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[!?.~！？。，,、]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fast-path 0ms lookup for exact DOTA 2 slang callouts.
 * Preserves question-mark intent ("rosh?" vs "rosh", "开雾？" vs "开雾")
 * instead of silently flattening questions into declarative statements.
 */
export function matchInstantSlang(text, commandPrefix = '', rawText = text) {
  const trimmed = String(text || '').trim();
  const isQuestion = /[?？]+$/.test(trimmed);
  const key = normalizeSlangKey(trimmed);
  if (!key) return null;
  const hit = INSTANT_SLANG_CALLOUTS[key];
  if (!hit) return null;

  const isChineseInput = /[一-龥]/.test(trimmed);
  let translated = hit.translated;
  let meaningZh = hit.meaningZh;

  if (isQuestion) {
    if (isChineseInput) {
      translated = translated.replace(/[!?.]+$/, '') + '?';
    } else {
      translated = `询问：${translated.replace(/[！!。]+$/, '')}？`;
      meaningZh = `${meaningZh}（队友带问号询问状态/是否行动）`;
    }
  }

  return {
    original: rawText,
    commandPrefix,
    translated,
    meaningZh,
    intent: hit.intent,
    suggestions: [...hit.suggestions],
    instantSlang: true,
  };
}

/**
 * Scans a sentence for DOTA 2 slang tokens and builds a concise disambiguation
 * prompt note for Cloud LLMs so terms like "smoke", "dust", "tormentor", "ss"
 * are never mistranslated literally. Caps at MAX_SLANG_HINTS to avoid prompt bloat.
 */
export function buildSlangGlossaryHint(text) {
  if (!text || typeof text !== 'string') return '';
  const matched = [];
  for (const item of SLANG_TOKEN_GLOSSARY) {
    if (item.pattern.test(text)) {
      matched.push(`- ${item.term}: ${item.zh}`);
      if (matched.length >= MAX_SLANG_HINTS) break;
    }
  }
  if (matched.length === 0) return '';
  return `\n【DOTA 2 黑话强制术语对照（严禁按日常字面误译）】\n${matched.join('\n')}`;
}

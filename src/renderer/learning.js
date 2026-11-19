import { recordedAudio } from '../learning/audioAssets.js';
import { audioFreshness } from '../learning/contentAudit.js';
import { createLearningAudio } from './learning-audio.js';
import { filterLessons } from '../learning/model.js';
import { itemImageSources } from '../learning/itemImages.js';
import { itemCoaching } from '../learning/itemCoaching.js';
import {
  SHOP_REALMS, SHOP_SHELVES, SHOP_CATEGORIES, CATEGORY_BY_KEY,
  isActiveItem, classifyItem, realmCounts, groupItemsByCategory, searchShopItems,
} from '../learning/itemShop.js';
import { summarizeMastery } from '../learning/mastery.js';
import { SPOKEN_CATEGORIES, SPOKEN_PHRASES } from '../learning/spokenPhrases.js';
import { buildHeroPracticePersona, buildPhrasePracticePersona } from '../learning/voicePractice.js';
import { localDay, reviewCounts, STUDY_DEFAULTS } from '../learning/study.js';
import { STARTER_UNITS, STARTER_ITEMS, starterUnit, starterAvailability, isLearningStep } from '../learning/starterPath.js';
const api = window.learningAPI;
const $ = id => document.getElementById(id);
const chinese = window.dotapetI18n?.language === 'zh';
const text = (en, zh) => chinese ? zh : en;
const labels = { hero: text('Hero', '英雄'), ability: text('Hero ability', '英雄技能'), item: text('Item', '物品'), phrase: text('Team expression', '团队表达') };
const translations = {
  heading: '玩懂刀塔，开口说英语。', intro: '每天一点刀塔英语，桌面小伙伴一直陪着你。', 'total-label': '条双语课程', 'saved-label': '个收藏词条', 'due-label': '条待复习', 'accuracy-label': '答题正确率',
  'heroes-tab': '英雄图鉴', 'items-tab': '物品图鉴', 'phrases-tab': '实战口语', browse: '探索课程', saved: '我的词本', quiz: '练习测验', 'search-label': '查找课程', 'kind-label': '学习主题', 'direction-label': '练习方向', next: '下一题 →', more: '加载更多',
  'hero-back': '← 返回四属性英雄墙', 'hero-abilities-heading': '英雄技能（中英双语对照）',
  'path-heading': '看图认物 → 读懂英文 → 开口说 → 回忆巩固', 'path-help': '先认图片、读英文，再大声说一句实战表达，最后用五道题巩固记忆。',
  'quick-practice': '练习 5 条课程 →', 'recall-help': '先大声说出答案，再选择。物品图片可以帮助你回忆。',
  'starter-tab': '从这里开始', 'starter-heading': '先学会十个常见物品名', 'starter-help': '每次学五个词。先看图、读含义、说一句实战表达，再回忆英文。这是英语学习顺序，不是游戏出装顺序。',
  'guide-heading': '先认识，再回忆', 'guide-help': '看图，读懂含义，再大声说出实战表达。准备好后点击下一步。学习卡本身不计答题正确率。', 'guide-next': '下一张学习卡 →',
  'voice-bar-hint': '实时对话与双语字幕已同步显示在桌面伙伴「实时对话转写」面板中。',
  'study-heading': '每日学习小课', 'study-help': '先复习到期的错题和旧词，再学习新词。', 'size-label': '每轮课程数量', 'scope-label': '练习词库', 'start-session': '开始学习 →', 'practice-saved': '练习我的收藏词条 →', 'summary-heading': '本轮学习完成', 'mistakes-heading': '需要再看看的词条', 'new-session': '安排下一轮 →',
  'audio-source': '音频使用你的双语词典中已生成的 AI 录音，按原速播放。历史录音可能与当前课程文字不同；缺少录音的词条会明确标注。',
  'sources-heading': '让知识保持更新', freshness: '技能说明是有日期的数据快照。数值和机制请以官方更新日志为准。', refresh: '从 Valve 更新课程', patches: '官方更新日志 ↗',
};
if (chinese) {
  for (const [id, value] of Object.entries(translations)) $(id).textContent = value;
  const names = ['全部主题', '英雄', '英雄技能', '物品', '团队表达'];
  [...$('kind').options].forEach((option, index) => { option.textContent = names[index]; });
  [...$('session-size').options].forEach(option => { option.textContent = option.value + ' 条课程'; });
  [...$('session-scope').options].forEach((option, index) => { option.textContent = ['符合筛选的全部课程', '仅收藏词条', '入门：对线补给', '入门：视野与行动'][index]; });
  $('search').placeholder = '搜索英文 / 中文 / 英雄名…';
}
let catalog, heroMeta = {}, progress = {}, study = { preferences: STUDY_DEFAULTS, active: null, history: [] }, mode = 'starter', limit = 24;
let selectedHeroId = null, attrFilter = 'all', spokenFilter = 'all';
let itemRealm = 'shop', itemCategory = 'all', itemQuickFilter = 'all', itemViewMode = 'grid', selectedItemId = null;
let visibleShopItems = [];
let audioManifest = { entries: {} };
let itemImages = { entries: {} };
let itemShopCategories = { entries: {} };
let starterEvidence = { entries: {} };
let audioBaseline = { entries: {} };
let pendingAnswer = false, starting = false, feedbackIndex = null, planning = false, advancing = false;
const ATTR_GROUPS = [
  { key: 'uni', en: 'Universal', zh: '全才', icon: '🟡' },
  { key: 'int', en: 'Intelligence', zh: '智力', icon: '🔵' },
  { key: 'str', en: 'Strength', zh: '力量', icon: '🔴' },
  { key: 'agi', en: 'Agility', zh: '敏捷', icon: '🟢' },
];
const heroAttr = lesson => heroMeta[lesson.en.toLowerCase()]?.attribute || 'str';
const heroPhoto = lesson => heroMeta[lesson.en.toLowerCase()]?.photoUrl || '';
const heroInitials = en => en.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const heroAbilities = hero => catalog.lessons.filter(l => l.kind === 'ability' && l.parent === `${hero.en} · ${hero.zh}`);
function heroAvatarNode(hero, large = false) {
  const attrKey = heroAttr(hero);
  const url = heroPhoto(hero);
  const fallback = () => node('span', heroInitials(hero.en), `hero-crest ${large ? 'hero-crest-lg ' : ''}attr-${attrKey}`);
  if (!url) return fallback();
  const wrap = node('span', '', `hero-portrait-wrap${large ? ' hero-portrait-lg' : ''}`);
  const img = document.createElement('img');
  img.src = url;
  img.alt = hero.en;
  img.loading = 'lazy';
  img.className = 'hero-portrait';
  img.onerror = () => { wrap.replaceWith(fallback()); };
  wrap.append(img);
  return wrap;
}
const node = (tag, value, className) => { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; };
function selection() { return filterLessons(catalog.lessons, { kind: $('kind').value, search: $('search').value, saved: mode === 'saved', progress }); }
function syncMasteryActive() {
  const strip = $('mastery-strip');
  if (!strip) return;
  for (const card of strip.querySelectorAll('.mastery-card')) {
    const key = card.dataset.masteryKey;
    const isActive = (key === 'hero' && mode === 'heroes')
      || (key === 'item' && mode === 'items')
      || (key === 'phrase' && mode === 'phrases')
      || (key === 'ability' && mode === 'browse' && $('kind').value === 'ability');
    card.setAttribute('aria-pressed', String(isActive));
  }
}
function stats() {
  $('total').textContent = catalog.lessons.length.toLocaleString();
  $('saved-count').textContent = catalog.lessons.filter(r => progress[r.id]?.saved).length;
  const counts = reviewCounts(catalog.lessons, progress);
  $('due-count').textContent = counts.reviews;
  $('path-status').textContent = text(`${counts.reviews} reviews due · ${counts.unseen} new lessons to explore`, `${counts.reviews} 条旧词待复习 · ${counts.unseen} 条新课程可探索`);
  quickLabel();
  const records = Object.values(progress), attempts = records.reduce((n, r) => n + (r.attempts || 0), 0);
  $('accuracy').textContent = attempts ? Math.round(records.reduce((n, r) => n + (r.correct || 0), 0) / attempts * 100) + '%' : '—';
  $('source').textContent = `${catalog.sourceLabel} · ${new Date(catalog.fetchedAt).toLocaleString()} · ${catalog.patch || text('Patch number unverified', '未核验版本号')}`;
  const strip = $('mastery-strip');
  if (strip) {
    strip.replaceChildren();
    for (const item of summarizeMastery(catalog.lessons, progress)) {
      const card = node('button', '', 'mastery-card');
      card.type = 'button';
      card.dataset.masteryKey = item.key;
      const top = node('div', '', 'mastery-card-top');
      top.append(node('span', `${item.icon} ${text(item.en, item.zh)}`, 'mastery-title'), node('span', `${item.practiced}/${item.total}`, 'mastery-count'));
      const bar = node('div', '', 'mastery-bar');
      const fill = node('div', '', 'mastery-fill');
      fill.style.width = `${Math.max(item.pct, item.practiced > 0 ? 4 : 0)}%`;
      bar.append(fill);
      const sub = node('span', text(`${item.mastered} mastered · ${item.saved} saved`, `已掌握 ${item.mastered} · 收藏 ${item.saved}`), 'mastery-sub');
      card.append(top, bar, sub);
      card.onclick = () => {
        player.stop();
        if (item.key === 'hero') { mode = 'heroes'; selectedHeroId = null; }
        else if (item.key === 'item') { mode = 'items'; }
        else if (item.key === 'phrase') { mode = 'phrases'; }
        else { mode = 'browse'; $('kind').value = item.key; limit = 24; }
        render();
      };
      strip.append(card);
    }
    syncMasteryActive();
  }
}
async function persist(id, action, value) {
  const response = await api.save(id, action, value);
  if (!response.ok) throw new Error(response.error);
  progress = response.progress; stats();
}
const player = createLearningAudio({ onChange: ({ id, status }) => {
  for (const button of document.querySelectorAll('[data-audio-id]')) {
    if (button.dataset.audioId !== id) continue;
    const active = status === 'loading' || status === 'playing';
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? text('■ Stop recording', '■ 停止播放') : button.dataset.audioLabel;
    button.dataset.audioState = status;
  }
  $('audio-status').hidden = status !== 'error';
  $('audio-status').textContent = status === 'error' ? text('The recording could not be played. Please try again.', '录音播放失败，请重试。') : '';
} });
function audioButton(lesson) {
  const entry = recordedAudio(audioManifest, lesson);
  const freshness = audioFreshness(entry, lesson, audioBaseline);
  const changed = freshness.status === 'baseline-changed', extraContext = freshness.status === 'baseline-extra-context', unresolved = freshness.status === 'unresolved-current', needsStats = freshness.status === 'needs-stats-template';
  const label = !entry ? text('No recording yet', '暂无录音') : changed ? text('▶ Archive · text changed', '▶ 历史录音 · 文字有变') : extraContext ? text('▶ Archive · extra notes', '▶ 历史录音 · 含额外说明') : needsStats ? text('▶ Archive · check stats', '▶ 历史录音 · 属性待核验') : unresolved ? text('▶ Archive · check values', '▶ 历史录音 · 数值待核验') : entry.content === 'biography' ? text('▶ Hero story', '▶ 英雄故事') : entry.content === 'expression' ? text('▶ Play expression', '▶ 播放表达') : text('▶ AI recording', '▶ AI 录音');
  const button = node('button', label);
  button.className = 'recording-button'; button.disabled = !entry;
  if (entry) {
    button.dataset.audioId = lesson.id; button.dataset.audioLabel = label;
    button.dataset.audioFreshness = freshness.status;
    button.setAttribute('aria-pressed', 'false');
    button.title = changed ? text('The current explanation differs from the archived source. Treat this recording as historical; use current text for gameplay.', '当前说明与历史来源文字不同。此录音作为历史内容，游戏机制请以当前文字为准。') : extraContext ? text('The main explanation matches the archived source, but extra notes and stats still need review.', '主要说明与历史来源一致，额外备注和数值仍需核验。') : needsStats ? text('The current item source has attributes without a written explanation. This recording needs a separate stats check.', '当前物品来源提供属性，未提供文字说明；此录音需要单独核验属性。') : unresolved ? text('Some current values could not be resolved. Check the game before relying on recorded numbers.', '部分当前数值尚未解析，请在游戏中确认后再采用录音中的数字。') : text('Archived AI recording. Matching source text does not verify the MP3 transcript.', '历史 AI 录音。来源文字相同不代表已经核验 MP3 的实际台词。');
    button.onclick = () => player.toggle(lesson.id, new URL('assets/learning-audio/' + entry.file, location.href).href);
  }
  return button;
}
function saveButton(lesson, onUpdated) {
  const save = node('button', progress[lesson.id]?.saved ? text('★ Saved', '★ 已收藏') : text('☆ Save word', '☆ 收藏'));
  save.setAttribute('aria-pressed', String(Boolean(progress[lesson.id]?.saved)));
  save.onclick = async event => {
    event?.stopPropagation?.();
    save.disabled = true;
    try { await persist(lesson.id, 'saved', !progress[lesson.id]?.saved); onUpdated(); }
    catch (error) { $('message').textContent = error.message; save.disabled = false; }
  };
  return save;
}
function renderHeroBrowser() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const allHeroes = catalog.lessons.filter(l => l.kind === 'hero');
  const matching = allHeroes.filter(h => {
    if (attrFilter !== 'all' && heroAttr(h) !== attrFilter) return false;
    if (!query) return true;
    return [h.en, h.zh, h.descriptionEn, h.descriptionZh].some(s => (s || '').toLocaleLowerCase().includes(query))
      || heroAbilities(h).some(a => [a.en, a.zh].some(s => (s || '').toLocaleLowerCase().includes(query)));
  });
  $('message').textContent = matching.length
    ? text(`${matching.length} heroes across 4 attributes · Click any hero to view bilingual abilities.`, `共 ${matching.length} 位英雄 · 点击任意英雄查看中英双语技能与发音。`)
    : text('No matching heroes found.', '未找到匹配的英雄，请更换搜索词。');
  const filters = $('attr-filters');
  filters.replaceChildren();
  const allBtn = node('button', text(`All (${allHeroes.length})`, `全部 (${allHeroes.length})`), 'attr-pill');
  allBtn.setAttribute('aria-pressed', String(attrFilter === 'all'));
  allBtn.onclick = () => { attrFilter = 'all'; render(); };
  filters.append(allBtn);
  for (const group of ATTR_GROUPS) {
    const count = allHeroes.filter(h => heroAttr(h) === group.key).length;
    const btn = node('button', `${group.icon} ${text(group.en, group.zh)} (${count})`, `attr-pill attr-${group.key}`);
    btn.setAttribute('aria-pressed', String(attrFilter === group.key));
    btn.onclick = () => { attrFilter = group.key; render(); };
    filters.append(btn);
  }
  const container = $('hero-categories');
  container.replaceChildren();
  for (const group of ATTR_GROUPS) {
    const groupHeroes = matching.filter(h => heroAttr(h) === group.key);
    if (!groupHeroes.length) continue;
    const section = node('section', '', 'hero-category-section');
    const head = node('div', '', 'hero-category-head');
    head.append(node('h2', `${group.icon} ${group.en} · ${group.zh}`), node('span', `${groupHeroes.length}`, 'hero-category-count'));
    const grid = node('div', '', 'hero-grid');
    for (const hero of groupHeroes) {
      const abilitiesCount = heroAbilities(hero).length;
      const tile = node('button', '', `hero-tile attr-${group.key}`);
      tile.type = 'button';
      const info = node('span', '', 'hero-tile-info');
      info.append(node('strong', hero.en), node('span', hero.zh, 'hero-tile-zh'), node('span', text(`${abilitiesCount} abilities`, `${abilitiesCount} 个技能`), 'hero-tile-meta'));
      tile.append(heroAvatarNode(hero, false), info);
      if (progress[hero.id]?.saved) tile.append(node('span', '★', 'hero-tile-saved'));
      tile.onclick = () => { selectedHeroId = hero.id; render(); $('hero-detail').scrollIntoView({ block: 'start' }); };
      grid.append(tile);
    }
    section.append(head, grid);
    container.append(section);
  }
}
function renderHeroDetail(hero) {
  const attrKey = heroAttr(hero);
  const group = ATTR_GROUPS.find(g => g.key === attrKey) || ATTR_GROUPS[2];
  const abilities = heroAbilities(hero);
  $('message').textContent = text(`${hero.en} (${hero.zh}) · ${abilities.length} bilingual abilities`, `${hero.zh} (${hero.en}) · 共 ${abilities.length} 个双语技能`);
  const header = $('hero-detail-header');
  header.replaceChildren();
  const topRow = node('div', '', 'hero-detail-top');
  const titleWrap = node('div', '', 'hero-detail-title');
  titleWrap.append(node('span', `${group.icon} ${group.en} · ${group.zh}`, `topic attr-badge-${attrKey}`), node('h2', `${hero.en} · ${hero.zh}`));
  topRow.append(heroAvatarNode(hero, true), titleWrap);
  header.append(topRow);
  if (hero.descriptionEn) header.append(node('p', hero.descriptionEn, 'description'));
  if (hero.descriptionZh) header.append(node('p', hero.descriptionZh, 'description zh-block'));
  if (hero.biographyEn || hero.biographyZh) {
    const bio = node('details', '', 'translation');
    bio.append(node('summary', text('Hero Lore / 英雄背景故事', '英雄背景故事 / Hero Lore')));
    if (hero.biographyEn) bio.append(node('p', hero.biographyEn, 'description'));
    if (hero.biographyZh) bio.append(node('p', hero.biographyZh, 'description zh-block'));
    header.append(bio);
  }
  const heroActions = node('div', '', 'actions');
  const talkBtn = node('button', text('🎙️ Practice with Pet (Alt+Q)', '🎙️ 和桌宠实时语音练技能 (Alt+Q)'), 'voice-practice-btn');
  talkBtn.onclick = async () => {
    talkBtn.disabled = true;
    try {
      startVoiceBar(`${hero.en} · ${hero.zh}`);
      const res = await api.practiceVoice(buildHeroPracticePersona({ hero, abilities }));
      if (!res.ok) throw new Error(res.error);
      $('message').textContent = text(`Started real-time voice practice for ${hero.en}!`, `已开启 ${hero.zh} 技能实时语音练习！`);
    } catch (error) { $('message').textContent = error.message; $('voice-bar-status').textContent = error.message; }
    finally { talkBtn.disabled = false; }
  };
  heroActions.append(audioButton(hero), saveButton(hero, render), talkBtn);
  header.append(heroActions);

  const list = $('hero-abilities');
  list.replaceChildren();
  for (const ability of abilities) {
    const card = node('article', '', 'lesson ability-bilingual-card');
    const cardHead = node('div', '', 'ability-card-head');
    cardHead.append(node('h4', ability.en), node('span', ability.zh, 'ability-zh-name'));
    const pills = node('div', '', 'ability-pills');
    const cds = ability.mechanics?.cooldowns?.filter(n => n > 0);
    const manas = ability.mechanics?.mana_costs?.filter(n => n > 0);
    if (cds?.length) pills.append(node('span', `CD: ${[...new Set(cds)].join(' / ')}s`, 'mech-pill'));
    if (manas?.length) pills.append(node('span', `Mana: ${[...new Set(manas)].join(' / ')}`, 'mech-pill'));
    card.append(cardHead);
    if (pills.childElementCount) card.append(pills);
    if (ability.descriptionEn) card.append(node('p', ability.descriptionEn, 'description'));
    if (ability.descriptionZh) card.append(node('p', ability.descriptionZh, 'description zh-block'));
    const actions = node('div', '', 'actions');
    actions.append(audioButton(ability), saveButton(ability, render));
    card.append(actions);
    list.append(card);
  }
}
function renderSpokenBrowser() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const matching = SPOKEN_PHRASES.filter(p => {
    if (spokenFilter !== 'all' && p.category !== spokenFilter) return false;
    if (!query) return true;
    return [p.en, p.zh, p.alt, p.tip].some(s => (s || '').toLocaleLowerCase().includes(query));
  });
  $('message').textContent = matching.length
    ? text(`${matching.length} natural in-game callouts · Say these on mic with native teammates.`, `共 ${matching.length} 条实战口语 · 遇到对应局势直接照着说或一键复制。`)
    : text('No matching spoken phrases found.', '未找到匹配的实战口语。');
  const filters = $('spoken-filters');
  filters.replaceChildren();
  const allBtn = node('button', text(`All (${SPOKEN_PHRASES.length})`, `全部场景 (${SPOKEN_PHRASES.length})`), 'attr-pill');
  allBtn.setAttribute('aria-pressed', String(spokenFilter === 'all'));
  allBtn.onclick = () => { spokenFilter = 'all'; render(); };
  filters.append(allBtn);
  for (const cat of SPOKEN_CATEGORIES) {
    const count = SPOKEN_PHRASES.filter(p => p.category === cat.key).length;
    const btn = node('button', `${cat.icon} ${text(cat.en, cat.zh)} (${count})`, 'attr-pill');
    btn.setAttribute('aria-pressed', String(spokenFilter === cat.key));
    btn.onclick = () => { spokenFilter = cat.key; render(); };
    filters.append(btn);
  }
  const list = $('spoken-list');
  list.replaceChildren();
  for (const phrase of matching) {
    const cat = SPOKEN_CATEGORIES.find(c => c.key === phrase.category);
    const card = node('article', '', 'lesson spoken-card');
    card.append(node('span', `${cat?.icon || ''} ${text(cat?.en || '', cat?.zh || '')}`, 'topic'));
    card.append(node('p', phrase.zh, 'spoken-zh-intent'));
    card.append(node('h3', phrase.en, 'spoken-en-callout'));
    if (phrase.alt) card.append(node('p', text(`Quick version: ${phrase.alt}`, `简短口语版：${phrase.alt}`), 'spoken-alt'));
    if (phrase.tip) card.append(node('p', phrase.tip, 'spoken-tip'));
    const actions = node('div', '', 'actions');
    const copyBtn = node('button', text('📋 Copy English', '📋 复制英文'));
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(phrase.en);
        copyBtn.textContent = text('✓ Copied', '✓ 已复制');
        setTimeout(() => { copyBtn.textContent = text('📋 Copy English', '📋 复制英文'); }, 1500);
      } catch {
        copyBtn.textContent = text('Copy failed', '复制失败');
      }
    };
    const talkBtn = node('button', text('🎙️ Practice on Mic (Alt+Q)', '🎙️ 实时语音试说 (Alt+Q)'), 'voice-practice-btn');
    talkBtn.onclick = async () => {
      talkBtn.disabled = true;
      try {
        startVoiceBar(phrase.en);
        const res = await api.practiceVoice(buildPhrasePracticePersona({ phrase }));
        if (!res.ok) throw new Error(res.error);
        $('message').textContent = text('Started live mic practice with your pet!', '已开启实时语音口语对练！');
      } catch (error) { $('message').textContent = error.message; $('voice-bar-status').textContent = error.message; }
      finally { talkBtn.disabled = false; }
    };
    actions.append(copyBtn, saveButton(phrase, render), talkBtn);
    card.append(actions);
    list.append(card);
  }
}
const SVG_NS = 'http://www.w3.org/2000/svg';
const SHOP_ICON_PATHS = {
  consumables: 'M9 3h6m-5 0v4.2L6.2 14.5A2.5 2.5 0 0 0 8.4 18h7.2a2.5 2.5 0 0 0 2.2-3.5L14 7.2V3M8.5 13h7',
  attributes: 'M12 3l7 6-7 12L5 9l7-6zm0 0v18M5 9h14',
  equipment: 'M14.5 4.5l5 5-9.5 9.5H5v-5l9.5-9.5zM12 7l5 5',
  miscellaneous: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  secret: 'M9.2 8.8a3 3 0 1 1 4.6 2.5c-.9.6-1.8 1.2-1.8 2.4v.8M12 18h.01',
  accessories: 'M6 17h12v2H6v-2zm2-2l1.5-8h4l1 4 3 1.2V15H8z',
  support: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  magical: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM5 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z',
  armor: 'M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z',
  weapons: 'M5 19l4-4m-2-2l9-9 3 3-9 9m-4-1l-1 4 4-1m6-1l4 4m-1-5l-3 3',
  artifacts: 'M4 16l2-8 6 4 6-4 2 8H4zm2 3h12',
  tier: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.5 6.8 19.2l1-5.9-4.3-4.1 5.9-.9L12 3z',
  roshan: 'M7 4h10v5a5 5 0 0 1-10 0V4zm-3 1h3v3a3 3 0 0 1-3-3zm13 0h3a3 3 0 0 1-3 3V5zm-5 9v5m-3 0h6',
  variants: 'M12 4l8 4-8 4-8-4 8-4zm-8 8l8 4 8-4m-8 8l8-4M4 16l8 4',
  archive: 'M5 5h14v4H5V5zm1 4h12v10H6V9zm4 3h4',
  store: 'M4 9l1.5-5h13L20 9v2a2 2 0 0 1-2 2h-1v7H7v-7H6a2 2 0 0 1-2-2V9zm6 4v7h4v-7h-4z',
  neutral: 'M12 3c4 3 6 7 6 11a6 6 0 1 1-12 0c0-4 2-8 6-11zm0 6v9m0-5l3-2m-3 4l-3-2',
};
function shopIconSvg(iconKey, size = 15) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('shop-cat-svg');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SHOP_ICON_PATHS[iconKey] || SHOP_ICON_PATHS.artifacts);
  svg.append(path);
  return svg;
}
function hideShopHoverTip() {
  const tip = $('shop-hover-tip');
  if (tip) tip.hidden = true;
}
function showShopHoverTip(lesson, anchor) {
  const tip = $('shop-hover-tip');
  if (!tip || !anchor) return;
  const info = classifyItem(lesson, itemShopCategories);
  const cat = CATEGORY_BY_KEY[info.category];
  const cue = itemCoaching(lesson);
  const cost = lesson.mechanics?.item_cost || 0;
  tip.replaceChildren();
  const top = node('div', '', 'shop-tip-top');
  top.append(itemImageNode(lesson));
  const meta = node('div', '', 'shop-tip-meta');
  meta.append(node('strong', lesson.en), node('span', lesson.zh, 'shop-tip-zh'));
  const badges = node('div', '', 'shop-tip-badges');
  if (cat) badges.append(node('span', text(cat.en, cat.zh), 'shop-tip-cat'));
  if (cost > 0) badges.append(node('span', `🪙 ${cost}g`, 'shop-tip-cost'));
  meta.append(badges);
  top.append(meta);
  tip.append(top);
  if (cue?.aliases?.length) {
    tip.append(node('p', text('Aliases: ', '简称：') + cue.aliases.slice(0, 4).join(' · '), 'shop-tip-aliases'));
  }
  if (cue?.en) {
    tip.append(node('p', `“${cue.en}”`, 'shop-tip-cue'));
  }
  tip.append(node('p', text('Click to study details & hear audio', '点击查看双语详情与发音'), 'shop-tip-hint'));
  tip.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const pad = 12;
  let left = rect.right + 10;
  if (left + tipRect.width > window.innerWidth - pad) left = rect.left - tipRect.width - 10;
  if (left < pad) left = Math.max(pad, Math.min(window.innerWidth - tipRect.width - pad, rect.left + (rect.width - tipRect.width) / 2));
  let topPos = rect.top - 8;
  if (topPos + tipRect.height > window.innerHeight - pad) topPos = window.innerHeight - tipRect.height - pad;
  if (topPos < pad) topPos = pad;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(topPos)}px`;
}
function itemImageNode(lesson, recall = false) {
  const wrap = node('span', '', 'item-picture');
  const fallback = node('span', text('Image unavailable', '暂无图片'), 'item-picture-fallback');
  wrap.dataset.imageState = 'loading';
  const sources = itemImageSources(lesson, itemImages);
  if (!sources.length) { wrap.append(fallback); wrap.dataset.imageState = 'unavailable'; return wrap; }
  const image = document.createElement('img');
  image.alt = recall ? text('Item picture — recall its name', '物品图片——回忆它的名称') : `${lesson.en} · ${lesson.zh}`;
  image.width = 88; image.height = 64;
  image.loading = recall ? 'eager' : 'lazy'; image.decoding = 'async';
  let index = 0;
  image.onload = () => { wrap.dataset.imageState = 'loaded'; };
  image.onerror = () => {
    if (++index < sources.length) { image.src = sources[index]; return; }
    wrap.replaceChildren(fallback); wrap.dataset.imageState = 'unavailable';
  };
  image.src = sources[0];
  wrap.append(image);
  return wrap;
}
function itemCoachNode(lesson) {
  const cue = itemCoaching(lesson);
  const coach = node('section', '', 'item-coach');
  coach.append(node('h3', text('Say it in a match', '实战这样说')),
    node('p', cue.en, 'match-english'), node('p', cue.zh, 'match-chinese'));
  if (cue.vocabulary.length) {
    const words = node('div', '', 'vocabulary-hints');
    words.setAttribute('aria-label', text('Words in this explanation', '说明中的词汇'));
    for (const word of cue.vocabulary) words.append(node('span', `${word.en} · ${word.zh}`, 'vocabulary-hint'));
    coach.append(words);
  }
  return coach;
}
function nextStarterUnit() {
  return STARTER_UNITS.find(unit => unit.lessonIds.every(id => catalog.lessons.some(lesson => lesson.id === id && starterAvailability(starterEvidence, id, lesson)))
    && unit.lessonIds.some(id => catalog.lessons.some(lesson => lesson.id === id) && (!progress[id]?.due || progress[id].due <= Date.now())));
}
function quickLabel() {
  const running = study.active && !study.active.completedAt;
  const next = mode === 'starter' ? nextStarterUnit() : null;
  $('quick-practice').disabled = starting || (mode === 'starter' && !running && !next);
  $('quick-practice').textContent = study.active && !study.active.completedAt
    ? text('Continue my session →', '继续上次练习 →')
    : mode === 'starter' ? next === STARTER_UNITS[0] ? text('Start first lesson →', '开始第一课 →') : next ? text('Start next lesson →', '开始下一课 →') : text('Reviews scheduled', '已安排后续复习')
      : text('Practice 5 lessons →', '练习 5 条课程 →');
}
function renderStarter() {
  const container = $('starter-units'); container.replaceChildren();
  $('starter-status').textContent = '';
  $('starter-source').textContent = starterEvidence.checkedAt
    ? text('Starter items checked against official shop listings: ', '入门物品已对照官方商店列表核验：') + new Date(starterEvidence.checkedAt).toLocaleDateString()
    : text('Shop-source verification is unavailable.', '商店来源核验暂不可用。');
  for (const unit of STARTER_UNITS) {
    const rows = unit.lessonIds.map(id => catalog.lessons.find(lesson => lesson.id === id)).filter(Boolean);
    const verified = rows.length === unit.lessonIds.length && rows.every(lesson => starterAvailability(starterEvidence, lesson.id, lesson));
    const practiced = rows.filter(lesson => progress[lesson.id]?.attempts).length;
    const ready = rows.filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= Date.now()).length;
    const running = study.active && !study.active.completedAt;
    const sameUnit = running && study.active.options.scope === unit.id;
    const card = node('article', '', 'starter-unit');
    card.append(node('h3', text(unit.en, unit.zh)), node('p', text(unit.goalEn, unit.goalZh), 'starter-goal'));
    const pictures = node('div', '', 'starter-pictures'); pictures.setAttribute('translate', 'no');
    for (const lesson of rows) {
      const picture = node('div', '', 'starter-preview');
      picture.append(itemImageNode(lesson), node('strong', lesson.en), node('span', lesson.zh)); pictures.append(picture);
    }
    card.append(pictures, node('p', text(`${practiced}/5 practiced · Learn the names, then recall in English.`, `${practiced}/5 条已练习 · 先认识，再回忆英文。`), 'starter-progress'));
    const button = node('button', sameUnit ? text('Continue lesson →', '继续本课 →')
      : !verified ? text('Verification needed', '需要来源核验') : !ready ? text('Reviews scheduled', '已安排后续复习')
      : practiced ? text('Review this lesson →', '复习本课 →') : text('Learn these 5 names →', '学习这 5 个词 →'));
    button.dataset.starterUnit = unit.id;
    button.disabled = Boolean(starting || !verified || (!sameUnit && (running || !ready)));
    button.onclick = () => startStarterUnit(unit);
    card.append(button); container.append(card);
  }
  if (study.active && !study.active.completedAt) $('starter-status').textContent = text('An unfinished session is saved. Continue it before starting another lesson.', '你有一轮未完成的学习。请先继续这一轮，再开始其他课程。');
}
async function startStarterUnit(unit) {
  if (starting) return;
  if (study.active && !study.active.completedAt) { enterPractice(); return; }
  enterPractice(unit.id);
  $('session-scope').value = unit.id; $('session-size').value = '5'; $('kind').value = 'item'; $('search').value = ''; $('direction').value = 'zh';
  await beginSession();
}
function renderGuide(active) {
  const index = active.guideIndex, lesson = active.items[index].lesson;
  const brief = STARTER_ITEMS[lesson.id];
  $('study-setup').hidden = true; $('guided-lesson').hidden = false;
  $('guide-counter').textContent = text(`Learn ${index + 1} / ${active.items.length} · Recall comes next`, `认识第 ${index + 1} / ${active.items.length} 个词 · 随后回忆英文`);
  $('guide-progress').value = index; $('guide-progress').max = active.items.length;
  const card = node('article', '', 'guided-card');
  const heading = node('div', '', 'lesson-heading');
  const title = node('div', '', 'lesson-title'); title.append(node('h3', lesson.en), node('p', lesson.zh, 'zh'));
  heading.append(itemImageNode(lesson), title);
  card.append(heading, node('p', brief.en, 'guide-meaning'), node('p', brief.zh, 'guide-translation'), itemCoachNode(lesson));
  const actions = node('div', '', 'actions'); actions.append(audioButton(lesson), saveButton(lesson, render)); card.append(actions);
  $('guide-card').replaceChildren(card);
  $('guide-next').disabled = advancing;
  $('guide-next').textContent = index === active.items.length - 1 ? text('Ready: recall in English →', '准备好了，回忆英文 →') : text('Next learning card →', '下一张学习卡 →');
}
function buildLessonCard(lesson, onUpdated) {
  const card = node('article', '', 'lesson');
  card.dataset.lessonId = lesson.id;
  const topicWrap = node('div', '', '');
  topicWrap.append(node('span', labels[lesson.kind], 'topic'));
  if (lesson.kind === 'item' && lesson.mechanics?.item_cost) {
    topicWrap.append(node('span', `🪙 ${lesson.mechanics.item_cost}g`, 'item-cost-pill'));
  }
  card.append(topicWrap);
  if (lesson.parent) card.append(node('p', lesson.parent, 'parent'));
  const title = node('div', '', 'lesson-title');
  title.append(node('h2', lesson.en), node('p', lesson.zh, 'zh'));
  const heading = node('div', '', 'lesson-heading');
  if (lesson.kind === 'item') heading.append(itemImageNode(lesson));
  heading.append(title); card.append(heading);
  if (lesson.kind === 'item') {
    const cue = itemCoaching(lesson);
    if (cue.aliases.length) card.append(node('p', text('Also called: ', '常用叫法：') + cue.aliases.join(' · '), 'item-aliases'));
    card.append(itemCoachNode(lesson));
  }
  const cds = lesson.mechanics?.cooldowns?.filter(n => n > 0);
  const manas = lesson.mechanics?.mana_costs?.filter(n => n > 0);
  if (cds?.length || manas?.length) {
    const pills = node('div', '', 'ability-pills');
    if (cds?.length) pills.append(node('span', `CD: ${[...new Set(cds)].join(' / ')}s`, 'mech-pill'));
    if (manas?.length) pills.append(node('span', `Mana: ${[...new Set(manas)].join(' / ')}`, 'mech-pill'));
    card.append(pills);
  }
  if (lesson.descriptionEn) card.append(node('p', lesson.descriptionEn, 'description'));
  const translation = node('details', '', 'translation');
  translation.append(node('summary', text('Chinese explanation', '中文说明')), node('p', lesson.descriptionZh || lesson.zh, 'description'));
  card.append(translation);
  const actions = node('div', '', 'actions');
  actions.append(audioButton(lesson), saveButton(lesson, onUpdated));
  card.append(actions);
  return card;
}
function formatGold(cost) {
  return cost > 0 ? `${cost}g` : text('Free', '免费');
}
function selectShopItem(itemId, { scroll = true } = {}) {
  hideShopHoverTip();
  player.stop();
  selectedItemId = itemId;
  renderItemBrowser();
  if (scroll && itemId && !$('item-inspector').hidden) {
    $('item-inspector').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
function buildShopIconTile(lesson, cat) {
  const tile = node('button', '', 'shop-icon-tile');
  tile.type = 'button';
  tile.dataset.itemId = lesson.id;
  const cost = lesson.mechanics?.item_cost || 0;
  tile.setAttribute('aria-label', `${lesson.en} · ${lesson.zh}${cost > 0 ? ` · ${cost}g` : ''}`);
  tile.setAttribute('aria-pressed', String(selectedItemId === lesson.id));
  if (selectedItemId === lesson.id) tile.classList.add('is-selected');
  if (cat?.accent) tile.style.setProperty('--tile-accent', cat.accent);
  const artWrap = node('span', '', 'shop-icon-art');
  artWrap.append(itemImageNode(lesson));
  if (progress[lesson.id]?.saved) artWrap.append(node('span', '★', 'shop-tile-star'));
  tile.append(artWrap);
  tile.append(node('span', cost > 0 ? `${cost}g` : text('Free', '免费'), `shop-icon-cost${cost > 0 ? '' : ' is-free'}`));
  tile.onmouseenter = () => showShopHoverTip(lesson, tile);
  tile.onmouseleave = hideShopHoverTip;
  tile.onfocus = () => showShopHoverTip(lesson, tile);
  tile.onblur = hideShopHoverTip;
  tile.onclick = () => selectShopItem(selectedItemId === lesson.id ? null : lesson.id);
  return tile;
}
function buildItemNameTile(lesson, { showCategory = false } = {}) {
  const info = classifyItem(lesson, itemShopCategories);
  const cat = CATEGORY_BY_KEY[info.category];
  const cost = lesson.mechanics?.item_cost || 0;
  const tile = node('button', '', 'item-name-tile');
  tile.type = 'button';
  tile.dataset.itemId = lesson.id;
  tile.setAttribute('aria-pressed', String(selectedItemId === lesson.id));
  if (selectedItemId === lesson.id) tile.classList.add('is-selected');
  if (cat?.accent) tile.style.setProperty('--tile-accent', cat.accent);
  tile.append(itemImageNode(lesson));
  const body = node('span', '', 'item-name-info');
  body.append(node('strong', lesson.en), node('span', lesson.zh, 'item-name-zh'));
  const meta = node('span', '', 'item-name-meta');
  if (cost > 0) meta.append(node('span', `🪙 ${cost}g`, 'item-mini-cost'));
  if (showCategory && cat) meta.append(node('span', text(cat.en, cat.zh), 'item-mini-cat'));
  if (meta.childElementCount) body.append(meta);
  tile.append(body);
  if (progress[lesson.id]?.saved) tile.append(node('span', '★', 'item-name-saved'));
  tile.onclick = () => selectShopItem(selectedItemId === lesson.id ? null : lesson.id);
  return tile;
}
function renderItemInspector(lesson) {
  const host = $('item-inspector');
  if (!lesson) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  const info = classifyItem(lesson, itemShopCategories);
  const cat = CATEGORY_BY_KEY[info.category];
  const realm = SHOP_REALMS.find(r => r.key === info.realm);
  const shelf = SHOP_SHELVES[info.shelf];
  const idx = visibleShopItems.findIndex(item => item.id === lesson.id);
  const card = node('article', '', 'lesson item-inspector-card');
  card.dataset.lessonId = lesson.id;
  if (cat?.accent) card.style.setProperty('--cat-accent', cat.accent);
  if (cat?.tint) card.style.setProperty('--cat-tint', cat.tint);

  const bar = node('div', '', 'item-inspector-bar');
  const crumbBtn = node('button', '', 'item-crumb-btn');
  crumbBtn.type = 'button';
  if (cat) crumbBtn.append(shopIconSvg(cat.icon, 13));
  const crumbParts = [
    realm ? text(realm.en, realm.zh) : '',
    info.realm === 'shop' && shelf ? text(shelf.en, shelf.zh) : '',
    cat ? text(cat.en, cat.zh) : '',
  ].filter(Boolean);
  crumbBtn.append(node('span', crumbParts.join(' › ')));
  crumbBtn.title = text('Filter to this category', '筛选该分类');
  crumbBtn.onclick = () => {
    $('search').value = '';
    itemRealm = info.realm;
    itemCategory = info.category;
    renderItemBrowser();
  };
  const nav = node('div', '', 'item-inspector-nav');
  if (visibleShopItems.length > 1 && idx >= 0) {
    const prevBtn = node('button', '←', 'item-nav-btn');
    prevBtn.type = 'button';
    prevBtn.title = text('Previous item (←)', '上一件物品 (←)');
    prevBtn.setAttribute('aria-label', text('Previous item', '上一件物品'));
    prevBtn.onclick = () => selectShopItem(visibleShopItems[(idx - 1 + visibleShopItems.length) % visibleShopItems.length].id, { scroll: false });
    const counter = node('span', `${idx + 1} / ${visibleShopItems.length}`, 'item-nav-count');
    const nextBtn = node('button', '→', 'item-nav-btn');
    nextBtn.type = 'button';
    nextBtn.title = text('Next item (→)', '下一件物品 (→)');
    nextBtn.setAttribute('aria-label', text('Next item', '下一件物品'));
    nextBtn.onclick = () => selectShopItem(visibleShopItems[(idx + 1) % visibleShopItems.length].id, { scroll: false });
    nav.append(prevBtn, counter, nextBtn);
  }
  const closeBtn = node('button', '×', 'item-close-btn');
  closeBtn.type = 'button';
  closeBtn.title = text('Close details (Esc)', '关闭详情 (Esc)');
  closeBtn.setAttribute('aria-label', text('Close item details', '关闭物品详情'));
  closeBtn.onclick = () => selectShopItem(null, { scroll: false });
  nav.append(closeBtn);
  bar.append(crumbBtn, nav);
  card.append(bar);

  const head = node('div', '', 'item-inspector-head');
  head.append(itemImageNode(lesson));
  const titleWrap = node('div', '', 'lesson-title');
  const nameRow = node('div', '', 'item-inspector-title-row');
  nameRow.append(node('h2', lesson.en));
  if (lesson.mechanics?.item_cost) {
    nameRow.append(node('span', `🪙 ${lesson.mechanics.item_cost}g`, 'item-cost-pill'));
  }
  titleWrap.append(nameRow, node('p', lesson.zh, 'zh'));
  const cue = itemCoaching(lesson);
  if (cue?.aliases?.length) {
    titleWrap.append(node('p', text('Also called: ', '常用叫法：') + cue.aliases.join(' · '), 'item-aliases'));
  }
  const cds = lesson.mechanics?.cooldowns?.filter(n => n > 0);
  const manas = lesson.mechanics?.mana_costs?.filter(n => n > 0);
  if (cds?.length || manas?.length) {
    const pills = node('div', '', 'ability-pills');
    if (cds?.length) pills.append(node('span', `CD: ${[...new Set(cds)].join(' / ')}s`, 'mech-pill'));
    if (manas?.length) pills.append(node('span', `Mana: ${[...new Set(manas)].join(' / ')}`, 'mech-pill'));
    titleWrap.append(pills);
  }
  head.append(titleWrap);
  card.append(head);

  const body = node('div', '', 'item-inspector-body');
  const leftCol = node('div', '', 'item-inspector-col');
  leftCol.append(itemCoachNode(lesson));
  const actions = node('div', '', 'actions');
  actions.append(audioButton(lesson), saveButton(lesson, () => { stats(); renderItemBrowser(); }));
  const practiceBtn = node('button', text('🎯 Practice this item', '🎯 练习此物品'), 'item-practice-btn');
  practiceBtn.type = 'button';
  practiceBtn.onclick = async () => {
    $('search').value = lesson.en;
    enterPractice('all');
    if (study.active && !study.active.completedAt) return;
    $('kind').value = 'item'; $('session-size').value = '5'; $('session-scope').value = 'all';
    await beginSession();
  };
  actions.append(practiceBtn);
  leftCol.append(actions);

  const rightCol = node('div', '', 'item-inspector-col');
  if (lesson.descriptionEn) rightCol.append(node('p', lesson.descriptionEn, 'description'));
  if (lesson.descriptionZh) rightCol.append(node('p', lesson.descriptionZh, 'description zh-block'));
  body.append(leftCol, rightCol);
  card.append(body);

  host.replaceChildren(card);
}
function renderItemBrowser() {
  hideShopHoverTip();
  const allItems = catalog.lessons.filter(l => l.kind === 'item');
  const rawQuery = $('search').value.trim();
  const counts = realmCounts(allItems, itemShopCategories);

  // 1. Realm switcher tabs
  const realmsEl = $('item-realms');
  realmsEl.replaceChildren();
  for (const realm of SHOP_REALMS) {
    const btn = node('button', '', 'realm-tab');
    btn.type = 'button';
    btn.role = 'tab';
    btn.dataset.realm = realm.key;
    const isActive = !rawQuery && itemRealm === realm.key;
    btn.setAttribute('aria-selected', String(isActive));
    btn.setAttribute('aria-pressed', String(isActive));
    btn.append(shopIconSvg(realm.icon, 14), node('span', text(realm.en, realm.zh)), node('span', String(counts[realm.key] || 0), 'realm-count'));
    btn.onclick = () => {
      if (rawQuery) $('search').value = '';
      itemRealm = realm.key;
      itemCategory = 'all';
      selectedItemId = null;
      renderItemBrowser();
    };
    realmsEl.append(btn);
  }

  // 2. Quick filter & view controls
  const quickEl = $('item-quick-controls');
  quickEl.replaceChildren();
  const activeToggle = node('button', text('⚡ Active', '⚡ 主动'), 'shop-toggle-pill');
  activeToggle.type = 'button';
  activeToggle.setAttribute('aria-pressed', String(itemQuickFilter === 'active'));
  activeToggle.onclick = () => { itemQuickFilter = itemQuickFilter === 'active' ? 'all' : 'active'; renderItemBrowser(); };

  const savedToggle = node('button', text('★ Saved', '★ 已收藏'), 'shop-toggle-pill');
  savedToggle.type = 'button';
  savedToggle.setAttribute('aria-pressed', String(itemQuickFilter === 'saved'));
  savedToggle.onclick = () => { itemQuickFilter = itemQuickFilter === 'saved' ? 'all' : 'saved'; renderItemBrowser(); };

  const viewWrap = node('div', '', 'shop-view-toggle');
  const gridBtn = node('button', text('▦ Grid', '▦ 网格'), 'shop-view-btn');
  gridBtn.type = 'button';
  gridBtn.dataset.view = 'grid';
  gridBtn.setAttribute('aria-pressed', String(itemViewMode === 'grid'));
  gridBtn.onclick = () => { itemViewMode = 'grid'; renderItemBrowser(); };
  const namesBtn = node('button', text('☰ Names', '☰ 名称'), 'shop-view-btn');
  namesBtn.type = 'button';
  namesBtn.dataset.view = 'names';
  namesBtn.setAttribute('aria-pressed', String(itemViewMode === 'names'));
  namesBtn.onclick = () => { itemViewMode = 'names'; renderItemBrowser(); };
  viewWrap.append(gridBtn, namesBtn);
  const showViewToggle = !rawQuery && itemRealm === 'shop' && itemCategory === 'all';
  quickEl.append(activeToggle, savedToggle);
  if (showViewToggle) quickEl.append(viewWrap);

  const applyQuickFilter = list => list.filter(item => {
    if (itemQuickFilter === 'active' && !isActiveItem(item)) return false;
    if (itemQuickFilter === 'saved' && !progress[item.id]?.saved) return false;
    return true;
  });

  const filtersEl = $('item-filters');
  const board = $('item-list');
  filtersEl.replaceChildren();
  board.replaceChildren();
  $('more').hidden = true;

  // 3. Cross-catalog instant search mode
  if (rawQuery) {
    const matches = applyQuickFilter(searchShopItems(allItems, rawQuery, itemShopCategories));
    visibleShopItems = matches;
    const clearBtn = node('button', text(`× Clear “${rawQuery}”`, `× 清除搜索「${rawQuery}」`), 'attr-pill shop-clear-pill');
    clearBtn.type = 'button';
    clearBtn.onclick = () => { $('search').value = ''; selectedItemId = null; renderItemBrowser(); };
    filtersEl.append(clearBtn);
    $('message').textContent = matches.length
      ? text(`${matches.length} matching items across Shop, Neutral & Archive · Click any item to study.`, `在全部 ${allItems.length} 件物品中找到 ${matches.length} 件 · 点击即可查看双语详情与发音。`)
      : text('No matching items found. Try English name, Chinese name, alias (BKB, TP, Blink) or category (Armor, Support).', '未找到匹配物品，可尝试英文名、中文名、简称（bkb / 跳刀 / 羊刀）或分类（防具 / 辅助）。');

    // Auto-open inspector when search narrows to 1 exact item (e.g. "bkb") or preserve selected match.
    const activeLesson = matches.find(i => i.id === selectedItemId) || (matches.length === 1 ? matches[0] : null);
    renderItemInspector(activeLesson);

    if (!matches.length) {
      board.append(node('p', text('No items match your search and filters.', '当前搜索和筛选条件下没有匹配物品。'), 'shop-empty'));
      return;
    }
    if (matches.length === 1 && activeLesson) return;
    const grid = node('div', '', 'item-name-grid');
    for (const item of matches) grid.append(buildItemNameTile(item, { showCategory: true }));
    board.append(grid);
    return;
  }

  // 4. Realm & official subcategory browse mode
  const realmItems = applyQuickFilter(allItems.filter(item => classifyItem(item, itemShopCategories).realm === itemRealm));
  const groups = groupItemsByCategory(realmItems, itemShopCategories, itemRealm);

  const allRealmBtn = node('button', text(`All (${realmItems.length})`, `全部 (${realmItems.length})`), 'attr-pill');
  allRealmBtn.type = 'button';
  allRealmBtn.setAttribute('aria-pressed', String(itemCategory === 'all'));
  allRealmBtn.onclick = () => { itemCategory = 'all'; renderItemBrowser(); };
  filtersEl.append(allRealmBtn);

  let lastShelf = null;
  for (const { category, items } of groups) {
    if (itemRealm === 'shop' && category.shelf !== lastShelf) {
      lastShelf = category.shelf;
      const shelfMeta = SHOP_SHELVES[category.shelf];
      filtersEl.append(node('span', text(shelfMeta.en, shelfMeta.zh), 'shop-cat-group-label'));
    }
    const btn = node('button', '', 'attr-pill shop-cat-pill');
    btn.type = 'button';
    btn.dataset.category = category.key;
    btn.style.setProperty('--cat-accent', category.accent);
    btn.setAttribute('aria-pressed', String(itemCategory === category.key));
    const dot = node('span', '', 'cat-dot');
    btn.append(dot, node('span', `${text(category.en, category.zh)} (${items.length})`));
    btn.onclick = () => { itemCategory = itemCategory === category.key ? 'all' : category.key; renderItemBrowser(); };
    filtersEl.append(btn);
  }

  const activeGroups = itemCategory === 'all' ? groups : groups.filter(g => g.category.key === itemCategory);
  visibleShopItems = activeGroups.flatMap(g => g.items);

  const activeLesson = visibleShopItems.find(i => i.id === selectedItemId) || null;
  if (!activeLesson) selectedItemId = null;
  renderItemInspector(activeLesson);

  const realmLabel = SHOP_REALMS.find(r => r.key === itemRealm);
  const catObj = itemCategory !== 'all' ? CATEGORY_BY_KEY[itemCategory] : null;
  $('message').textContent = visibleShopItems.length
    ? catObj
      ? text(`${visibleShopItems.length} items in ${catObj.en} · Click any item for bilingual coaching and audio.`, `${catObj.zh}分类共 ${visibleShopItems.length} 件物品 · 点击查看实战例句与发音。`)
      : text(`${visibleShopItems.length} items in ${realmLabel.en} · Hover to preview, click any item to study or hear audio.`, `${realmLabel.zh}共 ${visibleShopItems.length} 件 · 悬停预览中英名称与价格，点击展开双语学习卡。`)
    : text('No items match the current filter.', '当前筛选条件下暂无物品。');

  if (!visibleShopItems.length) {
    board.append(node('p', text('Try clearing the Active/Saved toggle or switching shop sections.', '可取消「主动 / 已收藏」筛选或切换商店分类。'), 'shop-empty'));
    return;
  }

  // Official Two-Shelf Dota 2 Shop Grid (Basics 5 columns + Upgrades 6 columns)
  if (itemRealm === 'shop' && itemCategory === 'all' && itemViewMode === 'grid') {
    for (const shelfKey of ['basic', 'upgrade']) {
      const shelfMeta = SHOP_SHELVES[shelfKey];
      const shelfGroups = groups.filter(g => g.category.shelf === shelfKey);
      const shelfCount = shelfGroups.reduce((sum, g) => sum + g.items.length, 0);
      if (!shelfCount) continue;
      const shelfEl = node('section', '', `shop-shelf shop-shelf-${shelfKey}`);
      shelfEl.id = `shop-shelf-${shelfKey}`;
      const shelfHead = node('div', '', 'shop-shelf-head');
      const titleGroup = node('div', '', 'shop-shelf-titles');
      titleGroup.append(
        node('h2', `${text(shelfMeta.en, shelfMeta.zh)}`),
        node('span', text(shelfMeta.zh, shelfMeta.en), 'shop-shelf-sub'),
      );
      const shelfRight = node('div', '', 'shop-shelf-right');
      const jumpTarget = shelfKey === 'basic' ? 'shop-shelf-upgrade' : 'shop-shelf-basic';
      const jumpBtn = node('button', shelfKey === 'basic' ? text('↓ Upgrades', '↓ 跳到合成分类') : text('↑ Basics', '↑ 回到基础分类'), 'shop-jump-btn');
      jumpBtn.type = 'button';
      jumpBtn.onclick = () => { $(jumpTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      shelfRight.append(jumpBtn, node('span', text(`${shelfCount} items`, `${shelfCount} 件`), 'hero-category-count'));
      shelfHead.append(titleGroup, shelfRight);
      shelfEl.append(shelfHead);

      const cols = node('div', '', `shop-columns shop-columns-${shelfKey}`);
      for (const { category, items } of shelfGroups) {
        const col = node('div', '', 'shop-column');
        col.dataset.category = category.key;
        col.style.setProperty('--cat-accent', category.accent);
        col.style.setProperty('--cat-tint', category.tint);
        const colHead = node('button', '', 'shop-col-head');
        colHead.type = 'button';
        colHead.title = text(`Focus ${category.en} (${items.length})`, `展开查看${category.zh} (${items.length})`);
        const iconBadge = node('span', '', 'shop-col-icon');
        iconBadge.append(shopIconSvg(category.icon, 14));
        const colTitles = node('span', '', 'shop-col-titles');
        colTitles.append(node('strong', text(category.en, category.zh)), node('span', text(category.zh, category.en), 'shop-col-sub'));
        colHead.append(iconBadge, colTitles, node('span', String(items.length), 'shop-col-count'));
        colHead.onclick = () => { itemCategory = category.key; renderItemBrowser(); };
        col.append(colHead);

        const iconGrid = node('div', '', 'shop-col-icons');
        for (const item of items) iconGrid.append(buildShopIconTile(item, category));
        col.append(iconGrid);
        cols.append(col);
      }
      shelfEl.append(cols);
      board.append(shelfEl);
    }
    return;
  }

  // Focused category, Names mode, Neutral Tiers, or Special & Archive shelves
  for (const { category, items } of activeGroups) {
    if (!items.length) continue;
    const section = node('section', '', 'shop-band');
    section.dataset.category = category.key;
    section.style.setProperty('--cat-accent', category.accent);
    section.style.setProperty('--cat-tint', category.tint);
    const head = node('div', '', 'shop-band-head');
    const headLeft = node('div', '', 'shop-band-title');
    const badge = node('span', '', 'shop-col-icon');
    badge.append(shopIconSvg(category.icon, 15));
    headLeft.append(badge, node('h2', `${text(category.en, category.zh)}`), node('span', text(category.zh, category.en), 'shop-shelf-sub'));
    if (category.hintEn) headLeft.append(node('span', text(category.hintEn, category.hintZh), 'shop-tier-hint'));
    head.append(headLeft, node('span', text(`${items.length} items`, `${items.length} 件`), 'hero-category-count'));
    section.append(head);

    const grid = node('div', '', 'item-name-grid');
    for (const item of items) grid.append(buildItemNameTile(item));
    section.append(grid);
    board.append(section);
  }
}
function render() {
  player.stop();
  document.querySelector('main').dataset.mode = mode;
  quickLabel();
  syncMasteryActive();
  for (const [id, m] of [['starter-tab', 'starter'], ['heroes-tab', 'heroes'], ['items-tab', 'items'], ['phrases-tab', 'phrases'], ['browse', 'browse'], ['saved', 'saved'], ['quiz', 'quiz']]) {
    $(id).setAttribute('aria-pressed', String(mode === m));
  }
  const selectedHero = mode === 'heroes' && selectedHeroId
    ? catalog.lessons.find(l => l.kind === 'hero' && l.id === selectedHeroId)
    : null;
  $('hero-browser').hidden = mode !== 'heroes' || Boolean(selectedHero);
  $('hero-detail').hidden = !selectedHero;
  $('item-browser').hidden = mode !== 'items';
  $('spoken-browser').hidden = mode !== 'phrases';
  $('starter-browser').hidden = mode !== 'starter';
  // The pagination control is shared by Explore and Items; keep it outside either hidden panel.
  $('library').hidden = mode !== 'browse' && mode !== 'saved';
  const quizCompleted = mode === 'quiz' && !planning && Boolean(study.active?.completedAt) && !(feedbackIndex !== null && study.active.answers[feedbackIndex]);
  $('study-setup').hidden = mode !== 'quiz' || quizCompleted;
  $('practice-saved').hidden = mode !== 'saved';
  $('practice').hidden = true; $('session-summary').hidden = true; $('guided-lesson').hidden = true;
  const tools = $('tools');
  const kindLabel = $('kind').closest('label');
  const dirLabel = $('direction').closest('label');
  const activeQuiz = mode === 'quiz' && study.active && !study.active.completedAt;
  const hideTools = mode === 'quiz' && Boolean(study.active) && !planning;
  if (tools) {
    tools.hidden = hideTools || mode === 'starter';
    tools.dataset.layout = (mode === 'heroes' || mode === 'items' || mode === 'phrases') ? 'search-only'
      : (mode === 'browse' || mode === 'saved') ? 'search-kind'
      : 'quiz';
  }
  if (kindLabel) kindLabel.hidden = mode === 'heroes' || mode === 'items' || mode === 'phrases';
  if (dirLabel) dirLabel.hidden = mode !== 'quiz';
  for (const id of ['search', 'kind', 'direction', 'session-size', 'session-scope']) $(id).disabled = Boolean(activeQuiz);
  if (mode === 'starter') { $('message').textContent = ''; $('more').hidden = true; renderStarter(); return; }
  if (mode === 'quiz') { $('message').textContent = ''; $('more').hidden = true; renderStudy(); return; }
  if (mode === 'heroes') {
    $('more').hidden = true;
    if (selectedHero) renderHeroDetail(selectedHero);
    else renderHeroBrowser();
    return;
  }
  if (mode === 'items') {
    $('search').placeholder = text('Search item, alias or category (BKB, Blink, Armor)…', '搜索物品名、简称或分类（如 bkb、跳刀、防具、羊刀）…');
    renderItemBrowser();
    return;
  }
  $('search').placeholder = text('Search English or Chinese…', '搜索英文 / 中文 / 英雄名…');
  if (mode === 'phrases') { $('more').hidden = true; renderSpokenBrowser(); return; }
  const rows = selection();
  $('message').textContent = rows.length ? text(`${rows.length} lessons · Read, listen, then save a word to practice.`, `${rows.length} 条课程 · 阅读、听发音、收藏后练习。`) : text('No lessons found. Try another topic or save some words.', '暂无课程，请更换筛选条件或先收藏词条。');
  $('lessons').replaceChildren();
  for (const lesson of rows.slice(0, limit)) {
    $('lessons').append(buildLessonCard(lesson, () => { stats(); render(); }));
  }
  $('more').hidden = rows.length <= limit;
}
function receive(response) {
  if (!response.ok) throw new Error(response.error);
  progress = response.progress; study = response.study; stats();
}
function today() {
  const completed = study.history.filter(entry => entry.day === localDay());
  $('today').textContent = text(
    'Today: ' + completed.length + ' sessions · ' + completed.reduce((n, r) => n + r.total, 0) + ' answers',
    '今日完成 ' + completed.length + ' 轮 · 共 ' + completed.reduce((n, r) => n + r.total, 0) + ' 道题');
}
function renderStudy() {
  today();
  const active = study.active;
  const running = active && !active.completedAt;
  $('start-session').hidden = Boolean(running || (active?.completedAt && !planning));
  if (!active || planning) return;
  if (isLearningStep(active)) { renderGuide(active); return; }
  const showFeedback = feedbackIndex !== null && active.answers[feedbackIndex];
  if (active.completedAt && !showFeedback) { renderSummary(active); return; }
  const index = showFeedback ? feedbackIndex : active.answers.length;
  const item = active.items[index];
  if (!item) return;
  $('practice').hidden = false;
  $('quiz-counter').textContent = text('Lesson ', '第 ') + (index + 1) + ' / ' + active.items.length;
  $('session-progress').max = active.items.length; $('session-progress').value = active.answers.length;
  $('quiz-context').textContent = labels[item.lesson.kind] + ' · ' + (item.lesson.parent || '');
  $('question').textContent = item.question.prompt;
  $('quiz-picture').replaceChildren();
  if (item.lesson.kind === 'item') $('quiz-picture').append(itemImageNode(item.lesson, true));
  $('recall-help').textContent = item.lesson.kind === 'item'
    ? text('Say your answer aloud before choosing. The picture is your memory cue.', '先大声说出答案，再选择。物品图片可以帮助你回忆。')
    : text('Try saying your answer aloud before choosing.', '先尝试大声说出答案，再选择。');
  $('answers').replaceChildren(); $('quiz-audio').replaceChildren(); $('result').textContent = ''; $('quiz-explanation').textContent = '';
  $('next').hidden = !showFeedback;
  $('next').textContent = active.completedAt ? text('See session summary →', '查看学习总结 →') : text('Next question →', '下一题 →');
  for (const option of item.question.options) {
    const button = node('button', option); button.disabled = Boolean(showFeedback || pendingAnswer);
    if (showFeedback && option === item.question.answer) button.classList.add('correct');
    if (showFeedback && !showFeedback.correct && option === showFeedback.choice) button.classList.add('wrong');
    button.onclick = async () => {
      if (pendingAnswer || study.active.id !== active.id || study.active.answers.length !== index) return;
      pendingAnswer = true;
      for (const control of $('answers').children) control.disabled = true;
      try {
        receive(await api.answerSession(active.id, item.lesson.id, option));
        feedbackIndex = index;
        if (mode === 'quiz') render();
      } catch (error) { $('result').textContent = error.message; for (const control of $('answers').children) control.disabled = false; }
      finally { pendingAnswer = false; }
    };
    $('answers').append(button);
  }
  if (showFeedback) {
    $('result').textContent = showFeedback.correct ? text('Correct! Scheduled for a later review.', '答对了！已安排后续复习。') : text('Answer: ', '正确答案：') + item.question.answer;
    const cue = itemCoaching(item.lesson);
    $('quiz-explanation').textContent = (cue ? cue.en + '\n' + cue.zh + '\n\n' : '') + item.lesson.descriptionEn + '\n' + item.lesson.descriptionZh;
    $('quiz-audio').append(audioButton(item.lesson));
  }
}
function renderSummary(active) {
  player.stop();
  $('session-summary').hidden = false;
  const correct = active.answers.filter(answer => answer.correct).length;
  $('summary-score').textContent = text('You answered ', '本轮答对 ') + correct + ' / ' + active.items.length + text(' correctly.', ' 道题。');
  $('summary-tip').textContent = text('Correct words return on their review date. Mistakes are due again after one minute.', '答对的词条按复习日期再次出现，错题一分钟后到期。');
  const mistakes = active.answers.filter(answer => !answer.correct);
  $('mistakes-heading').hidden = !mistakes.length;
  $('session-mistakes').replaceChildren();
  for (const answer of mistakes) {
    const item = active.items.find(item => item.lesson.id === answer.id);
    const card = node('article', '', 'review-word');
    card.append(node('strong', item.lesson.en + ' · ' + item.lesson.zh));
    const actions = node('div', '', 'actions'), listen = audioButton(item.lesson);
    const save = node('button', progress[answer.id]?.saved ? text('★ Saved', '★ 已收藏') : text('☆ Save word', '☆ 收藏'));
    save.onclick = async () => {
      save.disabled = true;
      try { await persist(answer.id, 'saved', !progress[answer.id]?.saved); renderSummary(active); }
      catch (error) { $('study-status').textContent = error.message; save.disabled = false; }
    };
    actions.append(listen, save); card.append(actions); $('session-mistakes').append(card);
  }
}
function enterPractice(scope) {
  player.stop();
  mode = 'quiz'; feedbackIndex = null;
  planning = Boolean(scope && study.active?.completedAt);
  const options = study.active?.options || study.preferences;
  $('session-size').value = options.size; $('session-scope').value = study.active && !study.active.completedAt ? options.scope : scope || options.scope;
  if (study.active && !study.active.completedAt) {
    $('kind').value = options.kind; $('search').value = options.search; $('direction').value = options.direction;
  }
  render();
  focusStudy();
}
function focusStudy() {
  const heading = !$('guided-lesson').hidden ? $('guide-heading') : !$('practice').hidden ? $('question') : !$('session-summary').hidden ? $('summary-heading') : $('study-heading');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  heading.closest('section').scrollIntoView({ block: 'start' });
}
async function beginSession() {
  if (starting) return;
  player.stop();
  starting = true; $('start-session').disabled = true; $('new-session').disabled = true;
  try {
    const response = await api.startSession({ size: Number($('session-size').value), scope: $('session-scope').value,
      kind: $('kind').value, search: $('search').value, direction: $('direction').value });
    receive(response); feedbackIndex = null;
    if (!response.empty) planning = false;
    if (!response.empty && study.active) {
      const options = study.active.options;
      $('kind').value = options.kind; $('search').value = options.search; $('direction').value = options.direction;
      $('session-size').value = options.size; $('session-scope').value = options.scope;
    }
    $('study-status').textContent = response.empty ? text('No words are ready in this collection. Save some words, change topic, or return when reviews are due.', '此词库暂无到期课程。请先收藏词条、更换主题，或到复习时间再来。') : text('Your session is saved automatically. You can finish it later.', '本轮进度自动保存，可以稍后继续。');
    if (mode === 'quiz') { render(); focusStudy(); }
  } catch (error) { $('study-status').textContent = error.message; }
  finally { starting = false; $('start-session').disabled = false; $('new-session').disabled = false; quickLabel(); }
}
for (const [id, m] of [['starter-tab', 'starter'], ['heroes-tab', 'heroes'], ['items-tab', 'items'], ['phrases-tab', 'phrases'], ['browse', 'browse'], ['saved', 'saved'], ['quiz', 'quiz']]) $(id).onclick = () => {
  player.stop();
  if (m === 'quiz') enterPractice();
  else {
    if (m === 'heroes' && mode === 'heroes') selectedHeroId = null;
    if (m === 'items' && mode === 'items') { itemCategory = 'all'; selectedItemId = null; }
    if (m === 'saved' && mode !== 'saved') $('kind').value = 'all';
    if (m === 'browse' && mode !== 'browse') $('kind').value = 'all';
    mode = m; limit = 24; render();
  }
};
$('hero-back').onclick = () => { player.stop(); selectedHeroId = null; render(); };
for (const id of ['search', 'kind', 'direction']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { player.stop(); hideShopHoverTip(); if (id === 'search') { selectedHeroId = null; selectedItemId = null; } limit = 24; render(); });
window.addEventListener('scroll', hideShopHoverTip, { passive: true });
window.addEventListener('keydown', event => {
  if (mode !== 'items' || !selectedItemId) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (event.key === 'Escape') { selectShopItem(null, { scroll: false }); return; }
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && visibleShopItems.length > 1) {
    const idx = visibleShopItems.findIndex(item => item.id === selectedItemId);
    if (idx < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    selectShopItem(visibleShopItems[(idx + step + visibleShopItems.length) % visibleShopItems.length].id, { scroll: false });
  }
});
$('practice-saved').onclick = () => { enterPractice('saved'); };
$('quick-practice').onclick = async () => {
  if (mode === 'starter') {
    const unit = nextStarterUnit();
    if (study.active && !study.active.completedAt) enterPractice();
    else if (unit) await startStarterUnit(unit);
    return;
  }
  const running = study.active && !study.active.completedAt;
  const kind = ({ heroes: 'hero', items: 'item', phrases: 'phrase' })[mode] || $('kind').value;
  const scope = mode === 'saved' ? 'saved' : 'all';
  enterPractice(scope);
  if (running) return;
  $('kind').value = kind; $('session-size').value = '5'; $('session-scope').value = scope;
  await beginSession();
};
$('start-session').onclick = beginSession;
$('guide-next').onclick = async () => {
  const active = study.active;
  if (advancing || !isLearningStep(active)) return;
  advancing = true; $('guide-next').disabled = true; $('guide-status').textContent = ''; player.stop();
  try {
    receive(await api.advanceGuide(active.id, active.items[active.guideIndex].lesson.id));
    if (mode === 'quiz') { render(); focusStudy(); }
  } catch (error) { $('guide-status').textContent = error.message; }
  finally { advancing = false; $('guide-next').disabled = false; }
};
$('new-session').onclick = () => { planning = true; feedbackIndex = null; render(); focusStudy(); };
$('more').onclick = () => { limit += 24; render(); };
$('next').onclick = () => { player.stop(); feedbackIndex = null; render(); focusStudy(); };
$('patches').onclick = async () => { const response = await api.sources(); if (!response.ok) $('update-status').textContent = response.error; };
$('refresh').onclick = async () => {
  $('refresh').disabled = true; $('update-status').textContent = text('Fetching bilingual lessons from Valve. This can take a few minutes…', '正在从 Valve 获取双语课程，可能需要几分钟…');
  try {
    const response = await api.update(); if (!response.ok) throw new Error(response.error);
    catalog = response.catalog; stats(); render();
    $('update-status').textContent = text('Catalog updated. Your learning progress is preserved.', '课程已更新，学习进度已保留。');
  } catch (error) { $('update-status').textContent = text('Update failed; offline lessons remain available. ', '更新失败，仍可使用离线课程。') + error.message; }
  finally { $('refresh').disabled = false; }
};
function setVoiceBarState(state, active) {
  $('voice-practice-bar').dataset.state = state;
  $('voice-bar-stop').hidden = !active;
  $('voice-bar-dismiss').hidden = active;
}
function startVoiceBar(topic) {
  $('voice-practice-bar').hidden = false;
  $('voice-bar-topic').textContent = `🎙️ ${topic}`;
  $('voice-bar-status').textContent = text('Connecting…', '正在连接语音…');
  $('voice-bar-stop').textContent = text('■ Stop Voice', '■ 停止语音');
  setVoiceBarState('connecting', true);
}
$('voice-bar-stop').onclick = async () => {
  await api.stopVoice?.();
  $('voice-bar-status').textContent = text('Stopped', '已停止');
  setVoiceBarState('disconnected', false);
};
$('voice-bar-dismiss').onclick = () => {
  $('voice-practice-bar').hidden = true;
};
api.onVoiceStatus?.((data) => {
  if ($('voice-practice-bar').hidden && data?.status === 'disconnected') return;
  $('voice-practice-bar').hidden = false;
  const map = {
    connecting: text('Connecting…', '正在连接语音…'),
    connected: text('Listening… Speak English now', '已连接 · 请开口说英语'),
    speaking: text('Coach speaking…', '教练正在回复…'),
    disconnected: text('Disconnected', '已断开'),
    error: data?.error || text('Voice error', '语音出错'),
  };
  const status = data?.status || 'connected';
  $('voice-bar-status').textContent = map[status] || data?.provider || status;
  setVoiceBarState(status, !['disconnected', 'error'].includes(status));
});
api.onVoiceEvent?.(({ channel }) => {
  if ($('voice-practice-bar').hidden) return;
  if (channel === 'voice:text-delta') {
    $('voice-bar-status').textContent = text('Coach speaking…', '教练正在回复…');
    $('voice-practice-bar').dataset.state = 'speaking';
  } else if (channel === 'voice:complete') {
    $('voice-bar-status').textContent = text('Listening… Speak English now', '已连接 · 请开口说英语');
    $('voice-practice-bar').dataset.state = 'connected';
  }
});
api.onProgress(({ done, total }) => { $('update-status').textContent = text(`Updating ${done}/${total} heroes and items…`, `更新英雄与物品 ${done}/${total}…`); });
api.onHidden(() => player.stop());
window.addEventListener('pagehide', () => player.stop());
try {
  const response = await api.load(); if (!response.ok) throw new Error(response.error);
  catalog = response.catalog; heroMeta = response.heroMeta || {}; itemImages = response.itemImages || { entries: {} }; itemShopCategories = response.itemShopCategories || { entries: {} }; starterEvidence = response.starterEvidence || { entries: {} }; audioManifest = response.audio; audioBaseline = response.audioBaseline; receive(response); $('session-size').value = study.preferences.size; $('session-scope').value = study.preferences.scope; render();
} catch (error) { $('message').textContent = error.message; for (const button of document.querySelectorAll('button')) button.disabled = true; }

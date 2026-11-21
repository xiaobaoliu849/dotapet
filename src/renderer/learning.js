import { recordedAudio } from '../learning/audioAssets.js';
import { audioFreshness } from '../learning/contentAudit.js';
import { createLearningAudio } from './learning-audio.js';
import { canQuizLesson, filterLessons } from '../learning/model.js';
import { itemImageSources } from '../learning/itemImages.js';
import { itemCoaching } from '../learning/itemCoaching.js';
import { resolveItemDetails } from '../learning/itemDetails.js';
import {
  SHOP_REALMS, SHOP_SHELVES, SHOP_CATEGORIES, CATEGORY_BY_KEY,
  isActiveItem, classifyItem, realmCounts, groupItemsByCategory, searchShopItems,
} from '../learning/itemShop.js';
import {
  getLessonPatchChange, getHeroPatchSummary, summarizePatchChanges, formatPatchStatLabel,
} from '../learning/patchChanges.js';
import { MASTERY_BOX_THRESHOLD, summarizeMastery } from '../learning/mastery.js';
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
  heading: '刀塔英语学堂', 'total-label': '条双语课程', 'saved-label': '个收藏词条', 'due-label': '条待复习', 'accuracy-label': '答题正确率',
  'starter-tab-label': '从这里开始', 'heroes-tab-label': '英雄图鉴', 'items-tab-label': '物品图鉴', 'phrases-tab-label': '实战口语', 'browse-label': '探索课程', 'saved-tab-label': '我的词本', 'quiz-tab-label': '练习测验',
  'search-label': '查找课程', 'kind-label': '学习主题', 'direction-label': '练习方向', next: '下一题 →', more: '加载更多',
  'hero-back': '← 返回四属性英雄墙', 'hero-abilities-heading': '英雄技能（中英双语对照）',
  'step-see': '看图认物', 'step-read': '读懂英文', 'step-say': '开口说', 'step-recall': '回忆巩固',
  'progress-heading': '学习总览',
  'quick-practice': '练习 5 条课程 →', 'recall-help': '先大声说出答案，再选择。物品图片可以帮助你回忆。',
  'starter-heading': '先学会十个常见物品名', 'starter-help': '每次学五个词。先看图、读含义、说一句实战表达，再回忆英文。这是英语学习顺序，不是游戏出装顺序。',
  'guide-heading': '先认识，再回忆', 'guide-help': '看图，读懂含义，再大声说出实战表达。准备好后点击下一步。学习卡本身不计答题正确率。', 'guide-next': '下一张学习卡 →',
  'voice-bar-hint': '实时对话与双语字幕已同步显示在桌面伙伴「实时对话转写」面板中。',
  'study-heading': '每日学习小课', 'study-help': '先复习到期的错题和旧词，再学习新词。', 'size-label': '每轮课程数量', 'scope-label': '练习词库', 'start-session': '开始学习 →', 'practice-saved': '练习我的收藏词条 →', 'summary-heading': '本轮学习完成', 'mistakes-heading': '需要再看看的词条', 'new-session': '安排下一轮 →',
  'guide-end': '× 结束本轮', 'quiz-end': '× 结束本轮', 'resume-paused': '继续之前的练习 →', 'discard-paused': '放弃',
  'audio-source': '音频使用你的双语词典中已生成的 AI 录音，按原速播放。历史录音可能与当前课程文字不同；缺少录音的词条会明确标注。',
  'sources-heading': '课程数据与更新', 'footer-notes-label': '数据与音频说明', freshness: '技能说明是有日期的数据快照。数值和机制请以官方更新日志为准。', refresh: '从 Valve 更新课程', patches: '官方更新日志 ↗',
};
if (chinese) {
  for (const [id, value] of Object.entries(translations)) { const el = $(id); if (el) el.textContent = value; }
  const names = ['全部主题', '英雄', '英雄技能', '物品', '团队表达'];
  [...$('kind').options].forEach((option, index) => { option.textContent = names[index]; });
  [...$('session-size').options].forEach(option => { option.textContent = option.value + ' 条课程'; });
  [...$('session-scope').options].forEach((option, index) => { option.textContent = ['符合筛选的全部课程', '仅收藏词条', '入门：对线补给', '入门：视野与行动'][index]; });
  $('search').placeholder = '搜索英文 / 中文 / 英雄名…';
}
let catalog, heroMeta = {}, progress = {}, study = { preferences: STUDY_DEFAULTS, active: null, paused: null, history: [] }, mode = 'starter', limit = 24;
let selectedHeroId = null, attrFilter = 'all', spokenFilter = 'all', heroPatchOnly = false, heroDetailPatchOnly = false, browsePatchOnly = false;
let itemRealm = 'shop', itemCategory = 'all', itemQuickFilter = 'all', itemViewMode = 'grid', selectedItemId = null;
let visibleShopItems = [], lastShopTrigger = null;
let patchModalTab = 'highlights', patchModalItemRealm = 'all', lastPatchTrigger = null;
let itemOpenedFromPatch = null, heroOpenedFromPatch = null, returnContext = null;
let audioManifest = { entries: {} };
let itemImages = { entries: {} };
let itemShopCategories = { entries: {} };
let itemDetails = { entries: {} };
let starterEvidence = { entries: {} };
let patchChanges = { schema: 1, patch: null, removed: [], entries: {} };
let audioBaseline = { entries: {} };
let pendingAnswer = false, starting = false, feedbackIndex = null, planning = false, advancing = false;
let revealedRecall = null;
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
const currentPatch = () => catalog?.patch || patchChanges?.patch || null;
const hasPatchDiff = () => Boolean(currentPatch() && (Object.keys(patchChanges?.entries || {}).length || (patchChanges?.removed?.length || 0)));
function formatPatchReleaseDate() {
  const iso = patchChanges?.releasedAt || catalog?.patchDate;
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return chinese
    ? dt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function patchBadgeNode(change, { compact = false } = {}) {
  if (!change) return null;
  const ver = currentPatch();
  if (change.type === 'added') {
    const label = compact
      ? (ver ? text(`${ver} NEW`, `${ver} 新增`) : text('NEW', '新增'))
      : (ver ? text(`✨ NEW in ${ver}`, `✨ ${ver} 新增`) : text('✨ NEW', '✨ 新增'));
    return node('span', label, `patch-badge is-new${compact ? ' is-compact' : ''}`);
  }
  if (change.type === 'changed') {
    const label = compact
      ? (ver ? text(`${ver} Updated`, `${ver} 改动`) : text('Updated', '改动'))
      : (ver ? text(`↻ Updated in ${ver}`, `↻ ${ver} 改动`) : text('↻ Updated', '↻ 改动'));
    return node('span', label, `patch-badge is-changed${compact ? ' is-compact' : ''}`);
  }
  return null;
}
function buildPatchDiffBox(change, { compact = false } = {}) {
  if (!change) return null;
  const ver = currentPatch() || '';
  const prev = patchChanges?.previousPatch;
  if (change.type === 'added') {
    if (compact) return null;
    const box = node('section', '', 'patch-callout is-new');
    const head = node('div', '', 'patch-callout-head');
    head.append(node('span', text(`✨ New in Patch ${ver}`, `✨ ${ver} 版本全新加入`), 'patch-callout-title'));
    const dateStr = formatPatchReleaseDate();
    if (dateStr) head.append(node('span', dateStr, 'patch-callout-meta'));
    box.append(head, node('p', text(
      'Brand-new addition synced from Valve’s latest official bilingual data feed.',
      '同步自 Valve 最新官方中英双语数据的新增内容。',
    ), 'patch-callout-desc'));
    return box;
  }
  if (change.type !== 'changed') return null;
  const stats = Array.isArray(change.stats) ? change.stats : [];
  if (compact && !stats.length) return null;

  const box = node('section', '', `patch-callout is-changed${compact ? ' is-compact' : ''}`);
  const head = node('div', '', 'patch-callout-head');
  head.append(node('span', text(`↻ Patch ${ver} Changes`, `↻ ${ver} 版本改动`), 'patch-callout-title'));
  if (prev) head.append(node('span', text(`vs. ${prev}`, `对比 ${prev}`), 'patch-callout-meta'));
  box.append(head);

  if (stats.length) {
    const list = node('div', '', 'patch-diff-list');
    const limitRows = compact ? 3 : stats.length;
    for (const st of stats.slice(0, limitRows)) {
      const row = node('div', '', 'patch-diff-row');
      const labelWrap = node('span', '', 'patch-diff-label');
      labelWrap.append(node('span', chinese ? (st.zh || st.en) : (st.en || st.zh)));
      if (st.scope === 'shard' || st.scope === 'scepter') {
        labelWrap.append(node('span', st.scope === 'shard' ? text('Shard', '魔晶') : text('Scepter', '神杖'), `patch-scope-tag is-${st.scope}`));
      }
      const values = node('span', '', 'patch-diff-values');
      values.append(
        node('span', st.before, 'diff-before'),
        node('span', '→', 'diff-arrow'),
        node('strong', st.after, 'diff-after'),
      );
      row.append(labelWrap, values);
      list.append(row);
    }
    if (compact && stats.length > limitRows) {
      list.append(node('span', text(`+${stats.length - limitRows} more changes`, `还有 ${stats.length - limitRows} 项改动`), 'patch-diff-more'));
    }
    box.append(list);
  } else if (change.textChanged) {
    box.append(node('p', text(
      `Description or mechanics wording updated in Patch ${ver}.`,
      `${ver} 版本更新了文字说明或机制描述。`,
    ), 'patch-callout-desc'));
  }

  if (!compact && (change.beforeDescEn || change.beforeDescZh)) {
    const details = node('details', '', 'patch-before-details');
    details.append(node('summary', prev
      ? text(`Compare previous ${prev} description`, `对比 ${prev} 旧版说明`)
      : text('Compare previous description', '对比改动前旧版说明')));
    const body = node('div', '', 'patch-before-body');
    if (change.beforeDescEn) body.append(node('p', change.beforeDescEn, 'patch-before-en'));
    if (change.beforeDescZh) body.append(node('p', change.beforeDescZh, 'patch-before-zh'));
    details.append(body);
    box.append(details);
  }
  return box;
}
function selection() {
  const rows = filterLessons(catalog.lessons, { kind: $('kind').value, search: $('search').value, saved: mode === 'saved', progress });
  if (mode === 'browse' && browsePatchOnly && hasPatchDiff()) {
    return rows.filter(lesson => Boolean(getLessonPatchChange(patchChanges, lesson.id)));
  }
  return rows;
}
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
  const savedTotal = catalog.lessons.filter(r => progress[r.id]?.saved).length;
  $('saved-count').textContent = savedTotal;
  const savedBadge = $('saved-tab-badge');
  if (savedBadge) { savedBadge.textContent = String(savedTotal); savedBadge.hidden = savedTotal === 0; }
  const counts = reviewCounts(catalog.lessons, progress);
  $('due-count').textContent = counts.reviews;
  const dueBadge = $('due-tab-badge');
  if (dueBadge) { dueBadge.textContent = String(counts.reviews); dueBadge.hidden = counts.reviews === 0; }
  const statusEl = $('path-status');
  statusEl.dataset.due = String(counts.reviews > 0);
  statusEl.disabled = counts.reviews === 0;
  statusEl.title = counts.reviews > 0 ? text('Click to review due words now', '点击立即开始复习到期词条') : '';
  statusEl.textContent = counts.reviews > 0
    ? text(`${counts.reviews} due for review`, `${counts.reviews} 条待复习`)
    : text('Learn Dota, speak English', '玩懂刀塔，开口说英语');
  quickLabel();
  const records = Object.values(progress), attempts = records.reduce((n, r) => n + (r.attempts || 0), 0);
  $('accuracy').textContent = attempts ? Math.round(records.reduce((n, r) => n + (r.correct || 0), 0) / attempts * 100) + '%' : '—';
  const ver = currentPatch();
  const patchPill = $('patch-pill');
  if (patchPill) {
    if (ver) {
      patchPill.hidden = false;
      patchPill.replaceChildren(
        node('span', '', 'patch-pill-dot'),
        node('span', text(`Patch ${ver}`, `${ver} 最新`), 'patch-pill-ver'),
        node('span', hasPatchDiff() ? text('What’s new', '看更新') : text('Latest', '最新版本'), 'patch-pill-cta'),
      );
      patchPill.title = text(
        `Synced to Dota 2 Patch ${ver} — click to inspect new items, hero changes, and stat diffs`,
        `已同步 Dota 2 最新 ${ver} 版本 — 点击查看新增物品、英雄改动与数值对比`,
      );
      patchPill.setAttribute('aria-label', text(`Dota 2 Patch ${ver} — What’s new`, `Dota 2 ${ver} 最新版本 — 查看更新内容`));
    } else {
      patchPill.hidden = true;
    }
  }
  const patchText = ver ? text(`Patch ${ver} · Latest`, `${ver} 最新版本`) : text('Patch number unverified', '未核验版本号');
  $('source').textContent = `${catalog.sourceLabel} · ${patchText} · ${new Date(catalog.fetchedAt).toLocaleString()}`;
  const strip = $('mastery-strip');
  if (strip) {
    strip.replaceChildren();
    for (const item of summarizeMastery(catalog.lessons, progress)) {
      const card = node('button', '', 'mastery-card');
      card.type = 'button';
      card.dataset.masteryKey = item.key;
      card.title = text(
        `${item.en}: ${item.mastered} mastered (${MASTERY_BOX_THRESHOLD}+ correct in a row, 7-day review tier), ${item.practiced} practiced, ${item.saved} saved. Click to browse.`,
        `${item.zh}：已掌握 ${item.mastered}（需连续答对 ${MASTERY_BOX_THRESHOLD} 次进入 7 天复习档），练过 ${item.practiced}，收藏 ${item.saved}。点击浏览该分类。`,
      );
      const top = node('div', '', 'mastery-card-top');
      top.append(node('span', `${item.icon} ${text(item.en, item.zh)}`, 'mastery-title'), node('span', `${item.mastered}/${item.total}`, 'mastery-count'));
      const bar = node('div', '', 'mastery-bar');
      const practicedFill = node('div', '', 'mastery-fill-practiced');
      practicedFill.style.width = `${item.practiced > 0 ? Math.max(item.pct, 4) : 0}%`;
      const fill = node('div', '', 'mastery-fill');
      fill.style.width = `${item.mastered > 0 ? Math.max(item.masteredPct, 4) : 0}%`;
      bar.append(practicedFill, fill);
      const sub = node('span', text(`${item.mastered} mastered · ${item.practiced} practiced · ${item.saved} saved`, `已掌握 ${item.mastered} · 练过 ${item.practiced} · 收藏 ${item.saved}`), 'mastery-sub');
      card.append(top, bar, sub);
      card.onclick = () => {
        player.stop();
        $('search').value = '';
        if (item.key === 'hero') { mode = 'heroes'; selectedHeroId = null; heroOpenedFromPatch = null; heroPatchOnly = false; attrFilter = 'all'; }
        else if (item.key === 'item') { mode = 'items'; itemCategory = 'all'; itemQuickFilter = 'all'; selectedItemId = null; }
        else if (item.key === 'phrase') { mode = 'phrases'; spokenFilter = 'all'; }
        else { mode = 'browse'; $('kind').value = item.key; browsePatchOnly = false; limit = 24; }
        render();
        window.scrollTo(0, 0);
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
    button.title = changed ? text('The current explanation differs from the archived source. Treat this recording as historical; use current text for gameplay.', '当前说明与历史来源文字不同。此录音作为历史内容，游戏机制请以当前文字为准。') : extraContext ? text('The main explanation matches the archived source, but extra notes and stats still need review.', '主要说明与历史来源一致，额外备注和数值仍需核验。') : needsStats ? text('The current item source has attributes without a written explanation. This recording needs a separate stats check.', '当前物品来源提供属性，未提供文字说明；此录音需要单独核验属性。') : unresolved ? text('Some current values could not be resolved. Check the game before relying on recorded numbers.', '部分当前数值尚未解析，请在游戏中确认后再采用录音中的数字。') : freshness.status === 'current-verified' ? text('Generated AI recording matching the current official text.', '与当前官方说明一致的 AI 录音。') : text('Archived AI recording. Matching source text does not verify the MP3 transcript.', '历史 AI 录音。来源文字相同不代表已经核验 MP3 的实际台词。');
    button.onclick = () => player.toggle(lesson.id, new URL('assets/learning-audio/' + entry.file, location.href).href);
  }
  return button;
}
function saveButton(lesson, onUpdated) {
  const sync = button => {
    const isSaved = Boolean(progress[lesson.id]?.saved);
    button.textContent = isSaved ? text('★ Saved', '★ 已收藏') : text('☆ Save word', '☆ 收藏');
    button.setAttribute('aria-pressed', String(isSaved));
  };
  const save = node('button', '');
  save.type = 'button';
  sync(save);
  save.onclick = async event => {
    event?.stopPropagation?.();
    save.disabled = true;
    try {
      await persist(lesson.id, 'saved', !progress[lesson.id]?.saved);
      sync(save);
      save.disabled = false;
      onUpdated?.();
    } catch (error) {
      $('message').textContent = error.message;
      save.disabled = false;
    }
  };
  return save;
}
function renderHeroBrowser() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const allHeroes = catalog.lessons.filter(l => l.kind === 'hero');
  const patchByHero = new Map(allHeroes.map(h => [h.id, getHeroPatchSummary(patchChanges, h, heroAbilities(h))]));
  const patchHeroesCount = allHeroes.filter(h => patchByHero.get(h.id)?.totalCount > 0).length;
  const matching = allHeroes.filter(h => {
    if (attrFilter !== 'all' && heroAttr(h) !== attrFilter) return false;
    if (heroPatchOnly && !(patchByHero.get(h.id)?.totalCount > 0)) return false;
    if (!query) return true;
    return [h.en, h.zh, h.descriptionEn, h.descriptionZh].some(s => (s || '').toLocaleLowerCase().includes(query))
      || heroAbilities(h).some(a => [a.en, a.zh].some(s => (s || '').toLocaleLowerCase().includes(query)));
  });
  const ver = currentPatch();
  $('message').textContent = matching.length
    ? heroPatchOnly && ver
      ? text(`${matching.length} heroes changed in Patch ${ver} · Click any hero to inspect exact ability diffs.`, `${ver} 版本共 ${matching.length} 位英雄有技能改动 · 点击查看具体新旧数值对比。`)
      : text(`${matching.length} heroes across 4 attributes · Click any hero to view bilingual abilities.`, `共 ${matching.length} 位英雄 · 点击任意英雄查看中英双语技能与发音。`)
    : text('No matching heroes found.', '未找到匹配的英雄，请更换搜索词。');
  const filters = $('attr-filters');
  filters.replaceChildren();
  const allBtn = node('button', text(`All (${allHeroes.length})`, `全部 (${allHeroes.length})`), 'attr-pill');
  allBtn.setAttribute('aria-pressed', String(attrFilter === 'all' && !heroPatchOnly));
  allBtn.onclick = () => { attrFilter = 'all'; heroPatchOnly = false; render(); };
  filters.append(allBtn);
  for (const group of ATTR_GROUPS) {
    const count = allHeroes.filter(h => heroAttr(h) === group.key).length;
    const btn = node('button', `${group.icon} ${text(group.en, group.zh)} (${count})`, `attr-pill attr-${group.key}`);
    btn.setAttribute('aria-pressed', String(attrFilter === group.key));
    btn.onclick = () => { attrFilter = group.key; render(); };
    filters.append(btn);
  }
  if (ver && patchHeroesCount > 0) {
    const patchBtn = node('button', text(`✨ ${ver} Changes (${patchHeroesCount})`, `✨ ${ver} 改动 (${patchHeroesCount})`), 'attr-pill patch-filter-pill');
    patchBtn.type = 'button';
    patchBtn.setAttribute('aria-pressed', String(heroPatchOnly));
    patchBtn.onclick = () => { heroPatchOnly = !heroPatchOnly; render(); };
    filters.append(patchBtn);
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
      const heroPatch = patchByHero.get(hero.id);
      const tile = node('button', '', `hero-tile attr-${group.key}${heroPatch?.addedCount ? ' is-patch-new' : ''}`);
      tile.type = 'button';
      const info = node('span', '', 'hero-tile-info');
      const metaRow = node('span', '', 'hero-tile-meta-row');
      metaRow.append(node('span', text(`${abilitiesCount} abilities`, `${abilitiesCount} 个技能`), 'hero-tile-meta'));
      if (ver && heroPatch?.addedCount > 0) {
        metaRow.append(node('span', text(`${ver} NEW`, `${ver} 新技能`), 'hero-patch-chip is-new'));
      } else if (ver && heroPatch?.totalCount > 0) {
        metaRow.append(node('span', text(`${ver} · ${heroPatch.totalCount}`, `${ver} 改${heroPatch.totalCount}`), 'hero-patch-chip is-changed'));
      }
      info.append(node('strong', hero.en), node('span', hero.zh, 'hero-tile-zh'), metaRow);
      tile.append(heroAvatarNode(hero, false), info);
      if (progress[hero.id]?.saved) tile.append(node('span', '★', 'hero-tile-saved'));
      tile.onclick = () => { selectedHeroId = hero.id; heroDetailPatchOnly = false; heroOpenedFromPatch = null; render(); $('hero-detail').scrollIntoView({ block: 'start' }); };
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
  const heroPatch = getHeroPatchSummary(patchChanges, hero, abilities);
  const ver = currentPatch();
  $('message').textContent = text(`${hero.en} (${hero.zh}) · ${abilities.length} bilingual abilities`, `${hero.zh} (${hero.en}) · 共 ${abilities.length} 个双语技能`);
  const header = $('hero-detail-header');
  header.replaceChildren();
  const topRow = node('div', '', 'hero-detail-top');
  const titleWrap = node('div', '', 'hero-detail-title');
  const badgeRow = node('div', '', 'hero-detail-badges');
  badgeRow.append(node('span', `${group.icon} ${group.en} · ${group.zh}`, `topic attr-badge-${attrKey}`));
  if (ver && heroPatch.totalCount > 0) {
    const parts = [];
    if (heroPatch.addedCount) parts.push(text(`+${heroPatch.addedCount} New`, `新增 ${heroPatch.addedCount}`));
    if (heroPatch.changedCount) parts.push(text(`${heroPatch.changedCount} Updated`, `调整 ${heroPatch.changedCount}`));
    if (heroPatch.removedAbilities.length) parts.push(text(`-${heroPatch.removedAbilities.length} Removed`, `移除 ${heroPatch.removedAbilities.length}`));
    const jumpPill = node('button', `${text(`Patch ${ver}`, `${ver} 版本`)} · ${parts.join(' · ')} ↓`, `patch-badge hero-patch-jump ${heroPatch.addedCount ? 'is-new' : 'is-changed'}`);
    jumpPill.type = 'button';
    jumpPill.title = text(`Show only Patch ${ver} ability changes`, `筛选并定位到 ${ver} 版本变动技能`);
    jumpPill.onclick = () => {
      heroDetailPatchOnly = true;
      renderHeroDetail(hero);
      $('hero-abilities-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    badgeRow.append(jumpPill);
  }
  titleWrap.append(badgeRow, node('h2', `${hero.en} · ${hero.zh}`));
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
    } catch (error) { $('message').textContent = error.message; $('voice-bar-status').textContent = error.message; setVoiceBarState('error', false); }
    finally { talkBtn.disabled = false; }
  };
  heroActions.append(audioButton(hero), saveButton(hero), talkBtn);
  header.append(heroActions);

  const patchToggle = $('hero-abilities-patch-toggle');
  if (patchToggle) {
    const hasHeroChanges = Boolean(ver && heroPatch.totalCount > 0);
    if (!hasHeroChanges) heroDetailPatchOnly = false;
    patchToggle.hidden = !hasHeroChanges;
    if (hasHeroChanges) {
      patchToggle.textContent = text(`✨ ${ver} changes only (${heroPatch.totalCount})`, `✨ 仅看 ${ver} 改动 (${heroPatch.totalCount})`);
      patchToggle.setAttribute('aria-pressed', String(heroDetailPatchOnly));
      patchToggle.onclick = () => { heroDetailPatchOnly = !heroDetailPatchOnly; renderHeroDetail(hero); };
    }
  }

  const list = $('hero-abilities');
  list.replaceChildren();
  const visibleAbilities = heroDetailPatchOnly
    ? abilities
      .filter(ab => Boolean(getLessonPatchChange(patchChanges, ab.id)))
      .sort((a, b) => {
        const ta = getLessonPatchChange(patchChanges, a.id)?.type === 'added' ? 0 : 1;
        const tb = getLessonPatchChange(patchChanges, b.id)?.type === 'added' ? 0 : 1;
        return ta - tb;
      })
    : abilities;
  for (const ability of visibleAbilities) {
    const abChange = getLessonPatchChange(patchChanges, ability.id);
    const card = node('article', '', `lesson ability-bilingual-card${abChange?.type === 'added' ? ' is-patch-new' : abChange?.type === 'changed' ? ' is-patch-changed' : ''}`);
    const cardHead = node('div', '', 'ability-card-head');
    const titleGroup = node('div', '', 'ability-head-title');
    titleGroup.append(node('h4', ability.en));
    const badge = patchBadgeNode(abChange);
    if (badge) titleGroup.append(badge);
    cardHead.append(titleGroup, node('span', ability.zh, 'ability-zh-name'));
    const pills = node('div', '', 'ability-pills');
    const cds = ability.mechanics?.cooldowns?.filter(n => n > 0);
    const manas = ability.mechanics?.mana_costs?.filter(n => n > 0);
    if (cds?.length) pills.append(node('span', `CD: ${[...new Set(cds)].join(' / ')}s`, 'mech-pill'));
    if (manas?.length) pills.append(node('span', `Mana: ${[...new Set(manas)].join(' / ')}`, 'mech-pill'));
    card.append(cardHead);
    if (pills.childElementCount) card.append(pills);
    const diffBox = buildPatchDiffBox(abChange);
    if (diffBox) card.append(diffBox);
    if (ability.descriptionEn) card.append(node('p', ability.descriptionEn, 'description'));
    if (ability.descriptionZh) card.append(node('p', ability.descriptionZh, 'description zh-block'));
    const actions = node('div', '', 'actions');
    actions.append(audioButton(ability), saveButton(ability));
    card.append(actions);
    list.append(card);
  }
  if (heroPatch.removedAbilities.length) {
    const removedBox = node('article', '', 'ability-removed-card');
    removedBox.append(node('h4', text(`Removed in Patch ${ver || ''}`, `${ver || ''} 版本已移除技能`)));
    const chips = node('div', '', 'removed-ability-list');
    for (const rem of heroPatch.removedAbilities) {
      const chip = node('span', rem.zh && rem.zh !== rem.en ? `${rem.en} · ${rem.zh}` : rem.en, 'removed-ability-chip');
      chips.append(chip);
    }
    removedBox.append(chips);
    list.append(removedBox);
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
      } catch (error) { $('message').textContent = error.message; $('voice-bar-status').textContent = error.message; setVoiceBarState('error', false); }
      finally { talkBtn.disabled = false; }
    };
    actions.append(copyBtn, saveButton(phrase), talkBtn);
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
  const change = getLessonPatchChange(patchChanges, lesson.id);
  const ver = currentPatch();
  tip.replaceChildren();
  const top = node('div', '', 'shop-tip-top');
  top.append(itemImageNode(lesson));
  const meta = node('div', '', 'shop-tip-meta');
  meta.append(node('strong', lesson.en), node('span', lesson.zh, 'shop-tip-zh'));
  const badges = node('div', '', 'shop-tip-badges');
  if (cat) badges.append(node('span', text(cat.en, cat.zh), 'shop-tip-cat'));
  if (cost > 0) badges.append(node('span', `🪙 ${cost}g`, 'shop-tip-cost'));
  if (ver && change?.type === 'added') badges.append(node('span', text(`✨ ${ver} NEW`, `✨ ${ver} 新增`), 'shop-tip-patch is-new'));
  else if (ver && change?.type === 'changed') badges.append(node('span', text(`↻ ${ver}`, `↻ ${ver} 改动`), 'shop-tip-patch is-changed'));
  meta.append(badges);
  top.append(meta);
  tip.append(top);
  if (change?.type === 'added') {
    tip.append(node('p', text(`New item introduced in Patch ${ver || ''}.`, `${ver || ''} 版本全新加入物品。`), 'shop-tip-patch-note'));
  } else if (change?.type === 'changed' && change.stats?.length) {
    const diffWrap = node('div', '', 'shop-tip-diffs');
    for (const st of change.stats.slice(0, 2)) {
      const row = node('div', '', 'shop-tip-diff-row');
      row.append(
        node('span', formatPatchStatLabel(st, chinese), 'shop-tip-diff-label'),
        node('span', `${st.before} → ${st.after}`, 'shop-tip-diff-val'),
      );
      diffWrap.append(row);
    }
    if (change.stats.length > 2) {
      diffWrap.append(node('span', text(`+${change.stats.length - 2} more in ${ver || ''}`, `还有 ${change.stats.length - 2} 项改动`), 'shop-tip-diff-more'));
    }
    tip.append(diffWrap);
  }
  if (cue?.aliases?.length) {
    tip.append(node('p', text('Aliases: ', '简称：') + cue.aliases.slice(0, 4).join(' · '), 'shop-tip-aliases'));
  }
  const details = resolveItemDetails(lesson, itemDetails);
  if (details.stats.length) {
    const statRow = node('div', '', 'shop-tip-stats');
    for (const st of details.stats.slice(0, 4)) {
      statRow.append(node('span', `${st.value} ${text(st.en, st.zh)}`, 'shop-tip-stat'));
    }
    tip.append(statRow);
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
function nextStarterUnit(excludeScope) {
  return STARTER_UNITS.find(unit => unit.id !== excludeScope && unitReadyCount(unit) > 0);
}
function quickStarterUnit() {
  const completedScope = study.active?.completedAt ? study.active.options.scope : null;
  return nextStarterUnit(completedScope) || nextStarterUnit();
}
function quickLabel() {
  const running = Boolean(study.active && !study.active.completedAt);
  const paused = Boolean(study.paused && !study.paused.completedAt);
  const next = mode === 'starter' ? quickStarterUnit() : null;
  $('quick-practice').hidden = mode === 'quiz' || (mode === 'saved' && !running);
  $('quick-practice').disabled = starting || (mode === 'starter' && !running && !paused && !next);
  $('quick-practice').textContent = running
    ? text('Continue session →', '继续上次练习 →')
    : mode === 'starter'
      ? paused ? text('Resume paused lesson →', '继续暂停的课程 →')
        : next && next.id === study.active?.options.scope ? text('Review this lesson →', '复习本课 →')
        : next === STARTER_UNITS[0] && !study.history.some(entry => starterUnit(entry.scope)) ? text('Start first lesson →', '开始第一课 →')
        : next ? text('Start next lesson →', '开始下一课 →') : text('Reviews scheduled', '已安排后续复习')
      : text('Practice 5 lessons →', '练习 5 条课程 →');
}
function renderStarter() {
  const container = $('starter-units'); container.replaceChildren();
  $('starter-status').textContent = '';
  $('starter-source').textContent = starterEvidence.checkedAt
    ? text('Starter items checked against official shop listings: ', '入门物品已对照官方商店列表核验：') + new Date(starterEvidence.checkedAt).toLocaleDateString()
    : text('Shop-source verification is unavailable.', '商店来源核验暂不可用。');
  const running = Boolean(study.active && !study.active.completedAt);
  const paused = Boolean(study.paused && !study.paused.completedAt);
  for (const unit of STARTER_UNITS) {
    const rows = unit.lessonIds.map(id => catalog.lessons.find(lesson => lesson.id === id)).filter(Boolean);
    const verified = rows.length === unit.lessonIds.length && rows.every(lesson => starterAvailability(starterEvidence, lesson.id, lesson));
    const practiced = rows.filter(lesson => progress[lesson.id]?.attempts).length;
    const ready = rows.filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= Date.now()).length;
    const sameUnit = running && study.active.options.scope === unit.id;
    const samePaused = !running && paused && study.paused.options.scope === unit.id;
    const card = node('article', '', 'starter-unit');
    card.append(node('h3', text(unit.en, unit.zh)), node('p', text(unit.goalEn, unit.goalZh), 'starter-goal'));
    const pictures = node('div', '', 'starter-pictures'); pictures.setAttribute('translate', 'no');
    for (const lesson of rows) {
      const picture = node('div', '', 'starter-preview');
      picture.append(itemImageNode(lesson), node('strong', lesson.en), node('span', lesson.zh)); pictures.append(picture);
    }
    card.append(pictures, node('p', text(`${practiced}/5 practiced · Learn the names, then recall in English.`, `${practiced}/5 条已练习 · 先认识，再回忆英文。`), 'starter-progress'));
    const button = node('button', (sameUnit || samePaused) ? text('Continue lesson →', '继续本课 →')
      : !verified ? text('Verification needed', '需要来源核验') : !ready ? text('Reviews scheduled', '已安排后续复习')
      : practiced ? text('Review this lesson →', '复习本课 →') : text('Learn these 5 names →', '学习这 5 个词 →'));
    button.dataset.starterUnit = unit.id;
    button.disabled = Boolean(starting || !verified || (!sameUnit && !samePaused && (running || !ready)));
    button.onclick = () => startStarterUnit(unit);
    card.append(button); container.append(card);
  }
  if (running) $('starter-status').textContent = text('An unfinished session is saved. Continue it (or end it in Practice) before starting another lesson.', '你有一轮未完成的学习。请先继续，或在「练习测验」中结束该轮后再开始其他课程。');
  else if (paused) $('starter-status').textContent = text('A previous lesson is paused. Continue it from here or in Practice.', '你有一轮暂停的课程，可从这里或「练习测验」继续。');
}
async function startStarterUnit(unit) {
  if (starting) return;
  if (study.active && !study.active.completedAt) { enterPractice(); return; }
  if (study.paused && !study.paused.completedAt && study.paused.options.scope === unit.id) {
    await resumePausedSession();
    return;
  }
  await beginSession({ scope: unit.id, size: 5, kind: 'item', search: '', direction: 'zh' });
}
function renderGuide(active) {
  const index = active.guideIndex, lesson = active.items[index].lesson;
  const brief = STARTER_ITEMS[lesson.id];
  $('study-setup').hidden = true; $('guided-lesson').hidden = false;
  $('guide-counter').textContent = text(`Learn ${index + 1} / ${active.items.length} · Recall comes next`, `认识第 ${index + 1} / ${active.items.length} 个词 · 随后回忆英文`);
  const progressBar = $('guide-progress');
  progressBar.max = active.items.length;
  progressBar.value = index;
  progressBar.setAttribute('aria-label', text('Learning card progress', '学习卡进度'));
  progressBar.setAttribute('aria-valuetext', text(`${index} of ${active.items.length} cards completed`, `已完成 ${index} / ${active.items.length} 张学习卡`));
  const card = node('article', '', 'guided-card');
  const heading = node('div', '', 'lesson-heading');
  const title = node('div', '', 'lesson-title');
  const name = node('h3', lesson.en);
  name.id = 'guide-card-title';
  name.lang = 'en';
  name.setAttribute('aria-describedby', 'guide-counter guide-card-translation');
  const translation = node('p', lesson.zh, 'zh');
  translation.id = 'guide-card-translation';
  translation.lang = 'zh-Hans';
  title.append(name, translation);
  heading.append(itemImageNode(lesson), title);
  card.append(heading, node('p', brief.en, 'guide-meaning'), node('p', brief.zh, 'guide-translation'), itemCoachNode(lesson));
  const actions = node('div', '', 'actions'); actions.append(audioButton(lesson), saveButton(lesson)); card.append(actions);
  $('guide-card').replaceChildren(card);
  $('guide-next').disabled = advancing;
  $('guide-next').textContent = index === active.items.length - 1 ? text('Ready: recall in English →', '准备好了，回忆英文 →') : text('Next learning card →', '下一张学习卡 →');
}
function buildLessonCard(lesson, onUpdated) {
  const change = getLessonPatchChange(patchChanges, lesson.id);
  const card = node('article', '', `lesson${change?.type === 'added' ? ' is-patch-new' : ''}`);
  card.dataset.lessonId = lesson.id;
  const topicWrap = node('div', '', 'lesson-topic-row');
  topicWrap.append(node('span', labels[lesson.kind], 'topic'));
  if (lesson.kind === 'item' && lesson.mechanics?.item_cost) {
    topicWrap.append(node('span', `🪙 ${lesson.mechanics.item_cost}g`, 'item-cost-pill'));
  }
  const badge = patchBadgeNode(change, { compact: true });
  if (badge) topicWrap.append(badge);
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
  const extra = lesson.kind === 'item' ? resolveItemDetails(lesson, itemDetails) : null;
  if (extra?.stats?.length) {
    const statsGrid = node('div', '', 'item-stats-grid');
    for (const st of extra.stats) {
      const pill = node('span', '', 'item-stat-pill');
      pill.append(node('strong', st.value), node('span', `${st.en} · ${st.zh}`, 'item-stat-label'));
      statsGrid.append(pill);
    }
    card.append(statsGrid);
  }
  if (lesson.descriptionEn) card.append(node('p', lesson.descriptionEn, 'description'));
  else if (extra?.loreEn) card.append(node('p', extra.loreEn, 'description item-lore-inline'));
  const compactDiff = buildPatchDiffBox(change, { compact: true });
  if (compactDiff) card.append(compactDiff);
  const translation = node('details', '', 'translation');
  const zhText = lesson.descriptionZh || extra?.loreZh || (extra?.stats?.length ? extra.stats.map(s => `${s.value} ${s.zh}`).join('，') : lesson.zh);
  translation.append(node('summary', text('Chinese explanation', '中文说明')), node('p', zhText, 'description'));
  card.append(translation);
  const actions = node('div', '', 'actions');
  actions.append(audioButton(lesson), saveButton(lesson, onUpdated));
  card.append(actions);
  return card;
}
function syncShopTileStates() {
  for (const tile of document.querySelectorAll('#item-list [data-item-id]')) {
    const id = tile.dataset.itemId;
    const isSel = selectedItemId === id;
    tile.classList.toggle('is-selected', isSel);
    tile.setAttribute('aria-pressed', String(isSel));
    const saved = Boolean(progress[id]?.saved);
    if (tile.classList.contains('shop-icon-tile')) {
      const art = tile.querySelector('.shop-icon-art');
      const existing = art?.querySelector('.shop-tile-star');
      if (saved && !existing && art) art.append(node('span', '★', 'shop-tile-star'));
      else if (!saved && existing) existing.remove();
    } else if (tile.classList.contains('item-name-tile')) {
      const existing = tile.querySelector('.item-name-saved');
      if (saved && !existing) tile.append(node('span', '★', 'item-name-saved'));
      else if (!saved && existing) existing.remove();
    }
  }
}
function closeItemModal({ restoreFocus = true } = {}) {
  const modal = $('item-modal');
  if (!modal || modal.hidden) { selectedItemId = null; itemOpenedFromPatch = null; return; }
  player.stop();
  hideShopHoverTip();
  selectedItemId = null;
  itemOpenedFromPatch = null;
  modal.hidden = true;
  $('item-modal-dialog').replaceChildren();
  syncShopTileStates();
  if (restoreFocus && lastShopTrigger?.isConnected) {
    lastShopTrigger.focus({ preventScroll: true });
  }
  lastShopTrigger = null;
}
function openItemModal(itemId, trigger = null, { fromPatch = null } = {}) {
  hideShopHoverTip();
  player.stop();
  if (!itemId) { closeItemModal(); return; }
  const lesson = visibleShopItems.find(item => item.id === itemId)
    || catalog.lessons.find(item => item.kind === 'item' && item.id === itemId);
  if (!lesson) return;
  if (trigger) lastShopTrigger = trigger;
  itemOpenedFromPatch = fromPatch;
  selectedItemId = lesson.id;
  syncShopTileStates();
  const modal = $('item-modal');
  const dialog = $('item-modal-dialog');
  dialog.replaceChildren(buildItemStudyCard(lesson, { inModal: true }));
  modal.hidden = false;
  dialog.scrollTop = 0;
  dialog.tabIndex = -1;
  dialog.focus({ preventScroll: true });
}
function buildShopIconTile(lesson, cat) {
  const change = getLessonPatchChange(patchChanges, lesson.id);
  const tile = node('button', '', `shop-icon-tile${change?.type === 'added' ? ' is-patch-new' : change?.type === 'changed' ? ' is-patch-changed' : ''}`);
  tile.type = 'button';
  tile.dataset.itemId = lesson.id;
  const cost = lesson.mechanics?.item_cost || 0;
  const ver = currentPatch();
  const patchAria = change?.type === 'added' ? ` · ${ver || ''} NEW` : change?.type === 'changed' ? ` · ${ver || ''} Updated` : '';
  tile.setAttribute('aria-label', `${lesson.en} · ${lesson.zh}${cost > 0 ? ` · ${cost}g` : ''}${patchAria}`);
  tile.setAttribute('aria-pressed', String(selectedItemId === lesson.id));
  if (selectedItemId === lesson.id) tile.classList.add('is-selected');
  if (cat?.accent) tile.style.setProperty('--tile-accent', cat.accent);
  const artWrap = node('span', '', 'shop-icon-art');
  artWrap.append(itemImageNode(lesson));
  if (change?.type === 'added') artWrap.append(node('span', text('NEW', '新'), 'shop-tile-new'));
  else if (change?.type === 'changed') {
    const dot = node('span', '', 'shop-tile-updated-dot');
    dot.setAttribute('aria-hidden', 'true');
    artWrap.append(dot);
  }
  if (progress[lesson.id]?.saved) artWrap.append(node('span', '★', 'shop-tile-star'));
  tile.append(artWrap);
  tile.append(node('span', cost > 0 ? `${cost}g` : text('Free', '免费'), `shop-icon-cost${cost > 0 ? '' : ' is-free'}`));
  tile.onmouseenter = () => { if ($('item-modal')?.hidden) showShopHoverTip(lesson, tile); };
  tile.onmouseleave = hideShopHoverTip;
  tile.onfocus = () => { if ($('item-modal')?.hidden) showShopHoverTip(lesson, tile); };
  tile.onblur = hideShopHoverTip;
  tile.onclick = () => openItemModal(lesson.id, tile);
  return tile;
}
function buildItemNameTile(lesson, { showCategory = false } = {}) {
  const info = classifyItem(lesson, itemShopCategories);
  const cat = CATEGORY_BY_KEY[info.category];
  const cost = lesson.mechanics?.item_cost || 0;
  const change = getLessonPatchChange(patchChanges, lesson.id);
  const ver = currentPatch();
  const tile = node('button', '', `item-name-tile${change?.type === 'added' ? ' is-patch-new' : ''}`);
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
  if (ver && change?.type === 'added') meta.append(node('span', text(`${ver} NEW`, `${ver} 新增`), 'patch-mini-badge is-new'));
  else if (ver && change?.type === 'changed') meta.append(node('span', text(`${ver} Updated`, `${ver} 改动`), 'patch-mini-badge is-changed'));
  if (meta.childElementCount) body.append(meta);
  tile.append(body);
  if (progress[lesson.id]?.saved) tile.append(node('span', '★', 'item-name-saved'));
  tile.onclick = () => openItemModal(lesson.id, tile);
  return tile;
}
function buildItemStudyCard(lesson, { inModal = false } = {}) {
  const info = classifyItem(lesson, itemShopCategories);
  const cat = CATEGORY_BY_KEY[info.category];
  const realm = SHOP_REALMS.find(r => r.key === info.realm);
  const shelf = SHOP_SHELVES[info.shelf];
  const idx = visibleShopItems.findIndex(item => item.id === lesson.id);
  const card = node('article', '', `lesson item-inspector-card${inModal ? ' is-modal' : ''}`);
  card.dataset.lessonId = lesson.id;
  if (cat?.accent) card.style.setProperty('--cat-accent', cat.accent);
  if (cat?.tint) card.style.setProperty('--cat-tint', cat.tint);

  const bar = node('div', '', 'item-inspector-bar');
  const barLeft = node('div', '', 'item-bar-left');
  if (inModal && itemOpenedFromPatch && currentPatch()) {
    const patchSnap = itemOpenedFromPatch;
    const patchBackBtn = node('button', text(`← Patch ${currentPatch()}`, `← 返回 ${currentPatch()} 更新`), 'item-patch-back-btn');
    patchBackBtn.type = 'button';
    patchBackBtn.onclick = () => {
      closeItemModal({ restoreFocus: false });
      patchModalItemRealm = patchSnap.realm || 'all';
      openPatchModal($('patch-pill'), patchSnap.tab || 'highlights');
    };
    barLeft.append(patchBackBtn);
  }
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
    closeItemModal({ restoreFocus: false });
    $('search').value = '';
    itemRealm = info.realm;
    itemCategory = info.category;
    itemQuickFilter = 'all';
    renderItemBrowser();
    $('tools')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  barLeft.append(crumbBtn);
  const nav = node('div', '', 'item-inspector-nav');
  if (inModal && visibleShopItems.length > 1 && idx >= 0) {
    const prevBtn = node('button', '←', 'item-nav-btn');
    prevBtn.type = 'button';
    prevBtn.title = text('Previous item (←)', '上一件物品 (←)');
    prevBtn.setAttribute('aria-label', text('Previous item', '上一件物品'));
    prevBtn.onclick = () => openItemModal(visibleShopItems[(idx - 1 + visibleShopItems.length) % visibleShopItems.length].id, null, { fromPatch: itemOpenedFromPatch });
    const counter = node('span', `${idx + 1} / ${visibleShopItems.length}`, 'item-nav-count');
    const nextBtn = node('button', '→', 'item-nav-btn');
    nextBtn.type = 'button';
    nextBtn.title = text('Next item (→)', '下一件物品 (→)');
    nextBtn.setAttribute('aria-label', text('Next item', '下一件物品'));
    nextBtn.onclick = () => openItemModal(visibleShopItems[(idx + 1) % visibleShopItems.length].id, null, { fromPatch: itemOpenedFromPatch });
    nav.append(prevBtn, counter, nextBtn);
  }
  if (inModal) {
    const closeBtn = node('button', '×', 'item-close-btn');
    closeBtn.type = 'button';
    closeBtn.title = text('Close details (Esc)', '关闭详情 (Esc)');
    closeBtn.setAttribute('aria-label', text('Close item details', '关闭物品详情'));
    closeBtn.onclick = () => closeItemModal();
    nav.append(closeBtn);
  }
  bar.append(barLeft, nav);
  card.append(bar);

  const head = node('div', '', 'item-inspector-head');
  head.append(itemImageNode(lesson));
  const titleWrap = node('div', '', 'lesson-title');
  const nameRow = node('div', '', 'item-inspector-title-row');
  nameRow.append(node('h2', lesson.en));
  if (lesson.mechanics?.item_cost) {
    nameRow.append(node('span', `🪙 ${lesson.mechanics.item_cost}g`, 'item-cost-pill'));
  }
  const itemChange = getLessonPatchChange(patchChanges, lesson.id);
  const itemBadge = patchBadgeNode(itemChange);
  if (itemBadge) nameRow.append(itemBadge);
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
  actions.append(audioButton(lesson), saveButton(lesson, () => {
    if (itemQuickFilter === 'saved' && !progress[lesson.id]?.saved) {
      if (inModal) closeItemModal({ restoreFocus: false });
      renderItemBrowser();
    } else {
      syncShopTileStates();
    }
  }));
  const quizzable = canQuizLesson(lesson);
  const practiceBtn = node(
    'button',
    quizzable ? text('🎯 Practice this item', '🎯 练习此物品') : text('No Chinese name yet', '暂无中文译名'),
    'item-practice-btn',
  );
  practiceBtn.type = 'button';
  practiceBtn.disabled = !quizzable;
  if (!quizzable) {
    practiceBtn.title = text('This archive item currently has identical English and Chinese names and cannot be quizzed yet.', '此历史物品中英文名称相同，暂不支持双语测验。');
  } else {
    practiceBtn.onclick = async () => {
      const fromPatch = inModal ? itemOpenedFromPatch : null;
      closeItemModal({ restoreFocus: false });
      await startFocusedPractice(lesson, {
        type: 'item',
        itemId: lesson.id,
        realm: info.realm,
        fromPatch,
      });
    };
  }
  actions.append(practiceBtn);
  leftCol.append(actions);

  const rightCol = node('div', '', 'item-inspector-col');
  const itemDiffBox = buildPatchDiffBox(itemChange);
  if (itemDiffBox) rightCol.append(itemDiffBox);
  const details = resolveItemDetails(lesson, itemDetails);
  if (details.stats.length) {
    const statSection = node('section', '', 'item-detail-section item-stats-section');
    statSection.append(node('h3', text('Attributes & Bonuses', '属性加成')));
    const statsGrid = node('div', '', 'item-stats-grid');
    for (const st of details.stats) {
      const pill = node('span', '', 'item-stat-pill');
      pill.append(node('strong', st.value), node('span', `${st.en} · ${st.zh}`, 'item-stat-label'));
      statsGrid.append(pill);
    }
    statSection.append(statsGrid);
    rightCol.append(statSection);
  }
  if (lesson.descriptionEn) rightCol.append(node('p', lesson.descriptionEn, 'description'));
  if (lesson.descriptionZh) rightCol.append(node('p', lesson.descriptionZh, 'description zh-block'));
  if (details.notesEn.length || details.notesZh.length) {
    const notesSection = node('section', '', 'item-detail-section item-notes-box');
    notesSection.append(node('h3', text('Mechanics Notes', '机制说明')));
    const maxNotes = Math.max(details.notesEn.length, details.notesZh.length);
    for (let i = 0; i < maxNotes; i++) {
      if (details.notesEn[i]) notesSection.append(node('p', details.notesEn[i], 'item-note-en'));
      if (details.notesZh[i]) notesSection.append(node('p', details.notesZh[i], 'item-note-zh'));
    }
    rightCol.append(notesSection);
  }
  if (details.loreEn || details.loreZh) {
    const loreSection = node('section', '', 'item-detail-section item-lore-box');
    loreSection.append(node('h3', text('Item Introduction', '物品背景介绍')));
    if (details.loreEn) loreSection.append(node('p', details.loreEn, 'item-lore-en'));
    if (details.loreZh) loreSection.append(node('p', details.loreZh, 'item-lore-zh'));
    rightCol.append(loreSection);
  }
  if (!rightCol.childElementCount) {
    rightCol.append(node('p', text('Historical or special event item — Valve’s current feed has no active stats or description for this entry.', '历史或活动特殊物品，Valve 当前数据接口未提供技能或属性说明。'), 'item-empty-detail'));
  }
  body.append(leftCol, rightCol);
  card.append(body);
  return card;
}
function renderInlineInspector(lesson) {
  const host = $('item-inspector');
  if (!lesson) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  host.replaceChildren(buildItemStudyCard(lesson, { inModal: false }));
}
function renderItemBrowser() {
  hideShopHoverTip();
  closeItemModal({ restoreFocus: false });
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
  const ver = currentPatch();
  if (ver && hasPatchDiff()) {
    const patchToggle = node('button', text(`✨ ${ver}`, `✨ ${ver}`), 'shop-toggle-pill patch-filter-pill');
    patchToggle.type = 'button';
    patchToggle.dataset.filter = 'patch';
    patchToggle.title = text(`Show only new & changed items in Patch ${ver}`, `仅显示 ${ver} 版本新增或改动的物品`);
    patchToggle.setAttribute('aria-pressed', String(itemQuickFilter === 'patch'));
    patchToggle.onclick = () => { itemQuickFilter = itemQuickFilter === 'patch' ? 'all' : 'patch'; renderItemBrowser(); };
    quickEl.append(patchToggle);
  }
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
    if (itemQuickFilter === 'patch' && !getLessonPatchChange(patchChanges, item.id)) return false;
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

    // Auto-open inline study card when search narrows to 1 exact item (e.g. "bkb") so the search input stays unobstructed.
    const singleMatch = matches.length === 1 ? matches[0] : null;
    renderInlineInspector(singleMatch);

    if (!matches.length) {
      board.append(node('p', text('No items match your search and filters.', '当前搜索和筛选条件下没有匹配物品。'), 'shop-empty'));
      return;
    }
    if (singleMatch) return;
    const grid = node('div', '', 'item-name-grid');
    for (const item of matches) grid.append(buildItemNameTile(item, { showCategory: true }));
    board.append(grid);
    return;
  }

  // 4. Realm & official subcategory browse mode
  renderInlineInspector(null);
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
        const col = node('div', '', `shop-column${items.length ? '' : ' is-empty'}`);
        col.dataset.category = category.key;
        col.style.setProperty('--cat-accent', category.accent);
        col.style.setProperty('--cat-tint', category.tint);
        const colHead = node('button', '', 'shop-col-head');
        colHead.type = 'button';
        colHead.disabled = !items.length;
        colHead.title = text(`Focus ${category.en} (${items.length})`, `展开查看${category.zh} (${items.length})`);
        const iconBadge = node('span', '', 'shop-col-icon');
        iconBadge.append(shopIconSvg(category.icon, 14));
        const colTitles = node('span', '', 'shop-col-titles');
        colTitles.append(node('strong', text(category.en, category.zh)), node('span', text(category.zh, category.en), 'shop-col-sub'));
        colHead.append(iconBadge, colTitles, node('span', String(items.length), 'shop-col-count'));
        colHead.onclick = () => { itemCategory = category.key; renderItemBrowser(); };
        col.append(colHead);

        if (items.length) {
          const iconGrid = node('div', '', 'shop-col-icons');
          for (const item of items) iconGrid.append(buildShopIconTile(item, category));
          col.append(iconGrid);
        } else {
          col.append(node('p', '—', 'shop-col-empty'));
        }
        cols.append(col);
      }
      shelfEl.append(cols);
      board.append(shelfEl);
    }
    return;
  }

  // Focused category, Names mode, Neutral Tiers, or Special & Archive shelves
  if (itemRealm === 'neutral' && itemCategory === 'all') {
    const note = node(
      'p',
      text(
        'Patch 7.42: Neutral items now use 4 tiers (0:00 / 15:00 / 30:00 / 50:00, Infinite Madstone at 65:00). Surviving Tier 5 artifacts moved to Tier 4; cycled-out neutrals (like Stygian Desolator & Spider Legs) live in Special & Archive.',
        '7.42 版本说明：中立物品已精简为 4 个等级（0:00 / 15:00 / 30:00 / 50:00，65:00 无限狂石）。原 5 级圣物（天崩、冥灵书、恶牛角、巨人之戒等）已合并至第 4 级；轮换移除的旧中立物品（如寂灭、网虫腿）收录在「肉山与历史」中。',
      ),
      'shop-patch-note',
    );
    board.append(note);
  }
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
function closePatchModal({ restoreFocus = true } = {}) {
  const modal = $('patch-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  $('patch-modal-dialog').replaceChildren();
  if (restoreFocus && lastPatchTrigger?.isConnected) {
    lastPatchTrigger.focus({ preventScroll: true });
  }
  lastPatchTrigger = null;
}
function jumpToItemFromPatch(item) {
  const info = classifyItem(item, itemShopCategories);
  const patchSnap = { tab: patchModalTab, realm: patchModalItemRealm };
  closePatchModal({ restoreFocus: false });
  $('search').value = '';
  itemRealm = info.realm;
  itemCategory = 'all';
  itemQuickFilter = 'all';
  mode = 'items';
  render();
  openItemModal(item.id, null, { fromPatch: patchSnap });
}
function jumpToHeroFromPatch(heroId) {
  if (!heroId) return;
  heroOpenedFromPatch = { tab: patchModalTab, realm: patchModalItemRealm };
  closePatchModal({ restoreFocus: false });
  $('search').value = '';
  attrFilter = 'all';
  heroPatchOnly = false;
  heroDetailPatchOnly = false;
  selectedHeroId = heroId;
  mode = 'heroes';
  render();
  $('hero-detail')?.scrollIntoView({ block: 'start' });
}
function openPatchModal(trigger = null, tab = null) {
  if (!catalog || !currentPatch()) return;
  player.stop();
  hideShopHoverTip();
  closeItemModal({ restoreFocus: false });
  if (trigger) lastPatchTrigger = trigger;
  if (tab) patchModalTab = tab;
  renderPatchModal();
  const modal = $('patch-modal');
  const dialog = $('patch-modal-dialog');
  modal.hidden = false;
  dialog.scrollTop = 0;
  dialog.tabIndex = -1;
  dialog.focus({ preventScroll: true });
}
function renderPatchModal() {
  const dialog = $('patch-modal-dialog');
  if (!dialog || !catalog) return;
  const ver = currentPatch();
  const summary = summarizePatchChanges(patchChanges, catalog.lessons, itemShopCategories);
  const dateStr = formatPatchReleaseDate();
  const prev = summary.previousPatch;
  const activeNewItemsCount = summary.newShopItems.length + summary.newNeutralItems.length;
  const heroesByParent = new Map(
    catalog.lessons.filter(l => l.kind === 'hero').map(h => [`${h.en} · ${h.zh}`, h]),
  );

  dialog.replaceChildren();
  const shell = node('article', '', 'patch-modal-card');

  // 1. Emerald Hero Banner
  const hero = node('header', '', 'patch-modal-hero');
  const heroTop = node('div', '', 'patch-modal-hero-top');
  const heroCopy = node('div', '', 'patch-modal-hero-copy');
  const eyebrow = node('span', '', 'patch-modal-eyebrow');
  eyebrow.append(node('span', '', 'patch-live-dot'), node('span', text('LATEST VERSION', '当前最新版本')));
  const metaParts = [
    text('Synced from Valve official bilingual feed', '已同步 Valve 官方中英双语数据'),
    prev ? text(`vs. ${prev}`, `对比 ${prev}`) : '',
    dateStr ? text(`Released ${dateStr}`, `${dateStr} 发布`) : '',
  ].filter(Boolean);
  heroCopy.append(
    eyebrow,
    node('h2', text(`Dota 2 Patch ${ver} — What Changed`, `Dota 2 ${ver} 版本更新速览`)),
    node('p', metaParts.join(' · '), 'patch-modal-subtitle'),
  );
  const closeBtn = node('button', '×', 'patch-modal-close');
  closeBtn.type = 'button';
  closeBtn.title = text('Close (Esc)', '关闭 (Esc)');
  closeBtn.setAttribute('aria-label', text('Close patch overview', '关闭版本更新速览'));
  closeBtn.onclick = () => closePatchModal();
  heroTop.append(heroCopy, closeBtn);
  hero.append(heroTop);

  const statGrid = node('div', '', 'patch-stat-grid');
  const makeStatTile = (value, label, sub, targetTab, anchorId = null) => {
    const btn = node('button', '', 'patch-stat-tile');
    btn.type = 'button';
    btn.append(node('strong', value), node('span', label, 'patch-stat-label'), node('span', sub, 'patch-stat-sub'));
    btn.onclick = () => {
      patchModalTab = targetTab;
      renderPatchModal();
      if (anchorId) {
        requestAnimationFrame(() => { $(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      }
    };
    return btn;
  };
  statGrid.append(
    makeStatTile(
      `+${activeNewItemsCount}`,
      text('New Active Items', '新增可用物品'),
      text(`${summary.newShopItems.length} Shop · ${summary.newNeutralItems.length} Neutral`, `商店 ${summary.newShopItems.length} · 中立 ${summary.newNeutralItems.length}`),
      'highlights',
    ),
    makeStatTile(
      String(summary.changedItems.length),
      text('Items Updated', '物品数值改动'),
      text(`${summary.changedByRealm.shop.length} Shop · ${summary.changedByRealm.neutral.length} Neutral`, `商店 ${summary.changedByRealm.shop.length} · 中立 ${summary.changedByRealm.neutral.length}`),
      'items',
    ),
    makeStatTile(
      `+${summary.newAbilities.length} / -${summary.removedAbilities.length}`,
      text('Abilities Added / Removed', '英雄技能增删'),
      text(`${summary.changedAbilities.length} abilities tweaked`, `另有 ${summary.changedAbilities.length} 个技能调整`),
      'highlights',
      'patch-sec-abilities',
    ),
    makeStatTile(
      String(summary.affectedHeroes.length),
      text('Heroes Updated', '涉及改动英雄'),
      text(`of ${catalog.lessons.filter(l => l.kind === 'hero').length} total heroes`, `共 ${catalog.lessons.filter(l => l.kind === 'hero').length} 位英雄`),
      'heroes',
    ),
  );
  hero.append(statGrid);
  shell.append(hero);

  // 2. Modal Tab Bar
  const tabBar = node('div', '', 'patch-modal-tabs');
  tabBar.setAttribute('role', 'tablist');
  for (const [key, enLabel, zhLabel] of [
    ['highlights', '✨ Highlights', '✨ 核心亮点'],
    ['items', `🛡️ Changed Items (${summary.changedItems.length})`, `🛡️ 物品改动 (${summary.changedItems.length})`],
    ['heroes', `⚔️ Changed Heroes (${summary.affectedHeroes.length})`, `⚔️ 英雄改动 (${summary.affectedHeroes.length})`],
  ]) {
    const tabBtn = node('button', text(enLabel, zhLabel), 'patch-modal-tab');
    tabBtn.type = 'button';
    tabBtn.role = 'tab';
    tabBtn.dataset.patchTab = key;
    tabBtn.setAttribute('aria-selected', String(patchModalTab === key));
    tabBtn.setAttribute('aria-pressed', String(patchModalTab === key));
    tabBtn.onclick = () => { patchModalTab = key; renderPatchModal(); };
    tabBar.append(tabBtn);
  }
  shell.append(tabBar);

  // 3. Scrollable Tab Body
  const body = node('div', '', 'patch-modal-body');

  if (patchModalTab === 'highlights') {
    if (summary.newShopItems.length) {
      const sec = node('section', '', 'patch-section');
      sec.append(node('h3', text(`New Shop Items (${summary.newShopItems.length})`, `商店全新物品 (${summary.newShopItems.length})`)));
      const grid = node('div', '', 'patch-spotlight-grid');
      for (const item of summary.newShopItems) {
        const info = classifyItem(item, itemShopCategories);
        const cat = CATEGORY_BY_KEY[info.category];
        const card = node('button', '', 'patch-spotlight-card');
        card.type = 'button';
        card.append(itemImageNode(item));
        const copy = node('span', '', 'patch-spotlight-copy');
        copy.append(node('strong', item.en));
        if (item.zh && item.zh !== item.en) copy.append(node('span', item.zh, 'patch-spotlight-zh'));
        const meta = node('span', '', 'patch-spotlight-meta');
        if (item.mechanics?.item_cost) meta.append(node('span', `🪙 ${item.mechanics.item_cost}g`, 'item-mini-cost'));
        if (cat) meta.append(node('span', text(cat.en, cat.zh), 'item-mini-cat'));
        meta.append(node('span', text('NEW', '新增'), 'patch-mini-badge is-new'));
        copy.append(meta);
        card.append(copy, node('span', '→', 'patch-spotlight-arrow'));
        card.onclick = () => jumpToItemFromPatch(item);
        grid.append(card);
      }
      sec.append(grid);
      body.append(sec);
    }

    if (summary.newNeutralItems.length) {
      const sec = node('section', '', 'patch-section');
      sec.append(node('h3', text(`New Neutral Items (${summary.newNeutralItems.length})`, `全新中立物品 (${summary.newNeutralItems.length})`)));
      const grid = node('div', '', 'patch-spotlight-grid');
      for (const item of summary.newNeutralItems) {
        const info = classifyItem(item, itemShopCategories);
        const cat = CATEGORY_BY_KEY[info.category];
        const card = node('button', '', 'patch-spotlight-card');
        card.type = 'button';
        card.append(itemImageNode(item));
        const copy = node('span', '', 'patch-spotlight-copy');
        copy.append(node('strong', item.en));
        if (item.zh && item.zh !== item.en) copy.append(node('span', item.zh, 'patch-spotlight-zh'));
        const meta = node('span', '', 'patch-spotlight-meta');
        if (cat) meta.append(node('span', `${text(cat.en, cat.zh)}${cat.hintEn ? ` · ${text(cat.hintEn, cat.hintZh)}` : ''}`, 'item-mini-cat'));
        meta.append(node('span', text('NEW', '新增'), 'patch-mini-badge is-new'));
        copy.append(meta);
        card.append(copy, node('span', '→', 'patch-spotlight-arrow'));
        card.onclick = () => jumpToItemFromPatch(item);
        grid.append(card);
      }
      sec.append(grid);
      body.append(sec);
    }

    // Neutral Tier 5 → 4 Rework callout
    const neutralCallout = node('div', '', 'patch-rework-banner');
    const neutralCopy = node('div', '', 'patch-rework-copy');
    neutralCopy.append(
      node('strong', text('Neutral Items streamlined to 4 Tiers', '中立物品精简为 4 个等级')),
      node('p', text(
        '0:00 / 15:00 / 30:00 / 50:00 peak tier (surviving Tier 5 artifacts moved into Tier 4) + 19 Neutral Enchantments.',
        '0:00 / 15:00 / 30:00 / 50:00 终极档位（保留的原 5 级圣物合并至第 4 级），同步 19 项活跃中立附魔。',
      )),
    );
    const neutralBtn = node('button', text('View Neutral Tiers →', '查看中立物品 →'), 'patch-rework-btn');
    neutralBtn.type = 'button';
    neutralBtn.onclick = () => {
      closePatchModal({ restoreFocus: false });
      $('search').value = '';
      itemRealm = 'neutral';
      itemCategory = 'all';
      itemQuickFilter = 'all';
      mode = 'items';
      render();
      window.scrollTo(0, 0);
    };
    neutralCallout.append(neutralCopy, neutralBtn);
    body.append(neutralCallout);

    if (summary.newAbilities.length) {
      const sec = node('section', '', 'patch-section');
      sec.id = 'patch-sec-abilities';
      sec.append(node('h3', text(`New Hero Abilities (${summary.newAbilities.length})`, `新增英雄技能 (${summary.newAbilities.length})`)));
      const grid = node('div', '', 'patch-spotlight-grid');
      for (const ability of summary.newAbilities) {
        const parentHero = heroesByParent.get(ability.parent);
        const card = node('button', '', 'patch-spotlight-card');
        card.type = 'button';
        if (parentHero) card.append(heroAvatarNode(parentHero, false));
        const copy = node('span', '', 'patch-spotlight-copy');
        copy.append(node('strong', ability.en));
        if (ability.zh && ability.zh !== ability.en) copy.append(node('span', ability.zh, 'patch-spotlight-zh'));
        const meta = node('span', '', 'patch-spotlight-meta');
        if (parentHero) meta.append(node('span', text(parentHero.en, `${parentHero.zh} · ${parentHero.en}`), 'item-mini-cat'));
        meta.append(node('span', text('NEW', '新增'), 'patch-mini-badge is-new'));
        copy.append(meta);
        card.append(copy, node('span', '→', 'patch-spotlight-arrow'));
        card.onclick = () => { if (parentHero) jumpToHeroFromPatch(parentHero.id); };
        grid.append(card);
      }
      sec.append(grid);
      body.append(sec);
    }

    if (summary.removedAbilities.length) {
      const sec = node('section', '', 'patch-section');
      sec.append(node('h3', text(`Removed Abilities (${summary.removedAbilities.length})`, `已移除技能 (${summary.removedAbilities.length})`)));
      const list = node('div', '', 'patch-removed-grid');
      for (const rem of summary.removedAbilities) {
        const btn = node('button', '', 'patch-removed-pill');
        btn.type = 'button';
        const heroName = rem.parent ? rem.parent.split(' · ')[chinese ? 1 : 0] || rem.parent : '';
        btn.append(
          node('strong', rem.en),
          node('span', rem.zh && rem.zh !== rem.en ? rem.zh : '', 'patch-removed-zh'),
          heroName ? node('span', heroName, 'patch-removed-hero') : node('span', '', ''),
        );
        btn.disabled = !rem.heroId;
        btn.onclick = () => { if (rem.heroId) jumpToHeroFromPatch(rem.heroId); };
        list.append(btn);
      }
      sec.append(list);
      body.append(sec);
    }
  } else if (patchModalTab === 'items') {
    const realmBar = node('div', '', 'patch-subfilters');
    for (const [key, en, zh, count] of [
      ['all', 'All', '全部', summary.changedItems.length],
      ['shop', 'Shop', '商店', summary.changedByRealm.shop.length],
      ['neutral', 'Neutral', '中立', summary.changedByRealm.neutral.length],
      ['archive', 'Special & Archive', '肉山与历史', summary.changedByRealm.archive.length],
    ]) {
      const btn = node('button', `${text(en, zh)} (${count})`, 'attr-pill');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(patchModalItemRealm === key));
      btn.onclick = () => { patchModalItemRealm = key; renderPatchModal(); };
      realmBar.append(btn);
    }
    body.append(realmBar);

    const rows = patchModalItemRealm === 'all' ? summary.changedItems : (summary.changedByRealm[patchModalItemRealm] || []);
    const list = node('div', '', 'patch-changed-list');
    for (const { lesson, change } of rows) {
      const info = classifyItem(lesson, itemShopCategories);
      const cat = CATEGORY_BY_KEY[info.category];
      const card = node('button', '', 'patch-diff-card');
      card.type = 'button';
      const left = node('div', '', 'patch-diff-card-head');
      left.append(itemImageNode(lesson));
      const names = node('div', '', 'patch-spotlight-copy');
      names.append(node('strong', lesson.en));
      if (lesson.zh && lesson.zh !== lesson.en) names.append(node('span', lesson.zh, 'patch-spotlight-zh'));
      const meta = node('span', '', 'patch-spotlight-meta');
      if (cat) meta.append(node('span', text(cat.en, cat.zh), 'item-mini-cat'));
      if (lesson.mechanics?.item_cost) meta.append(node('span', `🪙 ${lesson.mechanics.item_cost}g`, 'item-mini-cost'));
      if (meta.childElementCount) names.append(meta);
      left.append(names);

      const right = node('div', '', 'patch-diff-chips');
      if (change.stats?.length) {
        for (const st of change.stats.slice(0, 3)) {
          const chip = node('span', '', 'patch-mini-diff');
          chip.append(
            node('span', formatPatchStatLabel(st, chinese), 'patch-mini-diff-key'),
            node('span', `${st.before} → ${st.after}`, 'patch-mini-diff-val'),
          );
          right.append(chip);
        }
        if (change.stats.length > 3) {
          right.append(node('span', `+${change.stats.length - 3}`, 'patch-mini-diff-more'));
        }
      } else {
        right.append(node('span', text('Wording updated', '说明文本更新'), 'patch-mini-diff'));
      }
      card.append(left, right);
      card.onclick = () => jumpToItemFromPatch(lesson);
      list.append(card);
    }
    body.append(list);
  } else if (patchModalTab === 'heroes') {
    const grid = node('div', '', 'patch-heroes-grid');
    for (const { hero: heroLesson, summary: hs } of summary.affectedHeroes) {
      const card = node('button', '', `patch-hero-card${hs.addedCount ? ' is-patch-new' : ''}`);
      card.type = 'button';
      card.append(heroAvatarNode(heroLesson, false));
      const copy = node('span', '', 'patch-spotlight-copy');
      copy.append(node('strong', heroLesson.en), node('span', heroLesson.zh, 'patch-spotlight-zh'));
      const pills = node('span', '', 'patch-spotlight-meta');
      if (hs.addedCount) pills.append(node('span', text(`+${hs.addedCount} New`, `新增 ${hs.addedCount}`), 'patch-mini-badge is-new'));
      if (hs.changedCount) pills.append(node('span', text(`${hs.changedCount} Updated`, `调整 ${hs.changedCount}`), 'patch-mini-badge is-changed'));
      if (hs.removedAbilities.length) pills.append(node('span', text(`-${hs.removedAbilities.length} Removed`, `移除 ${hs.removedAbilities.length}`), 'patch-mini-badge is-removed'));
      copy.append(pills);
      card.append(copy);
      card.onclick = () => jumpToHeroFromPatch(heroLesson.id);
      grid.append(card);
    }
    body.append(grid);
  }
  shell.append(body);

  // 4. Sticky Footer Actions
  const foot = node('footer', '', 'patch-modal-footer');
  const leftActions = node('div', '', 'patch-modal-footer-actions');
  const shopFilterBtn = node('button', text(`Filter ${ver} in Shop →`, `在商店中筛选 ${ver} 物品 →`), 'patch-footer-primary');
  shopFilterBtn.type = 'button';
  shopFilterBtn.onclick = () => {
    closePatchModal({ restoreFocus: false });
    $('search').value = '';
    itemRealm = 'shop';
    itemCategory = 'all';
    itemQuickFilter = 'patch';
    mode = 'items';
    render();
    window.scrollTo(0, 0);
  };
  const heroFilterBtn = node('button', text(`Filter ${ver} Heroes →`, `筛选 ${ver} 改动英雄 →`), 'patch-footer-secondary');
  heroFilterBtn.type = 'button';
  heroFilterBtn.onclick = () => {
    closePatchModal({ restoreFocus: false });
    $('search').value = '';
    attrFilter = 'all';
    selectedHeroId = null;
    heroPatchOnly = true;
    mode = 'heroes';
    render();
    window.scrollTo(0, 0);
  };
  leftActions.append(shopFilterBtn, heroFilterBtn);

  const officialBtn = node('button', text('Official patch notes ↗', '官方更新日志 ↗'), 'patch-footer-link');
  officialBtn.type = 'button';
  officialBtn.onclick = async () => {
    const response = await api.sources();
    if (!response.ok) $('update-status').textContent = response.error;
  };
  foot.append(leftActions, officialBtn);
  shell.append(foot);

  dialog.append(shell);
}
function render() {
  player.stop();
  hideShopHoverTip();
  closeItemModal({ restoreFocus: false });
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
  const activeQuiz = Boolean(mode === 'quiz' && study.active && !study.active.completedAt);
  const inActiveStudy = Boolean(mode === 'quiz' && !planning && study.active && (!study.active.completedAt || (feedbackIndex !== null && study.active.answers[feedbackIndex])));
  const quizCompleted = Boolean(mode === 'quiz' && !planning && study.active?.completedAt && !inActiveStudy);
  const showStudySetup = mode === 'quiz' && !inActiveStudy && !quizCompleted;
  $('study-setup').hidden = !showStudySetup;
  $('progress-overview').hidden = !showStudySetup;
  $('practice-saved').hidden = mode !== 'saved';
  const browsePatchBtn = $('browse-patch-toggle');
  if (browsePatchBtn) {
    const showBrowsePatch = mode === 'browse' && hasPatchDiff();
    browsePatchBtn.hidden = !showBrowsePatch;
    if (showBrowsePatch) {
      const ver = currentPatch();
      browsePatchBtn.textContent = text(`✨ ${ver} Changes`, `✨ 仅看 ${ver} 改动`);
      browsePatchBtn.setAttribute('aria-pressed', String(browsePatchOnly));
    }
  }
  $('practice').hidden = true; $('session-summary').hidden = true; $('guided-lesson').hidden = true;
  const tools = $('tools');
  const kindLabel = $('kind').closest('label');
  const dirLabel = $('direction').closest('label');
  const hideTools = mode === 'quiz' && !showStudySetup;
  if (tools) {
    tools.hidden = hideTools || mode === 'starter';
    tools.dataset.layout = (mode === 'heroes' || mode === 'items' || mode === 'phrases') ? 'search-only'
      : (mode === 'browse' || mode === 'saved') ? 'search-kind'
      : 'quiz';
  }
  if (kindLabel) kindLabel.hidden = mode === 'heroes' || mode === 'items' || mode === 'phrases';
  if (dirLabel) dirLabel.hidden = mode !== 'quiz';
  for (const id of ['search', 'kind', 'direction', 'session-size', 'session-scope']) $(id).disabled = activeQuiz;
  $('search').placeholder = text('Search English or Chinese…', '搜索英文 / 中文 / 英雄名…');
  if (mode === 'starter') { $('message').textContent = ''; $('more').hidden = true; renderStarter(); return; }
  if (mode === 'quiz') { $('message').textContent = ''; $('more').hidden = true; renderStudy(); return; }
  if (mode === 'heroes') {
    $('search').placeholder = text('Search hero or ability (English / Chinese)…', '搜索英雄名或技能（中 / 英文）…');
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
  if (mode === 'phrases') {
    $('search').placeholder = text('Search callouts or situations (smoke, rosh, back)…', '搜索实战口语或场景（如 开雾、肉山、撤退）…');
    $('more').hidden = true;
    renderSpokenBrowser();
    return;
  }
  const rows = selection();
  $('message').textContent = rows.length ? text(`${rows.length} lessons · Read, listen, then save a word to practice.`, `${rows.length} 条课程 · 阅读、听发音、收藏后练习。`) : text('No lessons found. Try another topic or save some words.', '暂无课程，请更换筛选条件或先收藏词条。');
  $('lessons').replaceChildren();
  for (const lesson of rows.slice(0, limit)) {
    $('lessons').append(buildLessonCard(lesson, () => {
      if (mode === 'saved' && !progress[lesson.id]?.saved) render();
    }));
  }
  $('more').hidden = rows.length <= limit;
}
function receive(response) {
  if (!response.ok) throw new Error(response.error);
  progress = response.progress;
  study = { paused: null, ...response.study };
  stats();
}
function today() {
  const completed = study.history.filter(entry => entry.day === localDay());
  $('today').textContent = text(
    'Today: ' + completed.length + ' sessions · ' + completed.reduce((n, r) => n + r.total, 0) + ' answers',
    '今日完成 ' + completed.length + ' 轮 · 共 ' + completed.reduce((n, r) => n + r.total, 0) + ' 道题');
}
function updatePausedBanner() {
  const banner = $('paused-banner');
  if (!banner) return;
  const paused = study.paused && !study.paused.completedAt ? study.paused : null;
  banner.hidden = !paused;
  if (!paused) return;
  const unit = starterUnit(paused.options?.scope);
  const done = isLearningStep(paused)
    ? text(`Next card ${paused.guideIndex + 1}/${paused.items.length}`, `继续第 ${paused.guideIndex + 1}/${paused.items.length} 张学习卡`)
    : text(`${paused.answers.length}/${paused.items.length} answered`, `已完成 ${paused.answers.length}/${paused.items.length} 题`);
  const label = unit ? text(unit.en, unit.zh) : text('Paused practice session', '已暂停的练习');
  $('paused-banner-text').textContent = `${label} · ${done}`;
}
function renderStudy() {
  today();
  const active = study.active;
  const running = active && !active.completedAt;
  $('start-session').hidden = Boolean(running || (active?.completedAt && !planning));
  if (!active || planning) { updatePausedBanner(); updateStudyPreview(); return; }
  if (isLearningStep(active)) { renderGuide(active); return; }
  const showFeedback = feedbackIndex !== null && active.answers[feedbackIndex];
  if (active.completedAt && !showFeedback) { renderSummary(active); return; }
  const index = showFeedback ? feedbackIndex : active.answers.length;
  const item = active.items[index];
  if (!item) return;
  const isFocus = active.options?.scope === 'focus';
  const pictureRecall = active.options?.direction === 'zh' && Boolean(starterUnit(active.options.scope));
  const recallKey = `${active.id}:${index}`;
  const awaitingReveal = pictureRecall && !showFeedback && revealedRecall !== recallKey;
  $('practice').hidden = false;
  $('quiz-counter').textContent = text('Lesson ', '第 ') + (index + 1) + ' / ' + active.items.length;
  $('session-progress').max = active.items.length; $('session-progress').value = active.answers.length;
  const baseContext = item.lesson.parent ? `${labels[item.lesson.kind]} · ${item.lesson.parent}` : labels[item.lesson.kind];
  $('quiz-context').textContent = isFocus
    ? `${baseContext} · ${item.earlyReview ? text('Focused drill', '定向加练') : text('Focused practice', '定向练习')}`
    : baseContext;
  $('quiz-end').textContent = isFocus ? text('← Back', '← 返回') : text('× End session', '× 结束本轮');
  const heading = $('question');
  heading.textContent = item.question.prompt;
  heading.lang = active.options?.direction === 'zh' ? 'zh-Hans' : 'en';
  $('quiz-picture').replaceChildren();
  if (item.lesson.kind === 'item') $('quiz-picture').append(itemImageNode(item.lesson, true));
  const help = $('recall-help');
  const chooseHelp = text('Choose the item’s English name.', '请选择物品的英文名称。');
  if (pictureRecall) {
    help.textContent = awaitingReveal
      ? text('Look at the picture and try saying the English name before showing the choices.', '先看图，试着说出物品的英文名称，再显示选项。')
      : showFeedback ? '' : chooseHelp;
  } else {
    help.textContent = item.lesson.kind === 'item'
      ? text('Say your answer aloud before choosing. The picture is your memory cue.', '先大声说出答案，再选择。物品图片可以帮助你回忆。')
      : text('Try saying your answer aloud before choosing.', '先尝试大声说出答案，再选择。');
  }
  const answers = $('answers');
  const reveal = $('show-choices');
  answers.hidden = awaitingReveal;
  answers.setAttribute('aria-label', text('Answer choices', '答案选项'));
  reveal.hidden = !awaitingReveal;
  reveal.textContent = text('Show choices', '显示选项');
  reveal.onclick = awaitingReveal ? () => {
    revealedRecall = recallKey;
    reveal.hidden = true;
    answers.hidden = false;
    help.textContent = chooseHelp;
    answers.focus();
  } : null;
  answers.replaceChildren(); $('quiz-audio').replaceChildren(); $('result').textContent = ''; $('quiz-explanation').replaceChildren();
  const feedbackBox = $('quiz-feedback');
  feedbackBox.hidden = !showFeedback;
  feedbackBox.dataset.outcome = showFeedback ? (showFeedback.correct ? 'correct' : 'wrong') : '';
  $('next').hidden = !showFeedback;
  $('next').textContent = active.completedAt ? text('See session summary →', '查看学习总结 →') : text('Next question →', '下一题 →');
  for (const option of item.question.options) {
    const button = node('button', option); button.disabled = Boolean(showFeedback || pendingAnswer);
    button.lang = heading.lang === 'en' ? 'zh-Hans' : 'en';
    if (showFeedback && option === item.question.answer) button.classList.add('correct');
    if (showFeedback && !showFeedback.correct && option === showFeedback.choice) button.classList.add('wrong');
    button.onclick = async () => {
      if (answers.hidden || pendingAnswer || study.active?.id !== active.id || study.active.answers.length !== index) return;
      const hadFocus = document.activeElement === button;
      pendingAnswer = true;
      for (const control of answers.children) control.disabled = true;
      try {
        receive(await api.answerSession(active.id, item.lesson.id, option));
        feedbackIndex = index;
        if (mode === 'quiz') {
          const keepFocus = hadFocus && (document.activeElement === button || document.activeElement === document.body);
          render();
          if (pictureRecall && keepFocus) $('next').focus();
        }
      } catch (error) {
        feedbackBox.hidden = false;
        feedbackBox.dataset.outcome = 'wrong';
        $('result').textContent = error.message;
        for (const control of answers.children) control.disabled = false;
        if (pictureRecall && hadFocus && document.activeElement === document.body) button.focus();
      }
      finally { pendingAnswer = false; }
    };
    answers.append(button);
  }
  if (showFeedback) {
    $('result').textContent = showFeedback.correct
      ? item.earlyReview
        ? text('✓ Correct! Extra drill recorded (review date unchanged).', '✓ 答对了！已记录本次加练（原复习计划不变）。')
        : text('✓ Correct! Scheduled for a later review.', '✓ 答对了！已安排后续复习。')
      : text('✕ Answer: ', '✕ 正确答案：') + item.question.answer;
    $('quiz-audio').append(audioButton(item.lesson));
    const explanation = $('quiz-explanation');
    const cue = itemCoaching(item.lesson);
    if (cue) {
      const coach = node('div', '', 'quiz-coach');
      coach.append(
        node('span', text('Say it in a match', '实战这样说'), 'quiz-coach-label'),
        node('p', cue.en, 'quiz-coach-en'),
        node('p', cue.zh, 'quiz-coach-zh'),
      );
      explanation.append(coach);
    }
    if (item.lesson.descriptionEn || item.lesson.descriptionZh) {
      if (cue) {
        const details = node('details', '', 'quiz-details');
        details.append(node('summary', text('Full bilingual details', '查看完整双语说明')));
        const body = node('div', '', 'quiz-details-body');
        if (item.lesson.descriptionEn) body.append(node('p', item.lesson.descriptionEn, 'quiz-desc-en'));
        if (item.lesson.descriptionZh) body.append(node('p', item.lesson.descriptionZh, 'quiz-desc-zh'));
        details.append(body);
        explanation.append(details);
      } else {
        const box = node('div', '', 'quiz-bilingual-box');
        if (item.lesson.descriptionEn) box.append(node('p', item.lesson.descriptionEn, 'quiz-desc-en'));
        if (item.lesson.descriptionZh) box.append(node('p', item.lesson.descriptionZh, 'quiz-desc-zh'));
        explanation.append(box);
      }
    }
  }
}
function renderSummary(active) {
  player.stop();
  $('session-summary').hidden = false;
  const nextUnit = starterUnit(active.options.scope) && nextStarterUnit(active.options.scope);
  const nextButton = $('start-next-unit');
  nextButton.hidden = !nextUnit;
  nextButton.textContent = text('Start next lesson →', '开始下一课 →');
  nextButton.onclick = nextUnit ? () => startStarterUnit(nextUnit) : null;
  $('new-session').classList.toggle('is-primary', !nextUnit);
  const correct = active.answers.filter(answer => answer.correct).length;
  const isFocus = active.options?.scope === 'focus';
  const focusItem = isFocus ? active.items[0] : null;
  const focusLesson = focusItem?.lesson || null;
  $('summary-score').textContent = text('You answered ', '本轮答对 ') + correct + ' / ' + active.items.length + text(' correctly.', ' 道题。');
  $('summary-tip').textContent = isFocus && focusItem?.earlyReview && correct === active.items.length
    ? text('Extra drill complete! Your scheduled spaced-review date is preserved.', '定向加练完成！原有间隔复习计划保持不变。')
    : text('Correct words return on their review date. Mistakes are due again after one minute.', '答对的词条按复习日期再次出现，错题一分钟后到期。');
  const mistakes = active.answers.filter(answer => !answer.correct);
  const focusHost = $('summary-focus-card');
  if (focusHost) {
    focusHost.replaceChildren();
    if (isFocus && focusLesson && !mistakes.length) {
      focusHost.hidden = false;
      const info = node('div', '', 'summary-focus-info');
      if (focusLesson.kind === 'item') info.append(itemImageNode(focusLesson));
      const names = node('div', '', 'summary-focus-names');
      names.append(node('strong', focusLesson.en), node('span', focusLesson.zh));
      info.append(names);
      const actions = node('div', '', 'actions');
      actions.append(audioButton(focusLesson), saveButton(focusLesson));
      focusHost.append(info, actions);
    } else {
      focusHost.hidden = true;
    }
  }
  $('mistakes-heading').hidden = !mistakes.length;
  $('session-mistakes').replaceChildren();
  for (const answer of mistakes) {
    const item = active.items.find(item => item.lesson.id === answer.id);
    const card = node('article', '', 'review-word');
    card.append(node('strong', item.lesson.en + ' · ' + item.lesson.zh));
    const actions = node('div', '', 'actions');
    actions.append(audioButton(item.lesson), saveButton(item.lesson));
    card.append(actions); $('session-mistakes').append(card);
  }
  const extra = $('summary-extra-actions');
  if (extra) {
    extra.replaceChildren();
    if (isFocus && focusLesson) {
      const nextDir = active.options.direction === 'en' ? 'zh' : 'en';
      const againBtn = node(
        'button',
        nextDir === 'zh'
          ? text('↻ Practice reverse (中文 → English)', '↻ 反向再练一次（中文 → English）')
          : text('↻ Practice reverse (English → 中文)', '↻ 反向再练一次（English → 中文）'),
        'summary-action-btn is-primary',
      );
      againBtn.type = 'button';
      againBtn.onclick = () => startFocusedPractice(focusLesson, returnContext, nextDir);
      extra.append(againBtn);

      if (focusLesson.kind === 'item') {
        const ctx = returnContext?.type === 'item' && returnContext.itemId === focusLesson.id
          ? returnContext
          : { type: 'item', itemId: focusLesson.id, realm: classifyItem(focusLesson, itemShopCategories).realm, fromPatch: null };
        const backItemBtn = node('button', text('← Back to item details', '← 返回物品详情'), 'summary-action-btn');
        backItemBtn.type = 'button';
        backItemBtn.onclick = () => returnFromPractice(ctx);
        extra.append(backItemBtn);
        if (ctx.fromPatch && currentPatch()) {
          const backPatchBtn = node('button', text(`← Back to Patch ${currentPatch()}`, `← 返回 ${currentPatch()} 更新`), 'summary-action-btn');
          backPatchBtn.type = 'button';
          backPatchBtn.onclick = () => {
            const snap = ctx.fromPatch;
            returnContext = null;
            mode = 'items';
            render();
            patchModalItemRealm = snap.realm || 'all';
            openPatchModal($('patch-pill'), snap.tab || 'highlights');
          };
          extra.append(backPatchBtn);
        }
      }
    }
    if (study.paused && !study.paused.completedAt) {
      const resumeBtn = node('button', text('▶ Resume paused session →', '▶ 继续之前的练习 →'), 'summary-action-btn');
      resumeBtn.type = 'button';
      resumeBtn.onclick = () => resumePausedSession();
      extra.append(resumeBtn);
    }
  }
}
function unitReadyCount(unit) {
  if (!unit || !catalog) return 0;
  const rows = unit.lessonIds.map(id => catalog.lessons.find(lesson => lesson.id === id)).filter(Boolean);
  if (rows.length !== unit.lessonIds.length || !rows.every(lesson => starterAvailability(starterEvidence, lesson.id, lesson))) return 0;
  const now = Date.now();
  return rows.filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= now).length;
}
const VALID_SCOPES = new Set(['all', 'saved', ...STARTER_UNITS.map(unit => unit.id)]);
const safeScope = value => (VALID_SCOPES.has(value) ? value : 'all');
const safeSize = value => ([5, 10].includes(Number(value)) ? String(value) : '5');
function pickReadyScope(preferredScope) {
  const scope = safeScope(preferredScope);
  const unit = starterUnit(scope);
  if (unit && unitReadyCount(unit) === 0) return nextStarterUnit()?.id || 'all';
  return scope;
}
function setupAvailability(scope = $('session-scope').value, kind = $('kind').value, search = $('search').value) {
  const now = Date.now();
  const unit = starterUnit(scope);
  if (unit) {
    const rows = unit.lessonIds.map(id => catalog.lessons.find(lesson => lesson.id === id)).filter(Boolean);
    const verified = rows.length === unit.lessonIds.length && rows.every(lesson => starterAvailability(starterEvidence, lesson.id, lesson));
    const readyRows = verified ? rows.filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= now) : [];
    const reviews = readyRows.filter(lesson => progress[lesson.id]?.attempts).length;
    return { unit, verified, matched: rows.length, scheduledLater: rows.length - readyRows.length, ready: readyRows.length, reviews, unseen: readyRows.length - reviews };
  }
  const matched = filterLessons(catalog.lessons, { kind, search, saved: scope === 'saved', progress })
    .filter(canQuizLesson);
  const eligible = matched.filter(lesson => !progress[lesson.id]?.due || progress[lesson.id].due <= now);
  const reviews = eligible.filter(lesson => progress[lesson.id]?.attempts).length;
  return { unit: null, verified: true, matched: matched.length, scheduledLater: matched.length - eligible.length, ready: eligible.length, reviews, unseen: eligible.length - reviews };
}
function updateStudyPreview() {
  if (!catalog) return;
  const status = $('study-status');
  const switchBtn = $('study-switch-scope');
  const scope = $('session-scope').value;
  const avail = setupAvailability(scope, $('kind').value, $('search').value);
  if (avail.ready > 0) {
    status.dataset.state = 'ready';
    switchBtn.hidden = true;
    switchBtn.onclick = null;
    if (avail.unit) {
      status.textContent = text(
        `${avail.unit.en}: ${avail.ready} words ready (learn first, then recall in English).`,
        `「${avail.unit.zh}」有 ${avail.ready} 个词待学习（先看图认词，再回忆英文）。`,
      );
    } else if (avail.reviews > 0) {
      status.textContent = text(
        `Ready: ${avail.reviews} due review${avail.reviews === 1 ? '' : 's'} · ${avail.unseen.toLocaleString()} new lessons (due reviews come first).`,
        `当前词库可练习：${avail.reviews} 条待复习 · ${avail.unseen.toLocaleString()} 条新课程（优先复习到期词条）。`,
      );
    } else {
      status.textContent = text(
        `${avail.ready.toLocaleString()} lessons ready to practice.`,
        `当前词库有 ${avail.ready.toLocaleString()} 条课程可练习。`,
      );
    }
    return;
  }
  status.dataset.state = 'empty';
  if (avail.unit) {
    status.textContent = text(
      `"${avail.unit.en}" is already scheduled for later review. Switch collections to keep practicing.`,
      `「${avail.unit.zh}」的 5 个词已完成本轮学习，复习时间未到。可切换词库继续练习。`,
    );
    const nextUnit = nextStarterUnit();
    switchBtn.hidden = false;
    if (nextUnit) {
      switchBtn.textContent = text(`Switch to "${nextUnit.en}" →`, `切换到「${nextUnit.zh}」→`);
      switchBtn.onclick = () => { $('session-scope').value = nextUnit.id; updateStudyPreview(); };
    } else {
      const allCounts = reviewCounts(catalog.lessons, progress);
      switchBtn.textContent = allCounts.reviews > 0
        ? text(`Switch to all (${allCounts.reviews} due) →`, `切换到全部课程（${allCounts.reviews} 条待复习）→`)
        : text('Switch to all lessons →', '切换到「符合筛选的全部课程」→');
      switchBtn.onclick = () => { $('session-scope').value = 'all'; $('kind').value = 'all'; $('search').value = ''; updateStudyPreview(); };
    }
    return;
  }
  if (scope === 'saved') {
    status.textContent = avail.scheduledLater > 0
      ? text(
        `Your ${avail.scheduledLater} matching saved word${avail.scheduledLater === 1 ? ' is' : 's are'} already scheduled for later review. Switch to all lessons or open an item to drill it anytime.`,
        `匹配的 ${avail.scheduledLater} 条收藏词条复习时间未到。可切换到全部课程，或在图鉴详情页随时定向练习。`,
      )
      : text(
        'No saved words are ready yet. Star any hero, item, or phrase, or switch to all lessons.',
        '当前没有待练习的收藏词条。请先收藏词条，或切换到全部课程。',
      );
    switchBtn.hidden = false;
    switchBtn.textContent = text('Switch to all lessons →', '切换到「符合筛选的全部课程」→');
    switchBtn.onclick = () => { $('session-scope').value = 'all'; $('kind').value = 'all'; $('search').value = ''; updateStudyPreview(); };
    return;
  }
  if (avail.scheduledLater > 0) {
    status.textContent = text(
      `${avail.scheduledLater} matching lesson${avail.scheduledLater === 1 ? ' is' : 's are'} already scheduled for a later review. Clear filters to practice other lessons, or open an item to drill it directly.`,
      `匹配的 ${avail.scheduledLater} 条课程已完成本轮学习，复习时间未到。可清除筛选练习其他词条，或在物品详情页点击「练习此物品」随时加练。`,
    );
  } else {
    status.textContent = text(
      'No lessons match your current search or topic filter.',
      '当前搜索或主题筛选下暂无可练习课程。',
    );
  }
  const hasFilters = Boolean($('search').value.trim() || $('kind').value !== 'all');
  switchBtn.hidden = !hasFilters;
  switchBtn.textContent = text('Clear filters →', '清除筛选条件 →');
  switchBtn.onclick = () => { $('search').value = ''; $('kind').value = 'all'; updateStudyPreview(); };
}
function enterPractice(scope, overrides = null) {
  player.stop();
  const prevMode = mode;
  const alreadyPlanning = prevMode === 'quiz' && planning && !scope && !overrides;
  mode = 'quiz'; feedbackIndex = null;
  if (!alreadyPlanning) {
    const running = Boolean(study.active && !study.active.completedAt);
    const activeIsFocus = study.active?.options?.scope === 'focus';
    const baseOptions = (!activeIsFocus && study.active?.options) ? study.active.options : study.preferences;
    planning = !running && Boolean(study.active?.completedAt && (scope || overrides || prevMode !== 'quiz'));
    $('session-size').value = safeSize(overrides?.size || baseOptions.size);
    $('session-scope').value = running && !activeIsFocus
      ? safeScope(baseOptions.scope)
      : pickReadyScope(overrides?.scope || scope || baseOptions.scope);
    if (running && !activeIsFocus) {
      $('kind').value = baseOptions.kind;
      $('search').value = baseOptions.search;
      $('direction').value = baseOptions.direction;
    } else if (overrides) {
      if (overrides.kind !== undefined) $('kind').value = overrides.kind;
      if (overrides.search !== undefined) $('search').value = overrides.search;
      if (overrides.direction !== undefined) $('direction').value = overrides.direction;
    } else if (prevMode !== 'quiz') {
      $('search').value = '';
      if (activeIsFocus || !study.active) $('kind').value = 'all';
    }
  }
  render();
  focusStudy();
}
function returnFromPractice(ctx) {
  returnContext = null;
  if (ctx?.type === 'item') {
    const lesson = catalog.lessons.find(row => row.kind === 'item' && row.id === ctx.itemId);
    const info = lesson ? classifyItem(lesson, itemShopCategories) : null;
    $('search').value = '';
    if (ctx.realm || info?.realm) itemRealm = ctx.realm || info.realm;
    itemCategory = 'all';
    itemQuickFilter = 'all';
    mode = 'items';
    render();
    if (lesson) openItemModal(lesson.id, null, { fromPatch: ctx.fromPatch || null });
    return;
  }
  mode = 'items';
  $('search').value = '';
  render();
  window.scrollTo(0, 0);
}
async function startFocusedPractice(lesson, context = null, directionOverride = null) {
  if (starting || !lesson) return;
  player.stop();
  starting = true;
  const direction = directionOverride || $('direction').value || study.preferences?.direction || 'en';
  try {
    const response = await api.practiceLesson({ lessonId: lesson.id, direction });
    receive(response);
    if (response.empty || !study.active) {
      $('message').textContent = response.unquizzable
        ? text('This item currently has identical English and Chinese names and cannot be quizzed yet.', '此物品中英文名称相同，暂不支持双语测验。')
        : text('Could not start practice for this item.', '暂无法开始此物品练习。');
      return;
    }
    returnContext = context;
    mode = 'quiz';
    planning = false;
    feedbackIndex = null;
    $('direction').value = study.active.options.direction;
    render();
    focusStudy();
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    starting = false;
    quickLabel();
  }
}
async function endActiveSession() {
  if (starting || pendingAnswer || advancing) return;
  player.stop();
  const wasFocus = study.active?.options?.scope === 'focus';
  const ctx = returnContext;
  try {
    receive(await api.abandonSession('active'));
    feedbackIndex = null;
    if (wasFocus && ctx) {
      returnFromPractice(ctx);
      return;
    }
    returnContext = null;
    planning = true;
    if (wasFocus) { $('search').value = ''; $('kind').value = 'all'; }
    render();
    focusStudy();
  } catch (error) {
    studyActionStatus().textContent = `${text('Could not end the session. Try again.', '暂无法结束本轮。请重试。')} ${error.message}`;
  }
}
async function resumePausedSession() {
  if (starting || pendingAnswer || advancing) return;
  player.stop();
  try {
    receive(await api.resumePaused());
    returnContext = null;
    mode = 'quiz';
    planning = false;
    feedbackIndex = null;
    if (study.active && study.active.options?.scope !== 'focus') {
      const options = study.active.options;
      $('kind').value = options.kind;
      $('search').value = options.search;
      $('direction').value = options.direction;
      $('session-size').value = safeSize(options.size);
      $('session-scope').value = safeScope(options.scope);
    }
    render();
    focusStudy();
  } catch (error) {
    studyActionStatus().textContent = `${text('Could not resume the session. Try again.', '暂无法继续本轮。请重试。')} ${error.message}`;
  }
}
function focusStudy() {
  const heading = !$('guided-lesson').hidden ? $('guide-card-title') : !$('practice').hidden ? $('question') : !$('session-summary').hidden ? $('summary-heading') : $('study-heading');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  heading.closest('section').scrollIntoView({ block: 'start' });
}
function studyActionStatus() {
  if (mode === 'starter') return $('starter-status');
  if (!$('guided-lesson').hidden) return $('guide-status');
  if (!$('practice').hidden) return $('quiz-status');
  if (!$('session-summary').hidden) return $('summary-status');
  return $('study-status');
}
async function beginSession(starterOptions) {
  if (starting) return;
  player.stop();
  const originMode = mode;
  const status = studyActionStatus();
  const controls = [$('start-session'), $('new-session'), $('start-next-unit')];
  starting = true;
  for (const control of controls) control.disabled = true;
  quickLabel();
  status.textContent = text('Starting lesson…', '正在开始课程…');
  try {
    const response = await api.startSession(starterOptions || { size: Number($('session-size').value), scope: $('session-scope').value,
      kind: $('kind').value, search: $('search').value, direction: $('direction').value });
    receive(response);
    status.textContent = '';
    if (response.empty) {
      if (!starterOptions && mode === 'quiz') updateStudyPreview();
      else status.textContent = text('No reviews are due for this lesson yet.', '本课暂无到期复习词条。');
      return;
    }
    planning = false; returnContext = null; feedbackIndex = null;
    if (study.active && study.active.options?.scope !== 'focus') {
      const options = study.active.options;
      $('kind').value = options.kind; $('search').value = options.search; $('direction').value = options.direction;
      $('session-size').value = safeSize(options.size); $('session-scope').value = safeScope(options.scope);
    }
    const stayed = mode === originMode;
    if (stayed) mode = 'quiz';
    render();
    if (stayed) focusStudy();
  } catch (error) {
    status.textContent = `${text('Could not start the lesson. Try again.', '暂无法开始课程。请重试。')} ${error.message}`;
  } finally {
    starting = false;
    for (const control of controls) control.disabled = false;
    if (mode === 'starter') {
      const message = $('starter-status').textContent;
      renderStarter();
      if (originMode === 'starter' && message) $('starter-status').textContent = message;
    }
    quickLabel();
  }
}
for (const [id, m] of [['starter-tab', 'starter'], ['heroes-tab', 'heroes'], ['items-tab', 'items'], ['phrases-tab', 'phrases'], ['browse', 'browse'], ['saved', 'saved'], ['quiz', 'quiz']]) $(id).onclick = () => {
  player.stop();
  closePatchModal({ restoreFocus: false });
  const changed = mode !== m;
  if (m === 'quiz') enterPractice();
  else {
    if (changed) $('search').value = '';
    if (m === 'heroes' && mode === 'heroes') { selectedHeroId = null; heroOpenedFromPatch = null; }
    if (m === 'items' && mode === 'items') { itemCategory = 'all'; selectedItemId = null; $('search').value = ''; }
    if (m === 'saved' && mode !== 'saved') $('kind').value = 'all';
    if (m === 'browse' && mode !== 'browse') $('kind').value = 'all';
    mode = m; limit = 24; render();
    if (changed) window.scrollTo(0, 0);
  }
};
$('hero-back').onclick = () => { player.stop(); selectedHeroId = null; heroOpenedFromPatch = null; render(); };
for (const id of ['search', 'kind', 'direction']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { player.stop(); hideShopHoverTip(); if (id === 'search') { selectedHeroId = null; selectedItemId = null; } limit = 24; render(); });
for (const id of ['session-scope', 'session-size']) $(id).addEventListener('change', () => { if (mode === 'quiz') updateStudyPreview(); });
$('path-status').onclick = async () => {
  if (!catalog || starting) return;
  const counts = reviewCounts(catalog.lessons, progress);
  if (!counts.reviews) return;
  const running = Boolean(study.active && !study.active.completedAt);
  if (running) { enterPractice(); return; }
  enterPractice('all', { scope: 'all', kind: 'all', search: '', size: '5' });
  await beginSession();
};
$('item-modal').addEventListener('click', event => {
  if (event.target === $('item-modal')) closeItemModal();
});
$('patch-pill').onclick = () => openPatchModal($('patch-pill'));
$('patch-modal').addEventListener('click', event => {
  if (event.target === $('patch-modal')) closePatchModal();
});
$('browse-patch-toggle').onclick = () => {
  browsePatchOnly = !browsePatchOnly;
  limit = 24;
  render();
};
window.addEventListener('scroll', hideShopHoverTip, { passive: true });
window.addEventListener('keydown', event => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (event.key === 'Escape' && !$('patch-modal').hidden) { closePatchModal(); return; }
  if (mode !== 'items' || $('item-modal').hidden || !selectedItemId) return;
  if (event.key === 'Escape') { closeItemModal(); return; }
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && visibleShopItems.length > 1) {
    const idx = visibleShopItems.findIndex(item => item.id === selectedItemId);
    if (idx < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    openItemModal(visibleShopItems[(idx + step + visibleShopItems.length) % visibleShopItems.length].id, null, { fromPatch: itemOpenedFromPatch });
  }
});
$('practice-saved').onclick = () => {
  const running = Boolean(study.active && !study.active.completedAt);
  if (running) { enterPractice(); return; }
  enterPractice('saved', { scope: 'saved', kind: $('kind').value, search: $('search').value });
};
$('quick-practice').onclick = async () => {
  if (mode === 'starter') {
    const unit = quickStarterUnit();
    if (study.active && !study.active.completedAt) enterPractice();
    else if (study.paused && !study.paused.completedAt) await resumePausedSession();
    else if (unit) await startStarterUnit(unit);
    return;
  }
  const running = Boolean(study.active && !study.active.completedAt);
  if (running) { enterPractice(); return; }
  const kind = ({ heroes: 'hero', items: 'item', phrases: 'phrase' })[mode] || $('kind').value;
  const scope = mode === 'saved' ? 'saved' : 'all';
  const currentSearch = $('search').value;
  enterPractice(scope, { scope, kind, search: currentSearch, size: '5' });
  await beginSession();
};
$('start-session').onclick = () => beginSession();
$('quiz-end').onclick = endActiveSession;
$('guide-end').onclick = endActiveSession;
$('resume-paused').onclick = resumePausedSession;
$('discard-paused').onclick = async () => {
  if (starting) return;
  try {
    receive(await api.abandonSession('paused'));
    if (mode === 'quiz') render();
  } catch (error) {
    $('study-status').textContent = error.message;
  }
};
$('guide-next').onclick = async () => {
  const active = study.active;
  if (advancing || !isLearningStep(active)) return;
  const next = $('guide-next');
  const hadFocus = document.activeElement === next;
  let failed = false;
  advancing = true; next.disabled = true; player.stop();
  $('guide-status').textContent = text('Saving your place…', '正在保存学习进度…');
  try {
    receive(await api.advanceGuide(active.id, active.items[active.guideIndex].lesson.id));
    $('guide-status').textContent = '';
    if (mode === 'quiz') { render(); focusStudy(); }
  } catch (error) {
    failed = true;
    $('guide-status').textContent = `${text('Could not save your place. Try again.', '暂无法保存学习进度。请重试。')} ${error.message}`;
  } finally {
    advancing = false;
    next.disabled = false;
    if (failed && hadFocus && !$('guided-lesson').hidden && document.activeElement === document.body) {
      next.focus({ preventScroll: true });
    }
  }
};
$('new-session').onclick = () => {
  const wasFocus = study.active?.options?.scope === 'focus';
  const currentScope = safeScope($('session-scope').value);
  const nextScope = pickReadyScope(currentScope);
  if (nextScope !== currentScope) {
    $('session-scope').value = nextScope;
    if (nextScope === 'all') { $('kind').value = 'all'; $('search').value = ''; }
  } else if (wasFocus) {
    $('session-scope').value = pickReadyScope(study.preferences?.scope || 'all');
    $('session-size').value = safeSize(study.preferences?.size || 5);
    $('kind').value = 'all';
    $('search').value = '';
  }
  returnContext = null;
  planning = true; feedbackIndex = null; render(); focusStudy();
};
$('more').onclick = () => { limit += 24; render(); };
$('next').onclick = () => { player.stop(); feedbackIndex = null; render(); focusStudy(); };
$('patches').onclick = async () => { const response = await api.sources(); if (!response.ok) $('update-status').textContent = response.error; };
$('refresh').onclick = async () => {
  $('refresh').disabled = true; $('update-status').textContent = text('Fetching bilingual lessons from Valve. This can take a few minutes…', '正在从 Valve 获取双语课程，可能需要几分钟…');
  try {
    const response = await api.update(); if (!response.ok) throw new Error(response.error);
    catalog = response.catalog;
    if (response.patchChanges) patchChanges = response.patchChanges;
    stats(); render();
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
  catalog = response.catalog; heroMeta = response.heroMeta || {}; itemImages = response.itemImages || { entries: {} }; itemShopCategories = response.itemShopCategories || { entries: {} }; itemDetails = response.itemDetails || { entries: {} }; starterEvidence = response.starterEvidence || { entries: {} }; patchChanges = response.patchChanges || { schema: 1, patch: null, removed: [], entries: {} }; audioManifest = response.audio; audioBaseline = response.audioBaseline; receive(response); $('session-size').value = safeSize(study.preferences.size); $('session-scope').value = safeScope(study.preferences.scope); render();
} catch (error) { $('message').textContent = error.message; for (const button of document.querySelectorAll('button')) button.disabled = true; }

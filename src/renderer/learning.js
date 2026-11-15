import { recordedAudio } from '../learning/audioAssets.js';
import { audioFreshness } from '../learning/contentAudit.js';
import { createLearningAudio } from './learning-audio.js';
import { filterLessons } from '../learning/model.js';
import { summarizeMastery } from '../learning/mastery.js';
import { SPOKEN_CATEGORIES, SPOKEN_PHRASES } from '../learning/spokenPhrases.js';
import { buildHeroPracticePersona, buildPhrasePracticePersona } from '../learning/voicePractice.js';
import { localDay, STUDY_DEFAULTS } from '../learning/study.js';
const api = window.learningAPI;
const $ = id => document.getElementById(id);
const chinese = window.dotapetI18n?.language === 'zh';
const text = (en, zh) => chinese ? zh : en;
const labels = { hero: text('Hero', '英雄'), ability: text('Hero ability', '英雄技能'), item: text('Item', '物品'), phrase: text('Team expression', '团队表达') };
const translations = {
  heading: '玩懂刀塔，开口说英语。', intro: '每天一点刀塔英语，桌面小伙伴一直陪着你。', 'total-label': '条双语课程', 'saved-label': '个收藏词条', 'due-label': '条待复习', 'accuracy-label': '答题正确率',
  'heroes-tab': '英雄图鉴', 'phrases-tab': '实战口语', browse: '探索课程', saved: '我的词本', quiz: '练习测验', 'search-label': '查找课程', 'kind-label': '学习主题', 'direction-label': '练习方向', next: '下一题 →', more: '加载更多',
  'hero-back': '← 返回四属性英雄墙', 'hero-abilities-heading': '英雄技能（中英双语对照）',
  'study-heading': '每日学习小课', 'study-help': '先复习到期的错题和旧词，再学习新词。', 'size-label': '每轮课程数量', 'scope-label': '练习词库', 'start-session': '开始学习 →', 'practice-saved': '练习我的收藏词条 →', 'summary-heading': '本轮学习完成', 'mistakes-heading': '需要再看看的词条', 'new-session': '安排下一轮 →',
  'audio-source': '音频使用你的双语词典中已生成的 AI 录音，按原速播放。历史录音可能与当前课程文字不同；缺少录音的词条会明确标注。',
  'sources-heading': '让知识保持更新', freshness: '技能说明是有日期的数据快照。数值和机制请以官方更新日志为准。', refresh: '从 Valve 更新课程', patches: '官方更新日志 ↗',
};
if (chinese) {
  for (const [id, value] of Object.entries(translations)) $(id).textContent = value;
  const names = ['全部主题', '英雄', '英雄技能', '物品', '团队表达'];
  [...$('kind').options].forEach((option, index) => { option.textContent = names[index]; });
  [...$('session-size').options].forEach(option => { option.textContent = option.value + ' 条课程'; });
  [...$('session-scope').options].forEach((option, index) => { option.textContent = ['符合筛选的全部课程', '仅收藏词条'][index]; });
  $('search').placeholder = '搜索英文 / 中文 / 英雄名…';
}
let catalog, heroMeta = {}, progress = {}, study = { preferences: STUDY_DEFAULTS, active: null, history: [] }, mode = 'heroes', limit = 24;
let selectedHeroId = null, attrFilter = 'all', spokenFilter = 'all';
let audioManifest = { entries: {} };
let audioBaseline = { entries: {} };
let pendingAnswer = false, starting = false, feedbackIndex = null;
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
const due = r => !progress[r.id]?.due || progress[r.id].due <= Date.now();
function selection() { return filterLessons(catalog.lessons, { kind: $('kind').value, search: $('search').value, saved: mode === 'saved', progress }); }
function stats() {
  $('total').textContent = catalog.lessons.length.toLocaleString();
  $('saved-count').textContent = catalog.lessons.filter(r => progress[r.id]?.saved).length;
  $('due-count').textContent = catalog.lessons.filter(due).length;
  const records = Object.values(progress), attempts = records.reduce((n, r) => n + (r.attempts || 0), 0);
  $('accuracy').textContent = attempts ? Math.round(records.reduce((n, r) => n + (r.correct || 0), 0) / attempts * 100) + '%' : '—';
  $('source').textContent = `${catalog.sourceLabel} · ${new Date(catalog.fetchedAt).toLocaleString()} · ${catalog.patch || text('Patch number unverified', '未核验版本号')}`;
  const strip = $('mastery-strip');
  if (strip) {
    strip.replaceChildren();
    for (const item of summarizeMastery(catalog.lessons, progress)) {
      const card = node('button', '', 'mastery-card');
      card.type = 'button';
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
        else if (item.key === 'phrase') { mode = 'phrases'; }
        else { mode = 'browse'; $('kind').value = item.key; limit = 24; }
        render();
      };
      strip.append(card);
    }
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
function render() {
  player.stop();
  stats();
  for (const [id, m] of [['heroes-tab', 'heroes'], ['phrases-tab', 'phrases'], ['browse', 'browse'], ['saved', 'saved'], ['quiz', 'quiz']]) {
    $(id).setAttribute('aria-pressed', String(mode === m));
  }
  const selectedHero = mode === 'heroes' && selectedHeroId
    ? catalog.lessons.find(l => l.kind === 'hero' && l.id === selectedHeroId)
    : null;
  $('hero-browser').hidden = mode !== 'heroes' || Boolean(selectedHero);
  $('hero-detail').hidden = !selectedHero;
  $('spoken-browser').hidden = mode !== 'phrases';
  $('library').hidden = mode === 'quiz' || mode === 'heroes' || mode === 'phrases';
  $('study-setup').hidden = mode !== 'quiz';
  $('practice-saved').hidden = mode !== 'saved';
  $('practice').hidden = true; $('session-summary').hidden = true;
  const kindLabel = $('kind').closest('label');
  const dirLabel = $('direction').closest('label');
  if (kindLabel) kindLabel.hidden = mode === 'heroes' || mode === 'phrases';
  if (dirLabel) dirLabel.hidden = mode === 'heroes' || mode === 'phrases';
  const active = mode === 'quiz' && study.active && !study.active.completedAt;
  for (const id of ['search', 'kind', 'direction', 'session-size', 'session-scope']) $(id).disabled = Boolean(active);
  if (mode === 'quiz') { $('message').textContent = ''; renderStudy(); return; }
  if (mode === 'heroes') {
    if (selectedHero) renderHeroDetail(selectedHero);
    else renderHeroBrowser();
    return;
  }
  if (mode === 'phrases') { renderSpokenBrowser(); return; }
  const rows = selection();
  $('message').textContent = rows.length ? text(`${rows.length} lessons · Read, listen, then save a word to practice.`, `${rows.length} 条课程 · 阅读、听发音、收藏后练习。`) : text('No lessons found. Try another topic or save some words.', '暂无课程，请更换筛选条件或先收藏词条。');
  $('lessons').replaceChildren();
  for (const lesson of rows.slice(0, limit)) {
    const card = node('article', '', 'lesson');
    const topicText = lesson.kind === 'item' && lesson.mechanics?.item_cost
      ? `${labels[lesson.kind]} · 🪙 ${lesson.mechanics.item_cost}g`
      : labels[lesson.kind];
    card.append(node('span', topicText, 'topic'));
    if (lesson.parent) card.append(node('p', lesson.parent, 'parent'));
    card.append(node('h2', lesson.en), node('p', lesson.zh, 'zh'));
    if (lesson.descriptionEn) card.append(node('p', lesson.descriptionEn, 'description'));
    const translation = node('details', '', 'translation');
    translation.append(node('summary', text('Chinese explanation', '中文说明')), node('p', lesson.descriptionZh || lesson.zh, 'description'));
    card.append(translation);
    const actions = node('div', '', 'actions');
    actions.append(audioButton(lesson), saveButton(lesson, render));
    card.append(actions); $('lessons').append(card);
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
  $('start-session').hidden = Boolean(running || active?.completedAt);
  if (!active) return;
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
    $('quiz-explanation').textContent = item.lesson.descriptionEn + '\n' + item.lesson.descriptionZh;
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
  const options = study.active?.options || study.preferences;
  $('session-size').value = options.size; $('session-scope').value = study.active && !study.active.completedAt ? options.scope : scope || options.scope;
  if (study.active && !study.active.completedAt) {
    $('kind').value = options.kind; $('search').value = options.search; $('direction').value = options.direction;
  }
  render();
  focusStudy();
}
function focusStudy() {
  const heading = !$('practice').hidden ? $('question') : !$('session-summary').hidden ? $('summary-heading') : $('study-heading');
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
    $('study-status').textContent = response.empty ? text('No words are ready in this collection. Save some words, change topic, or return when reviews are due.', '此词库暂无到期课程。请先收藏词条、更换主题，或到复习时间再来。') : text('Your session is saved automatically. You can finish it later.', '本轮进度自动保存，可以稍后继续。');
    if (mode === 'quiz') { render(); focusStudy(); }
  } catch (error) { $('study-status').textContent = error.message; }
  finally { starting = false; $('start-session').disabled = false; $('new-session').disabled = false; }
}
for (const [id, m] of [['heroes-tab', 'heroes'], ['phrases-tab', 'phrases'], ['browse', 'browse'], ['saved', 'saved'], ['quiz', 'quiz']]) $(id).onclick = () => {
  player.stop();
  if (m === 'quiz') enterPractice(); else { if (m === 'heroes' && mode === 'heroes') selectedHeroId = null; mode = m; limit = 24; render(); }
};
$('hero-back').onclick = () => { player.stop(); selectedHeroId = null; render(); };
for (const id of ['search', 'kind', 'direction']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { player.stop(); if (id === 'search') selectedHeroId = null; limit = 24; render(); });
$('practice-saved').onclick = () => { enterPractice('saved'); };
$('start-session').onclick = beginSession;
$('new-session').onclick = beginSession;
$('more').onclick = () => { limit += 24; render(); };
$('next').onclick = () => { player.stop(); feedbackIndex = null; render(); focusStudy(); };
$('patches').onclick = async () => { const response = await api.sources(); if (!response.ok) $('update-status').textContent = response.error; };
$('refresh').onclick = async () => {
  $('refresh').disabled = true; $('update-status').textContent = text('Fetching bilingual lessons from Valve. This can take a few minutes…', '正在从 Valve 获取双语课程，可能需要几分钟…');
  try {
    const response = await api.update(); if (!response.ok) throw new Error(response.error);
    catalog = response.catalog; render();
    $('update-status').textContent = text('Catalog updated. Your learning progress is preserved.', '课程已更新，学习进度已保留。');
  } catch (error) { $('update-status').textContent = text('Update failed; offline lessons remain available. ', '更新失败，仍可使用离线课程。') + error.message; }
  finally { $('refresh').disabled = false; }
};
let voiceBarLines = [], voiceDraft = '';
function renderVoiceTranscript() {
  const box = $('voice-bar-transcript');
  if (!box) return;
  box.replaceChildren();
  const entries = voiceDraft ? [...voiceBarLines, { who: text('Coach', '教练'), text: voiceDraft }] : voiceBarLines;
  for (const item of entries.slice(-4)) {
    const p = node('p', '', 'voice-line');
    p.append(node('strong', `${item.who}: `), document.createTextNode(item.text));
    box.append(p);
  }
}
function startVoiceBar(topic) {
  voiceBarLines = []; voiceDraft = '';
  $('voice-practice-bar').hidden = false;
  $('voice-bar-topic').textContent = `🎙️ ${topic}`;
  $('voice-bar-status').textContent = text('Connecting…', '正在连接语音…');
  $('voice-bar-stop').textContent = text('■ Stop Voice', '■ 停止语音');
  renderVoiceTranscript();
  $('voice-practice-bar').scrollIntoView({ block: 'nearest' });
}
$('voice-bar-stop').onclick = async () => {
  await api.stopVoice?.();
  $('voice-bar-status').textContent = text('Stopped', '已停止');
};
api.onVoiceStatus?.((data) => {
  if ($('voice-practice-bar').hidden && data?.status === 'disconnected') return;
  $('voice-practice-bar').hidden = false;
  const map = {
    connecting: text('Connecting…', '正在连接…'),
    connected: text('Listening… Speak English now', '已连接 · 请开口说英语'),
    speaking: text('Coach speaking…', '教练正在回复…'),
    disconnected: text('Disconnected', '已断开'),
    error: data?.error || text('Voice error', '语音出错'),
  };
  $('voice-bar-status').textContent = map[data?.status] || data?.provider || data?.status || '';
});
api.onVoiceEvent?.(({ channel, data }) => {
  if (channel === 'voice:user-final' && data?.text) {
    voiceBarLines.push({ who: text('You', '你'), text: data.text });
    renderVoiceTranscript();
  } else if (channel === 'voice:text-delta' && data?.delta) {
    voiceDraft += data.delta;
    renderVoiceTranscript();
  } else if (channel === 'voice:complete') {
    const finalText = data?.text || voiceDraft;
    if (finalText) voiceBarLines.push({ who: text('Coach', '教练'), text: finalText });
    voiceDraft = '';
    renderVoiceTranscript();
  }
});
api.onProgress(({ done, total }) => { $('update-status').textContent = text(`Updating ${done}/${total} heroes and items…`, `更新英雄与物品 ${done}/${total}…`); });
api.onHidden(() => player.stop());
window.addEventListener('pagehide', () => player.stop());
try {
  const response = await api.load(); if (!response.ok) throw new Error(response.error);
  catalog = response.catalog; heroMeta = response.heroMeta || {}; audioManifest = response.audio; audioBaseline = response.audioBaseline; receive(response); $('session-size').value = study.preferences.size; $('session-scope').value = study.preferences.scope; render();
} catch (error) { $('message').textContent = error.message; for (const button of document.querySelectorAll('button')) button.disabled = true; }

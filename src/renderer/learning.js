import { filterLessons, makeQuestion } from '../learning/model.js';
const api = window.learningAPI;
const $ = id => document.getElementById(id);
const chinese = window.dotapetI18n?.language === 'zh';
const text = (en, zh) => chinese ? zh : en;
const labels = { hero: text('Hero', '英雄'), ability: text('Hero ability', '英雄技能'), item: text('Item', '物品'), phrase: text('Team expression', '团队表达') };
const translations = {
  heading: '玩懂刀塔，开口说英语。', intro: '每天一点刀塔英语，桌面小伙伴一直陪着你。', 'total-label': '条双语课程', 'saved-label': '个收藏词条', 'due-label': '条待复习', 'accuracy-label': '答题正确率',
  browse: '探索课程', saved: '我的词本', quiz: '练习测验', 'search-label': '查找课程', 'kind-label': '学习主题', 'direction-label': '练习方向', next: '下一题 →', more: '加载更多',
  'sources-heading': '让知识保持更新', freshness: '技能说明是有日期的数据快照。数值和机制请以官方更新日志为准。', refresh: '从 Valve 更新课程', patches: '官方更新日志 ↗',
};
if (chinese) {
  for (const [id, value] of Object.entries(translations)) $(id).textContent = value;
  const names = ['全部主题', '英雄', '英雄技能', '物品', '团队表达'];
  [...$('kind').options].forEach((option, index) => { option.textContent = names[index]; });
  $('search').placeholder = '搜索英文 / 中文 / 英雄名…';
}
let catalog, progress = {}, mode = 'browse', limit = 24, question, answered = false, session = 0, correct = 0;
let quizIds = [];
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
}
async function persist(id, action, value) {
  const response = await api.save(id, action, value);
  if (!response.ok) throw new Error(response.error);
  progress = response.progress; stats();
}
function speak(value) {
  if (!window.speechSynthesis) { $('message').textContent = text('Speech is unavailable on this computer.', '本机暂不支持朗读。'); return; }
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(value); utterance.lang = 'en-US'; utterance.rate = .85;
  utterance.onerror = () => { $('message').textContent = text('Pronunciation unavailable. Check installed English voices.', '无法朗读，请检查系统英文语音包。'); };
  speechSynthesis.speak(utterance);
}
function render() {
  stats();
  for (const id of ['browse', 'saved', 'quiz']) $(id).setAttribute('aria-pressed', String(mode === id));
  $('library').hidden = mode === 'quiz'; $('practice').hidden = mode !== 'quiz';
  if (mode === 'quiz') return;
  const rows = selection();
  $('message').textContent = rows.length ? text(`${rows.length} lessons · Read, listen, then save a word to practice.`, `${rows.length} 条课程 · 阅读、听发音、收藏后练习。`) : text('No lessons found. Try another topic or save some words.', '暂无课程，请更换筛选条件或先收藏词条。');
  $('lessons').replaceChildren();
  for (const lesson of rows.slice(0, limit)) {
    const card = node('article', '', 'lesson');
    card.append(node('span', labels[lesson.kind], 'topic'));
    if (lesson.parent) card.append(node('p', lesson.parent, 'parent'));
    card.append(node('h2', lesson.en), node('p', lesson.zh, 'zh'));
    if (lesson.descriptionEn) card.append(node('p', lesson.descriptionEn, 'description'));
    const translation = node('details', '', 'translation');
    translation.append(node('summary', text('Chinese explanation', '中文说明')), node('p', lesson.descriptionZh || lesson.zh, 'description'));
    card.append(translation);
    const actions = node('div', '', 'actions'), listen = node('button', text('▶ Listen', '▶ 听发音')), save = node('button', progress[lesson.id]?.saved ? text('★ Saved', '★ 已收藏') : text('☆ Save word', '☆ 收藏'));
    save.setAttribute('aria-pressed', String(Boolean(progress[lesson.id]?.saved)));
    listen.onclick = () => speak(lesson.en);
    save.onclick = async () => { save.disabled = true; try { await persist(lesson.id, 'saved', !progress[lesson.id]?.saved); render(); } catch (error) { $('message').textContent = error.message; save.disabled = false; } };
    actions.append(listen, save); card.append(actions); $('lessons').append(card);
  }
  $('more').hidden = rows.length <= limit;
}
function startQuestion() {
  answered = false; question = null; $('answers').replaceChildren(); $('result').textContent = ''; $('quiz-explanation').textContent = '';
  const pool = selection().filter(due);
  const candidates = pool.filter(r => !quizIds.includes(r.id));
  const lesson = candidates[Math.floor(Math.random() * candidates.length)];
  $('next').hidden = true;
  if (!lesson) {
    $('question').textContent = text('Review complete', '本轮复习完成');
    $('quiz-context').textContent = text('Try another topic, or return when more lessons are due.', '可以更换主题，或稍后复习到期课程。');
    $('quiz-counter').textContent = `${correct} / ${session}`; return;
  }
  question = makeQuestion(lesson, catalog.lessons, $('direction').value);
  if (!question) { $('question').textContent = text('More lessons are needed for this quiz.', '此主题需要更多课程才能生成测验。'); return; }
  $('quiz-counter').textContent = text(`Practice · ${correct}/${session} correct this session`, `练习 · 本轮答对 ${correct}/${session}`);
  $('quiz-context').textContent = `${labels[lesson.kind]} · ${lesson.parent || ''}`;
  $('question').textContent = question.prompt;
  for (const option of question.options) {
    const button = node('button', option);
    button.onclick = async () => {
      if (answered) return;
      answered = true; const right = option === question.answer;
      for (const b of $('answers').children) { b.disabled = true; if (b.textContent === question.answer) b.classList.add('correct'); }
      if (!right) button.classList.add('wrong');
      try {
        await persist(lesson.id, 'answer', right);
        session++; correct += Number(right); quizIds.push(lesson.id);
        $('result').textContent = right ? text('Correct! Scheduled for a later review.', '答对了！已安排后续复习。') : text(`Answer: ${question.answer}. Review again in a minute.`, `正确答案：${question.answer}。一分钟后可再次复习。`);
        $('quiz-explanation').textContent = `${lesson.descriptionEn}\n${lesson.descriptionZh}`;
        $('next').hidden = false;
      } catch (error) { $('result').textContent = error.message; answered = false; for (const b of $('answers').children) b.disabled = false; }
    };
    $('answers').append(button);
  }
}
for (const id of ['browse', 'saved', 'quiz']) $(id).onclick = () => { window.speechSynthesis?.cancel(); mode = id; limit = 24; render(); if (id === 'quiz') { quizIds = []; startQuestion(); } };
for (const id of ['search', 'kind', 'direction']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { limit = 24; render(); if (mode === 'quiz') { quizIds = []; startQuestion(); } });
$('more').onclick = () => { limit += 24; render(); };
$('next').onclick = startQuestion;
$('patches').onclick = async () => { const response = await api.sources(); if (!response.ok) $('update-status').textContent = response.error; };
$('refresh').onclick = async () => {
  $('refresh').disabled = true; $('update-status').textContent = text('Fetching bilingual lessons from Valve. This can take a few minutes…', '正在从 Valve 获取双语课程，可能需要几分钟…');
  try {
    const response = await api.update(); if (!response.ok) throw new Error(response.error);
    catalog = response.catalog; quizIds = []; render(); if (mode === 'quiz') startQuestion();
    $('update-status').textContent = text('Catalog updated. Your learning progress is preserved.', '课程已更新，学习进度已保留。');
  } catch (error) { $('update-status').textContent = text('Update failed; offline lessons remain available. ', '更新失败，仍可使用离线课程。') + error.message; }
  finally { $('refresh').disabled = false; }
};
api.onProgress(({ done, total }) => { $('update-status').textContent = text(`Updating ${done}/${total} heroes and items…`, `更新英雄与物品 ${done}/${total}…`); });
api.onHidden(() => window.speechSynthesis?.cancel());
try {
  const response = await api.load(); if (!response.ok) throw new Error(response.error);
  catalog = response.catalog; progress = response.progress; render();
} catch (error) { $('message').textContent = error.message; for (const button of document.querySelectorAll('button')) button.disabled = true; }

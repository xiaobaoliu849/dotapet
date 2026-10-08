import fs from 'node:fs';

export const DEFAULT_SIMPLIFIED_PHRASES = [
  { cn: '快推中路别刷了，一波带走', en: 'Push mid now, end the game.' },
  { cn: '集合开雾打肉山，别单走', en: 'Smoke and rosh now, stick together.' },
  { cn: '没买活稳点，别单走送了', en: "No buyback, play safe and don't get caught." },
  { cn: 'TP救一下，反打他们！', en: 'TP help! Counter-initiate now!' },
  { cn: '先手秒辅助，别集火前排', en: 'Focus backline supports first, ignore tank.' },
  { cn: '键盘上拴条狗都比你玩得好', en: 'A dog on keyboard plays better than you.' },
  { cn: '超级兵死了给钱，你死了只值举报', en: 'Mega creeps give gold, you only give reports.' },
  { cn: '在野区采灵芝？出来打团', en: 'AFK jungle forever? Join the fight.' },
  { cn: '脑子不用可以捐给有用的人', en: 'Donate your brain if you never use it.' },
  { cn: '打得漂亮，兄弟们冲！', en: "Well played boys, let's keep going!" },
];
const copy = phrases => phrases.map(({ cn, en }) => ({ cn, en }));
const validRows = phrases => Array.isArray(phrases) && Array.from(phrases).every(row =>
  row && typeof row.cn === 'string' && typeof row.en === 'string');
const sameRow = (a, b) => a.cn === b.cn && a.en === b.en;

/** Commit the cache only after the complete file has replaced the old one. */
export class PhrasesStore {
  constructor({ filePath, fsImpl = fs }) {
    this.filePath = filePath;
    this.fs = fsImpl;
    this.cached = null;
    this.revision = 0;
  }
  load() {
    if (!this.cached) {
      try {
        const rows = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
        // Older lists may have fewer than ten rows; keep them and pad blanks.
        if (validRows(rows) && rows.length > 0) {
          this.cached = Array.from({ length: 10 }, (_, i) => rows[i] || { cn: '', en: '' });
        }
      } catch { /* Missing or malformed config falls back to the shipped list. */ }
      this.cached ||= copy(DEFAULT_SIMPLIFIED_PHRASES);
    }
    return copy(this.cached);
  }
  snapshot() {
    return { phrases: this.load(), revision: this.revision };
  }
  save(payload) {
    // Legacy callers may still replace the full list. Editors send only their
    // changed row indices and the saved values those edits started from.
    const fullList = Array.isArray(payload);
    const phrases = fullList ? payload : payload?.phrases;
    if (!validRows(phrases) || phrases.length !== 10) {
      return { success: false, error: '短语列表需要 10 行，每行包含中文和英文文本' };
    }
    const changedRows = fullList ? Array.from({ length: 10 }, (_, i) => i) : payload.changedRows;
    const base = fullList ? null : payload.basePhrases;
    if (!Array.isArray(changedRows) || changedRows.length > 10 ||
      !Array.from(changedRows).every(i => Number.isInteger(i) && i >= 0 && i < 10) ||
      new Set(changedRows).size !== changedRows.length ||
      (!fullList && (!validRows(base) || base.length !== 10))) {
      return { success: false, error: '短语修改的行号或原始内容无效' };
    }
    const current = this.load();
    const conflicts = fullList ? [] : changedRows.filter(i => !sameRow(current[i], base[i]) && !sameRow(current[i], phrases[i]));
    if (conflicts.length) {
      const labels = conflicts.map(i => i === 9 ? '0' : String(i + 1)).join('、');
      return { success: false, conflicts, ...this.snapshot(), error: `第 ${labels} 行已在另一处修改，本次未保存` };
    }
    const next = current;
    for (const index of changedRows) next[index] = { cn: phrases[index].cn, en: phrases[index].en };
    const temporary = `${this.filePath}.tmp`;
    try {
      this.fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
      this.fs.renameSync(temporary, this.filePath);
      this.cached = next;
      this.revision++;
      return { success: true, ...this.snapshot() };
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch { /* Best effort; keep original. */ }
      return { success: false, error: error.message };
    }
  }
}

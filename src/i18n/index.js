import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Chinese is the source text and every string is its own key, so a language
 * is one dictionary file (<id>.json) mapping each Chinese string to its translation.
 * Templates use {0}, {1}… for the parts filled in at run time.
 */
const directory = path.dirname(fileURLToPath(import.meta.url));
/** Each language as it names itself, so it can be found by someone who cannot read the others. */
export const LANGUAGES = [
  { id: 'zh', name: '中文' },
  { id: 'en', name: 'English' },
  { id: 'ru', name: 'Русский' },
  { id: 'uk', name: 'Українська' },
];
export const LANGUAGE_CHOICES = ['system', ...LANGUAGES.map(language => language.id)];
const cache = new Map();

/** The language to show: the saved choice, or the first system language we have, or English. */
export function resolveLanguage(choice, systemLanguages = []) {
  if (choice !== 'system' && LANGUAGES.some(language => language.id === choice)) return choice;
  for (const tag of systemLanguages) {
    const id = String(tag).toLowerCase().split(/[-_]/)[0];
    if (LANGUAGES.some(language => language.id === id)) return id;
  }
  return 'en';
}

/** The dictionary for a language; Chinese needs none. A broken file falls back to Chinese, not a crash. */
export function loadStrings(language) {
  if (language === 'zh') return {};
  if (!cache.has(language)) {
    try { cache.set(language, JSON.parse(fs.readFileSync(path.join(directory, `${language}.json`), 'utf8'))); }
    catch (error) { console.error(`[i18n] ${language} dictionary unreadable:`, error.message); cache.set(language, {}); }
  }
  return cache.get(language);
}

const fill = (text, values) => text.replace(/\{(\d)\}/g, (match, index) => values[index] ?? match);

/** t('已导入 {0} 个密钥', 3): the translation with its parts filled in, or the Chinese if none. */
export function translate(strings, text, ...values) {
  return fill(strings[text] ?? text, values);
}

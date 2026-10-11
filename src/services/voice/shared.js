/** Small helpers every voice provider uses. */
import crypto from 'crypto';

export function detectPrimaryLanguage(text) {
  if (!text || !text.trim()) return 'zh';
  const trimmed = text.trim();
  const chineseChars = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latinLetters = (trimmed.match(/[a-zA-Z]/g) || []).length;

  if (chineseChars === 0 && latinLetters > 0) {
    return 'en';
  }
  if (latinLetters > chineseChars * 2) {
    return 'en';
  }
  return 'zh';
}

/**
 * Helper to generate a unique event id
 */
export function generateEventId(prefix = 'evt') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Copies a mixin class's methods onto a prototype, non-enumerable like its own methods. */
export function mixin(target, ...sources) {
  for (const source of sources) {
    for (const name of Object.getOwnPropertyNames(source.prototype)) {
      if (name !== 'constructor') Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source.prototype, name));
    }
  }
}

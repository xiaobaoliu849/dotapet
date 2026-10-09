/*
 * Shows the page in the chosen language. Chinese is the source text, so pages
 * keep writing Chinese and every string is its own key: this translates text and
 * labels as they reach the page, including text scripts set later and messages
 * from main. Runs in <head>, before the body exists, so Chinese never flashes.
 * Anything inside translate="no" (names, user content) is left alone.
 */
(() => {
  const { language = 'zh', strings = {} } = window.dotapetI18n || {};
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
  const fill = (text, values) => text.replace(/\{(\d)\}/g, (match, index) => values[index] ?? match);
  /** For text that never reaches the page, such as a confirm() prompt. */
  window.t = (text, ...values) => fill(text, values);
  if (language === 'zh') return;
  const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // '已导入 {0} 个密钥' becomes /^已导入 (.+?) 个密钥$/, its parts filled back into the translation.
  // A part in quotes ("{0}", “{0}”, 「{0}」) is the user's own text, such as a copied phrase, and is kept as is.
  const templates = Object.keys(strings).filter(key => /\{\d\}/.test(key)).map(key => {
    const order = [...key.matchAll(/\{(\d)\}/g)].map(match => Number(match[1]));
    const verbatim = new Set([...key.matchAll(/["“「]\{(\d)\}["”」]/g)].map(match => Number(match[1])));
    const literal = key.replace(/\{\d\}/g, '').length;
    return { order, verbatim, literal, pattern: new RegExp(`^${key.split(/\{\d\}/).map(escape).join('([\\s\\S]*?)')}$`), translation: strings[key] };
  // The most specific template wins, whatever the dictionary's order: '已换上{0}，外观已应用。' before '已换上{0}。'.
  }).sort((a, b) => b.literal - a.literal);
  function lookup(text) {
    if (Object.hasOwn(strings, text)) return strings[text];
    for (const { order, verbatim, pattern, translation } of templates) {
      const match = pattern.exec(text);
      if (!match) continue;
      const values = [];
      order.forEach((index, position) => { values[index] = match[position + 1]; });
      // Other parts may be translatable themselves, such as a provider name or an error from main.
      return translation.replace(/\{(\d)\}/g, (_, index) => {
        const part = values[index] ?? '';
        return verbatim.has(Number(index)) ? part : lookup(part) ?? part;
      });
    }
    return null;
  }
  /** The translation keeping the text's own surrounding spaces, or null when there is none. */
  function translate(text) {
    const core = text.trim();
    if (!core) return null;
    const translated = lookup(core);
    return translated == null ? null : text.slice(0, text.indexOf(core)) + translated + text.slice(text.indexOf(core) + core.length);
  }
  const skipped = node => {
    const element = node.nodeType === 1 ? node : node.parentElement;
    return !element || Boolean(element.closest('script, style, textarea, [translate="no"]'));
  };
  function translateText(node) {
    if (skipped(node)) return;
    const translated = translate(node.data);
    if (translated != null && translated !== node.data) node.data = translated;
  }
  function translateAttribute(element, name) {
    const value = element.getAttribute(name);
    if (value == null || skipped(element)) return;
    const translated = translate(value);
    if (translated != null && translated !== value) element.setAttribute(name, translated);
  }
  function translateTree(root) {
    if (root.nodeType === 3) return translateText(root);
    if (root.nodeType !== 1) return;
    for (const name of ATTRIBUTES) translateAttribute(root, name);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) translateText(node);
      else for (const name of ATTRIBUTES) translateAttribute(node, name);
    }
  }
  // Translations never match a Chinese key, so changing a node here settles at once.
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(translateTree);
      else if (record.type === 'characterData') translateText(record.target);
      else translateAttribute(record.target, record.attributeName);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  translateTree(document.documentElement);
  window.t = (text, ...values) => fill(lookup(text) ?? text, values);
})();

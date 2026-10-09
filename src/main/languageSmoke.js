import fs from 'node:fs';
import path from 'node:path';
import { captureHub, navigateHub, pageLoaded } from './controlCenterSmoke.js';

/**
 * Any Chinese left on a page shown in another language: visible text and the labels
 * screen readers and tooltips use. Names and user content opt out with translate="no".
 */
const leftoverScript = `(async () => {
  await new Promise(resolve => setTimeout(resolve, 400));
  // Chinese characters, and Chinese punctuation such as a lone 。 or ，
  const chinese = /[\\u3000-\\u303f\\u3400-\\u9fff\\uff01-\\uff5e]/, found = new Set();
  const skipped = element => !element || element.closest('script, style, textarea, [translate="no"]');
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 3) { if (chinese.test(node.data) && !skipped(node.parentElement)) found.add(node.data.trim()); continue; }
    if (skipped(node)) continue;
    for (const name of ['placeholder', 'title', 'aria-label', 'alt', 'label']) {
      const value = node.getAttribute(name);
      if (value && chinese.test(value)) found.add(name + '=' + value);
    }
  }
  return { lang: document.documentElement.lang, found: [...found] };
})()`;

/** Opens every settings page and the F6 panel in the smoke test's language and fails on any Chinese left. */
export async function runLanguageSmoke({ controlCenter, openPanel, nativeImage, outputDirectory, language, documentation = false }) {
  const problems = [];
  const check = async (label, contents) => {
    const { lang, found } = await contents.executeJavaScript(leftoverScript);
    const expectedLanguage = language === 'zh' ? 'zh-CN' : language;
    if (lang !== expectedLanguage) problems.push(`${label}: page language is ${lang}`);
    if (language !== 'zh') for (const text of found) problems.push(`${label}: ${text}`);
  };
  controlCenter.open('services');
  // Checks use CI's small desktop; documentation captures the normal settings size.
  controlCenter.window.setSize(...(documentation ? [1060, 820] : [1024, 728]));
  await pageLoaded(controlCenter.window.webContents);
  // The shell's own script must be running before its sidebar can be clicked.
  await controlCenter.window.webContents.executeJavaScript(`new Promise(resolve => document.readyState === 'complete' ? resolve() : addEventListener('load', resolve))`);
  for (const page of ['services', 'appearance', 'phrases', 'help']) {
    await navigateHub(controlCenter, page);
    const contents = controlCenter.contents(page);
    if (contents) { await pageLoaded(contents); await check(page, contents); }
    // Longer words must not break the layout: the character column never scrolls inside itself.
    if (page === 'appearance' && await contents.executeJavaScript(`(() => { const column = document.querySelector('aside'); return column.scrollHeight > column.clientHeight || column.scrollWidth > column.clientWidth; })()`)) {
      const [width, height] = await contents.executeJavaScript(`(() => { const column = document.querySelector('aside'); return [column.scrollWidth + '/' + column.clientWidth, column.scrollHeight + '/' + column.clientHeight]; })()`);
      problems.push(`appearance: the character column overflows (content/room: width ${width}, height ${height})`);
    }
    fs.writeFileSync(path.join(outputDirectory, `language-${page}.png`), (await captureHub(controlCenter, nativeImage)).toPNG());
    if (documentation && page === 'services') {
      await contents.executeJavaScript(`(() => {
        document.getElementById('advanced').open = true;
        document.querySelector('.conversation-address').scrollIntoView({ block: 'start' });
      })()`);
      fs.writeFileSync(path.join(outputDirectory, 'language-chat-preferences.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
      await contents.executeJavaScript(`document.getElementById('advanced').open = false; window.scrollTo(0, 0);`);
    }
  }
  await check('sidebar', controlCenter.window.webContents);
  const panel = openPanel();
  await pageLoaded(panel.webContents);
  await check('F6 panel', panel.webContents);
  fs.writeFileSync(path.join(outputDirectory, 'language-f6.png'), (await panel.webContents.capturePage()).toPNG());
  if (problems.length) throw new Error(`Language check failed in ${language}:\n  ${problems.join('\n  ')}`);
}

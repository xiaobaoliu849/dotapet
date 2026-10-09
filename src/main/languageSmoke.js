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
export async function runLanguageSmoke({ controlCenter, openPanel, nativeImage, outputDirectory, language }) {
  const problems = [];
  const check = async (label, contents) => {
    const { lang, found } = await contents.executeJavaScript(leftoverScript);
    if (lang !== language) problems.push(`${label}: page language is ${lang}`);
    for (const text of found) problems.push(`${label}: ${text}`);
  };
  controlCenter.open('services');
  await pageLoaded(controlCenter.window.webContents);
  // The shell's own script must be running before its sidebar can be clicked.
  await controlCenter.window.webContents.executeJavaScript(`new Promise(resolve => document.readyState === 'complete' ? resolve() : addEventListener('load', resolve))`);
  for (const page of ['services', 'appearance', 'phrases', 'help']) {
    await navigateHub(controlCenter, page);
    const contents = controlCenter.contents(page);
    if (contents) { await pageLoaded(contents); await check(page, contents); }
    fs.writeFileSync(path.join(outputDirectory, `language-${page}.png`), (await captureHub(controlCenter, nativeImage)).toPNG());
  }
  await check('sidebar', controlCenter.window.webContents);
  const panel = openPanel();
  await pageLoaded(panel.webContents);
  await check('F6 panel', panel.webContents);
  fs.writeFileSync(path.join(outputDirectory, 'language-f6.png'), (await panel.webContents.capturePage()).toPNG());
  if (problems.length) throw new Error(`Untranslated text in ${language}:\n  ${problems.join('\n  ')}`);
}

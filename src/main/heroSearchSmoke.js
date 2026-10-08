import fs from 'node:fs';
import path from 'node:path';

/** Exercise advertised queries and the empty selection dock in the real UI. */
export async function runHeroSearchSmoke({ mainWindow, outputDirectory }) {
  const result = await mainWindow.webContents.executeJavaScript(`(async () => {
    const get = id => document.getElementById(id);
    get('hero-badge').click();
    get('tab-hero-list').click();
    const input = get('hero-search-input');
    const dock = get('hero-selection-dock');
    const search = query => {
      input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
      return [...get('heroes-grid').querySelectorAll('.hero-card')].map(card => card.dataset.heroId);
    };
    const examples = [['卡尔', 'invoker'], ['SF', 'shadow_fiend'], ['白牛', 'spirit_breaker'],
      ['蓝猫', 'storm_spirit'], ['AM', 'anti_mage'], ['kaer', 'invoker']];
    for (const [query, expected] of examples) {
      const matches = search(query);
      if (matches.length !== 1 || matches[0] !== expected) throw new Error('Hero search failed: ' + query);
      if (dock.hidden || getComputedStyle(dock).display === 'none') throw new Error('Matching hero has no selection dock');
    }
    if (search('unknown-hero-xyz').length) throw new Error('Empty query unexpectedly matched');
    if (!dock.hidden || getComputedStyle(dock).display !== 'none') throw new Error('Empty search retained an actionable hero');
    get('btn-clear-search').click();
    if (get('heroes-grid').querySelectorAll('.hero-card').length !== 127 || dock.hidden) throw new Error('Clear search did not restore gallery');
    search('SF');
    await new Promise(resolve => setTimeout(resolve, 100));
    return { examples: examples.length, emptyDockHidden: true, clearRestoresGallery: true };
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'hero-search.png'), (await mainWindow.webContents.capturePage()).toPNG());
  await mainWindow.webContents.executeJavaScript("document.getElementById('btn-clear-search').click(); document.getElementById('btn-close-modal').click();");
  return result;
}

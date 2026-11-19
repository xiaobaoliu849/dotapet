import fs from 'node:fs';
import path from 'node:path';
import { captureHub } from './controlCenterSmoke.js';

export async function runLearningImagesSmoke({ page, controlCenter, nativeImage, outputDirectory }) {
  const result = await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    for (let i = 0; i < 100 && byId('total').textContent === '—'; i++) await new Promise(r => setTimeout(r, 30));
    if (byId('due-count').textContent !== '0') throw new Error('Unseen words counted as overdue reviews');
    const data = await window.learningAPI.load();
    // Every source is a bundled file URL: the offline check never asks the network for artwork.
    const entries = Object.values(data.itemImages.entries);
    await Promise.all(entries.map(entry => new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error('Image decode timed out: ' + entry.file)), 5000);
      image.onload = () => { clearTimeout(timer); image.naturalWidth > 0 ? resolve() : reject(new Error('Empty image: ' + entry.file)); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('Image decode failed: ' + entry.file)); };
      image.src = new URL('assets/learning-items/' + entry.file, location.href).href;
    })));

    byId('items-tab').click();
    const basicCols = document.querySelectorAll('.shop-columns-basic .shop-column').length;
    const upgradeCols = document.querySelectorAll('.shop-columns-upgrade .shop-column').length;
    if (basicCols !== 5 || upgradeCols !== 6) throw new Error('Expected 5 basic + 6 upgrade shop columns, got ' + basicCols + '+' + upgradeCols);
    if (!byId('more').hidden) throw new Error('Legacy pagination button should be hidden in Shop Grid');
    // Eagerly decode visible shop icons before taking the shop overview screenshot.
    const shopImgs = [...document.querySelectorAll('#item-list .shop-icon-tile img')];
    for (const img of shopImgs) img.loading = 'eager';
    await Promise.all(shopImgs.map(img => img.decode().catch(() => {})));
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) throw new Error('Shop grid overflows wide window');
    byId('tools').scrollIntoView({ block: 'start' });
    return { decoded: entries.length, basicCols, upgradeCols };
  })()`);

  // Capture 1: Wide official Dota 2 Shop Grid (Basics 5 cols)
  fs.writeFileSync(path.join(outputDirectory, 'learning-items.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // Capture 1b: Wide official Dota 2 Shop Grid scrolled to Upgrades 6 cols + Hover Preview tooltip
  await page.executeJavaScript(`(async () => {
    document.getElementById('shop-shelf-upgrade').scrollIntoView({ block: 'start' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bkbTile = document.querySelector('.shop-icon-tile[data-item-id="item:116"]');
    if (bkbTile) bkbTile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    if (document.getElementById('shop-hover-tip').hidden) throw new Error('Shop hover preview did not appear');
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-items-upgrades.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // Capture 2: Neutral Items Tiers view
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    document.querySelector('[data-realm="neutral"]').click();
    const tiers = document.querySelectorAll('#item-list .shop-band').length;
    if (tiers < 4) throw new Error('Expected Neutral item tiers, got ' + tiers);
    const imgs = [...document.querySelectorAll('#item-list .item-name-tile img')].slice(0, 30);
    for (const img of imgs) img.loading = 'eager';
    await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    byId('tools').scrollIntoView({ block: 'start' });
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-items-neutral.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // Switch back to Shop, click Armor category, then test BKB alias search & Item Inspector + image fallback
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    document.querySelector('[data-realm="shop"]').click();
    document.querySelector('[data-category="armor"]').click();
    const armorTiles = document.querySelectorAll('#item-list .item-name-tile').length;
    if (armorTiles < 10) throw new Error('Armor category focus did not render bilingual tiles: ' + armorTiles);
    byId('search').value = 'bkb'; byId('search').dispatchEvent(new Event('input'));
    const card = document.querySelector('#item-inspector .lesson');
    if (!card || card.querySelector('h2')?.textContent !== 'Black King Bar') throw new Error('Single-match search did not open Black King Bar inspector');
    if (!card.querySelector('.match-english')?.textContent.includes('cooldown')) throw new Error('Item alias or coaching missing');
    const image = card.querySelector('.item-picture img');
    await image.decode();
    if (!image.naturalWidth || !image.src.startsWith('file:')) throw new Error('Item inspector is not showing bundled artwork');
    // Force the error branch without damaging an asset, then render a fresh inspector card.
    for (let attempt = 0; attempt < 3 && image.isConnected; attempt++) image.dispatchEvent(new Event('error'));
    if (!card.querySelector('.item-picture-fallback')) throw new Error('Image failure did not show a readable fallback');
    byId('search').dispatchEvent(new Event('input'));
    await document.querySelector('#item-inspector .item-picture img').decode();
    byId('tools').scrollIntoView({ block: 'start' });
  })()`);

  // Capture 3: Search + Inline Item Study Inspector (wide)
  fs.writeFileSync(path.join(outputDirectory, 'learning-items-inspector.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // Capture 4: Narrow window check on BOTH Shop Grid and Item Inspector
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 150));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Item inspector overflows narrow window');
  await page.executeJavaScript("document.getElementById('search').value=''; document.getElementById('search').dispatchEvent(new Event('input')); document.querySelector('[data-realm=\"shop\"]').click(); document.getElementById('tools').scrollIntoView({block:'start'});");
  await new Promise(resolve => setTimeout(resolve, 120));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Shop grid overflows narrow window');
  fs.writeFileSync(path.join(outputDirectory, 'learning-items-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  controlCenter.window.setSize(1060, 820);
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    byId('search').value = 'bkb'; byId('search').dispatchEvent(new Event('input'));
    byId('quick-practice').click();
    for (let i = 0; i < 100 && !document.querySelector('#answers button'); i++) await new Promise(r => setTimeout(r, 20));
    const data = await window.learningAPI.load(), active = data.study.active;
    if (!active || active.options.kind !== 'item' || active.items.length !== 1) throw new Error('Quick practice lost the searched item context');
    if (!document.querySelector('#quiz-picture img')) throw new Error('Item quiz is missing its picture cue');
    const picture = document.querySelector('#quiz-picture img'); await picture.decode();
    if (picture.alt.includes('Black King Bar')) throw new Error('Quiz image alt leaks the answer');
    const item = active.items[0];
    [...document.querySelectorAll('#answers button')].find(button => button.textContent === item.question.answer).click();
    for (let i = 0; i < 100 && byId('next').hidden; i++) await new Promise(r => setTimeout(r, 20));
    byId('next').click();
    if (byId('session-summary').hidden) throw new Error('Quick item practice did not complete');
    byId('search').value = ''; byId('kind').value = 'all'; byId('browse').click();
  })()`);
  console.log('[Learning images] PASS: ' + result.decoded + ' offline PNGs decoded, 5+6 official shop grid, neutral tiers, inspector, aliases, fallback, contextual practice, narrow layout');
}

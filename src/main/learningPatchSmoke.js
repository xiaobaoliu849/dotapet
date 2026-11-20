import fs from 'node:fs';
import path from 'node:path';
import { captureHub } from './controlCenterSmoke.js';

export async function runLearningPatchSmoke({ page, controlCenter, nativeImage, outputDirectory }) {
  // 1. Verify header Patch 7.42 pill & verified footer version
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    const pill = byId('patch-pill');
    if (!pill || pill.hidden || !pill.textContent.includes('7.42')) {
      throw new Error('Header Patch 7.42 pill missing or hidden: ' + pill?.textContent);
    }
    const source = byId('source')?.textContent || '';
    if (!source.includes('7.42') || source.includes('unverified') || source.includes('未核验')) {
      throw new Error('Footer source text does not show verified Patch 7.42: ' + source);
    }
    pill.click();
    const modal = byId('patch-modal');
    if (!modal || modal.hidden) throw new Error('Patch 7.42 modal did not open from header pill');
    const imgs = [...modal.querySelectorAll('img')];
    for (const img of imgs) img.loading = 'eager';
    await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    const newCards = modal.querySelectorAll('.patch-spotlight-card').length;
    if (newCards < 15) throw new Error('Patch modal Highlights missing spotlight cards: ' + newCards);
    for (const zhName of ['血腥投带', '瑞斯图尔的奉献', '锻星炉', '破天之矛', '镇痛之钩', '邪恶药瓶']) {
      if (!modal.textContent.includes(zhName)) throw new Error('Patch modal missing official Chinese item name: ' + zhName);
    }
    if (modal.querySelectorAll('.patch-removed-pill').length !== 7) {
      throw new Error('Patch modal Highlights missing removed abilities');
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
      throw new Error('Patch modal overflows wide window');
    }
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-modal-highlights.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // 2. Patch modal: Changed Items tab
  await page.executeJavaScript(`(async () => {
    const modal = document.getElementById('patch-modal');
    modal.querySelector('[data-patch-tab="items"]').click();
    const imgs = [...modal.querySelectorAll('img')].slice(0, 16);
    for (const img of imgs) img.loading = 'eager';
    await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    if (modal.querySelectorAll('.patch-diff-card').length < 50) {
      throw new Error('Patch modal Changed Items tab missing items');
    }
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-modal-items.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // 3. Patch modal: Changed Heroes tab + narrow overflow check
  await page.executeJavaScript(`(async () => {
    const modal = document.getElementById('patch-modal');
    modal.querySelector('[data-patch-tab="heroes"]').click();
    if (modal.querySelectorAll('.patch-hero-card').length < 100) {
      throw new Error('Patch modal Changed Heroes tab missing heroes');
    }
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-modal-heroes.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 160));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) {
    throw new Error('Patch modal overflows narrow window');
  }
  await page.executeJavaScript(`document.querySelector('#patch-modal [data-patch-tab="highlights"]').click()`);
  await new Promise(resolve => setTimeout(resolve, 80));
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-modal-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  await new Promise(resolve => setTimeout(resolve, 140));

  // 4. Jump from Patch modal -> Filter 7.42 in Shop, inspect NEW badges & hover tooltip diff
  await page.executeJavaScript(`(async () => {
    document.querySelector('#patch-modal .patch-footer-primary').click();
    if (!document.getElementById('patch-modal').hidden) throw new Error('Patch modal did not close on Shop filter jump');
    const patchBtn = document.querySelector('#item-quick-controls [data-filter="patch"]');
    if (!patchBtn || patchBtn.getAttribute('aria-pressed') !== 'true') {
      throw new Error('Shop 7.42 quick filter was not activated');
    }
    const newBadges = document.querySelectorAll('#item-list .shop-tile-new').length;
    if (newBadges !== 6) throw new Error('Expected 6 NEW badges in Shop 7.42 filter, got ' + newBadges);
    const imgs = [...document.querySelectorAll('#item-list img')];
    for (const img of imgs) img.loading = 'eager';
    await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-shop-filtered.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // 5. Hover Overwhelming Blink (item:600) in Upgrades to verify dark tooltip 7.42 diffs, then open its Study Card
  await page.executeJavaScript(`(async () => {
    const obTile = document.querySelector('.shop-icon-tile[data-item-id="item:600"]');
    if (!obTile) throw new Error('Overwhelming Blink tile missing in 7.42 shop filter');
    obTile.scrollIntoView({ block: 'center' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    obTile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    const tip = document.getElementById('shop-hover-tip');
    if (tip.hidden || !tip.querySelector('.shop-tip-diff-row')) {
      throw new Error('Shop hover tooltip did not show 7.42 numeric diff');
    }
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-hover-diff.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  await page.executeJavaScript(`(async () => {
    const obTile = document.querySelector('.shop-icon-tile[data-item-id="item:600"]');
    obTile.click();
    const modal = document.getElementById('item-modal');
    if (modal.hidden || !modal.querySelector('.patch-callout.is-changed .patch-diff-row')) {
      throw new Error('Changed item study card missing Patch 7.42 diff box');
    }
    const img = modal.querySelector('.item-picture img');
    if (img) await img.decode().catch(() => {});
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-item-changed.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // 6. Open a brand-new 7.42 Shop item (Starforge / 锻星炉 / item:1946) and verify Chinese name + playable AI audio
  await page.executeJavaScript(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const starTile = document.querySelector('.shop-icon-tile[data-item-id="item:1946"]');
    if (!starTile) throw new Error('Starforge tile missing in 7.42 shop filter');
    starTile.click();
    const modal = document.getElementById('item-modal');
    if (modal.hidden || !modal.querySelector('.patch-callout.is-new')) {
      throw new Error('New item study card missing Patch 7.42 NEW callout');
    }
    if (!modal.textContent.includes('锻星炉')) {
      throw new Error('Starforge study card missing official Chinese name 锻星炉');
    }
    const audioBtn = modal.querySelector('.recording-button');
    if (!audioBtn || audioBtn.disabled || audioBtn.dataset.audioFreshness !== 'current-verified') {
      throw new Error('New Patch 7.42 item audio button is disabled or unverified: ' + audioBtn?.textContent);
    }
    const img = modal.querySelector('.item-picture img');
    if (img) await img.decode().catch(() => {});
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-item-new.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // 7. Reset shop filter, switch to Heroes, inspect Meepo detail (New + Updated + Removed abilities)
  await page.executeJavaScript(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.querySelector('#item-quick-controls [data-filter="patch"]').click();
    document.getElementById('heroes-tab').click();
    const patchHeroPill = document.querySelector('#attr-filters .patch-filter-pill');
    if (!patchHeroPill) throw new Error('Heroes 7.42 filter pill missing');
    patchHeroPill.click();
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-heroes-wall.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  await page.executeJavaScript(`(async () => {
    const meepoTile = [...document.querySelectorAll('#hero-categories .hero-tile')].find(t => t.textContent.includes('Meepo'));
    if (!meepoTile) throw new Error('Meepo tile missing in 7.42 Heroes view');
    meepoTile.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const detail = document.getElementById('hero-detail');
    if (!detail.querySelector('.ability-bilingual-card.is-patch-new') || !detail.querySelector('.ability-removed-card')) {
      throw new Error('Meepo hero detail missing Patch 7.42 new or removed ability markers');
    }
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-hero-detail.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // 8. Click the Hero 7.42 changes filter so New + Updated + Removed abilities are cleanly shown right in view
  await page.executeJavaScript(`(async () => {
    const toggle = document.getElementById('hero-abilities-patch-toggle');
    if (!toggle || toggle.hidden) throw new Error('Hero detail 7.42 toggle missing');
    toggle.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const flingAudio = document.querySelector('#hero-abilities .ability-bilingual-card.is-patch-new .recording-button');
    if (!flingAudio || flingAudio.disabled || flingAudio.dataset.audioFreshness !== 'current-verified') {
      throw new Error('Fling new ability audio button is disabled or unverified: ' + flingAudio?.textContent);
    }
    document.querySelector('.hero-abilities-head-row').scrollIntoView({ block: 'start' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-patch-hero-changes.png'), (await captureHub(controlCenter, nativeImage)).toPNG());

  // Reset Hero filter back to clean state
  await page.executeJavaScript(`(() => {
    document.getElementById('hero-back').click();
    const patchHeroPill = document.querySelector('#attr-filters .patch-filter-pill');
    if (patchHeroPill && patchHeroPill.getAttribute('aria-pressed') === 'true') patchHeroPill.click();
    document.getElementById('browse').click();
    window.scrollTo(0, 0);
  })()`);

  console.log('[Learning patch 7.42] PASS: header pill, verified footer, modal (highlights/items/heroes/narrow), shop filter, hover diff, new & changed item cards, hero markers & detail');
}

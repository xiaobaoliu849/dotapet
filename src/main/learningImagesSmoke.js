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
    if (byId('more').hidden || byId('more').closest('[hidden]')) throw new Error('Item pagination is inaccessible');
    byId('more').click();
    if (document.querySelectorAll('#item-list .lesson').length !== 48) throw new Error('Item pagination failed');
    byId('search').value = 'bkb'; byId('search').dispatchEvent(new Event('input'));
    const card = [...document.querySelectorAll('#item-list .lesson')].find(card => card.querySelector('h2').textContent === 'Black King Bar');
    if (!card || !card.querySelector('.match-english').textContent.includes('cooldown')) throw new Error('Item alias or coaching missing');
    const image = card.querySelector('.item-picture img');
    await image.decode();
    if (!image.naturalWidth || !image.src.startsWith('file:')) throw new Error('Item card is not showing bundled artwork');
    // Force the error branch without damaging an asset, then render a fresh card.
    for (let attempt = 0; attempt < 3 && image.isConnected; attempt++) image.dispatchEvent(new Event('error'));
    if (!card.querySelector('.item-picture-fallback')) throw new Error('Image failure did not show a readable fallback');
    byId('search').dispatchEvent(new Event('input'));
    await document.querySelector('#item-list .item-picture img').decode();
    byId('tools').scrollIntoView({ block: 'start' });
    return { decoded: entries.length };
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-items.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 150));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Item coaching overflows narrow window');
  await page.executeJavaScript("document.getElementById('tools').scrollIntoView({block:'start'})");
  fs.writeFileSync(path.join(outputDirectory, 'learning-items-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
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
  console.log('[Learning images] PASS: ' + result.decoded + ' offline PNGs decoded, item aliases, pagination, fallback, contextual practice, narrow layout');
}

import fs from 'node:fs';
import path from 'node:path';
import { captureHub, pageLoaded } from './controlCenterSmoke.js';

export async function runStarterPathSmoke({ page, controlCenter, nativeImage, outputDirectory }) {
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    byId('starter-tab').click();
    if (document.querySelectorAll('.starter-unit').length !== 2 || document.querySelectorAll('.starter-preview').length !== 10) throw new Error('Starter units are incomplete');
    const images = [...document.querySelectorAll('.starter-preview img')];
    for (const image of images) image.loading = 'eager';
    await Promise.all(images.map(image => image.decode()));
    byId('starter-browser').scrollIntoView({block: 'start'});
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-starter.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    document.querySelector('[data-starter-unit="starter-lane"]').click();
    for (let i = 0; i < 100 && byId('guided-lesson').hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (byId('guided-lesson').hidden || !byId('practice').hidden) throw new Error('Starter path skipped learning');
    await document.querySelector('#guide-card img').decode();
    if (!document.querySelector('#guide-card .guide-meaning') || !document.querySelector('#guide-card .match-english')) throw new Error('Starter card lacks a meaning or sentence');
    document.querySelector('#guide-card .actions button:last-child').click();
    for (let i = 0; i < 100; i++) {
      if ((await window.learningAPI.load()).progress['item:44']?.saved) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!(await window.learningAPI.load()).progress['item:44']?.saved) throw new Error('Learning-card bookmark was not saved');
    for (let index = 0; index < 2; index++) {
      byId('guide-next').click();
      for (let i = 0; i < 100; i++) {
        if ((await window.learningAPI.load()).study.active.guideIndex === index + 1 && !byId('guide-next').disabled) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    const state = await window.learningAPI.load();
    if (state.study.active.guideIndex !== 2 || state.progress['item:44'].attempts) throw new Error('Reading changed quiz progress');
    byId('guided-lesson').scrollIntoView({block:'start'});
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-guide.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  page.reload(); await pageLoaded(page);
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    for (let i = 0; i < 100 && byId('total').textContent === '—'; i++) await new Promise(resolve => setTimeout(resolve, 20));
    byId('quick-practice').click();
    const state = await window.learningAPI.load();
    if (state.study.active.guideIndex !== 2 || byId('guided-lesson').hidden || !byId('guide-card').textContent.includes('Magic Stick')) throw new Error('Learning cards did not resume after reload');
    for (let index = 2; index < 5; index++) {
      byId('guide-next').click();
      for (let i = 0; i < 100; i++) {
        if ((await window.learningAPI.load()).study.active.guideIndex === index + 1 && !byId('guide-next').disabled) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    if (byId('practice').hidden || !byId('guided-lesson').hidden) throw new Error('Learning did not lead to recall');
    const active = (await window.learningAPI.load()).study.active;
    if (active.options.direction !== 'zh' || active.options.scope !== 'starter-lane') throw new Error('Starter recall lost its English direction or collection');
    for (const item of active.items) {
      [...document.querySelectorAll('#answers button')].find(button => button.textContent === item.question.answer).click();
      for (let i = 0; i < 100 && byId('next').hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (byId('next').hidden) throw new Error('Starter answer was not saved');
      byId('next').click();
    }
    if (byId('session-summary').hidden) throw new Error('Starter lesson has no summary');
    const final = await window.learningAPI.load();
    if (final.study.active.answers.filter(answer => answer.correct).length !== 5 || !final.progress['item:44'].saved) throw new Error('Starter results or bookmarks were lost');
    byId('starter-tab').click();
    if (!document.querySelector('[data-starter-unit="starter-lane"]').disabled) throw new Error('Starter path pulled future reviews forward');
  })()`);
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.executeJavaScript("document.getElementById('starter-browser').scrollIntoView({block:'start'})");
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Starter path overflows a narrow window');
  fs.writeFileSync(path.join(outputDirectory, 'learning-starter-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  await page.executeJavaScript(`(async () => {
    document.getElementById('quick-practice').click();
    for (let i = 0; i < 100; i++) {
      if ((await window.learningAPI.load()).study.active.options.scope === 'starter-team') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if ((await window.learningAPI.load()).study.active.options.scope !== 'starter-team') throw new Error('Starter action did not advance to the next ready unit');
  })()`);
  console.log('[Starter path] PASS: ten local pictures, learn-before-recall, saved cards, reload recovery, focused English quiz, review scheduling, next-unit routing, narrow layout');
}

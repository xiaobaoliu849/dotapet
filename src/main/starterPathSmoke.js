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
    const title = byId('guide-card-title');
    if (document.activeElement !== title || title.textContent !== 'Tango' || !title.getAttribute('aria-describedby').includes('guide-counter')) {
      throw new Error('First starter card did not focus its item title and describe its position');
    }
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
    const currentTitle = byId('guide-card-title');
    if (document.activeElement !== currentTitle || currentTitle.textContent !== 'Magic Stick' || !byId('guide-progress').getAttribute('aria-valuetext').includes('2')) {
      throw new Error('Advancing did not focus the new card and describe completed progress');
    }
    byId('guided-lesson').scrollIntoView({block:'start'});
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-guide.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  // Block the atomic write in this isolated smoke profile. The open card should show the failure and remain usable.
  const stateTempPath = path.join(outputDirectory, 'learning-state.json.tmp');
  fs.mkdirSync(stateTempPath);
  try {
    await page.executeJavaScript(`(async () => {
      const byId = id => document.getElementById(id);
      byId('guide-end').click();
      for (let i = 0; i < 100 && !byId('guide-status').textContent; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (byId('guided-lesson').hidden || !byId('guide-status').textContent) throw new Error('Guided lesson write failure had no visible feedback');
      byId('guide-next').focus();
      byId('guide-next').click();
      for (let i = 0; i < 100 && byId('guide-next').disabled; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (byId('guide-next').disabled || !byId('guide-status').textContent.includes('learning-state.json.tmp')) throw new Error('Next card did not offer visible retry feedback');
      if (document.activeElement !== byId('guide-next')) throw new Error('Keyboard focus did not return to the next-card retry');
      if ((await window.learningAPI.load()).study.active.guideIndex !== 2) throw new Error('Failed write changed the learning-card checkpoint');
    })()`);
  } finally {
    fs.rmdirSync(stateTempPath);
  }
  page.reload(); await pageLoaded(page);
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    for (let i = 0; i < 100 && byId('total').textContent === '—'; i++) await new Promise(resolve => setTimeout(resolve, 20));
    byId('quick-practice').click();
    const state = await window.learningAPI.load();
    if (state.study.active.guideIndex !== 2 || byId('guided-lesson').hidden || !byId('guide-card').textContent.includes('Magic Stick')) throw new Error('Learning cards did not resume after reload');
    if (document.activeElement !== byId('guide-card-title')) throw new Error('Resumed card did not receive keyboard focus');
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
    // Answer the first item (Tango) and verify Play + Next remain visible above the fold with zero scrolling.
    [...document.querySelectorAll('#answers button')].find(button => button.textContent === active.items[0].question.answer).click();
    for (let i = 0; i < 100 && byId('next').hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (byId('next').hidden) throw new Error('Starter answer was not saved');
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const nextRect = byId('next').getBoundingClientRect();
    const audioRect = document.querySelector('#quiz-audio button')?.getBoundingClientRect();
    if (!audioRect || nextRect.bottom > window.innerHeight || audioRect.bottom > window.innerHeight) {
      throw new Error('Quiz feedback actions pushed below fold: next=' + Math.round(nextRect.bottom) + ', audio=' + Math.round(audioRect?.bottom || 0) + ', vh=' + window.innerHeight);
    }
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-quiz-feedback.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    const active = (await window.learningAPI.load()).study.active;
    byId('next').click();
    for (const item of active.items.slice(1)) {
      [...document.querySelectorAll('#answers button')].find(button => button.textContent === item.question.answer).click();
      for (let i = 0; i < 100 && byId('next').hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (byId('next').hidden) throw new Error('Starter answer was not saved');
      byId('next').click();
    }
    if (byId('session-summary').hidden) throw new Error('Starter lesson has no summary');
    const final = await window.learningAPI.load();
    if (final.study.active.answers.filter(answer => answer.correct).length !== 5 || !final.progress['item:44'].saved) throw new Error('Starter results or bookmarks were lost');
  })()`);
  fs.mkdirSync(stateTempPath);
  try {
    await page.executeJavaScript(`(async () => {
      const byId = id => document.getElementById(id);
      const nextUnit = byId('start-next-unit');
      const previous = (await window.learningAPI.load()).study.active;
      if (nextUnit.hidden || nextUnit.disabled) throw new Error('Summary offered no direct next starter lesson');
      nextUnit.click();
      for (let i = 0; i < 100 && nextUnit.disabled; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (nextUnit.disabled || byId('session-summary').hidden || !byId('summary-status').textContent.includes('learning-state.json.tmp')) throw new Error('Next lesson did not offer visible retry feedback');
      if ((await window.learningAPI.load()).study.active.id !== previous.id) throw new Error('Failed next lesson start discarded the summary');
    })()`);
  } finally {
    fs.rmdirSync(stateTempPath);
  }
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    // Planning another session after finishing starter-lane must auto-advance away from the exhausted unit.
    byId('new-session').click();
    if (byId('session-scope').value !== 'starter-team') throw new Error('Plan another session stayed stuck on exhausted scope: ' + byId('session-scope').value);
    if (byId('study-status').dataset.state !== 'ready') throw new Error('Next ready starter scope did not report ready preview');
    // Manually selecting the exhausted unit must explain why and offer a 1-click switch button.
    byId('session-scope').value = 'starter-lane';
    byId('session-scope').dispatchEvent(new Event('change'));
    if (byId('study-status').dataset.state !== 'empty' || byId('study-switch-scope').hidden) throw new Error('Exhausted scope did not show live empty guidance + switch button');
    // Clicking the 1-click switch button must recover immediately to the ready collection.
    byId('study-switch-scope').click();
    if (byId('session-scope').value !== 'starter-team' || byId('study-status').dataset.state !== 'ready') throw new Error('1-click scope switch button did not recover');
    // Selecting "all" must immediately clear empty warnings and report ready lessons.
    byId('session-scope').value = 'all';
    byId('session-scope').dispatchEvent(new Event('change'));
    if (byId('study-status').dataset.state !== 'ready' || !byId('study-switch-scope').hidden) throw new Error('Switching scope to all did not update live preview');
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
  console.log('[Starter path] PASS: ten local pictures, learn-before-recall, saved cards, reload recovery, keyboard card focus and retry, focused English quiz, visible write errors, next-unit routing, narrow layout');
}

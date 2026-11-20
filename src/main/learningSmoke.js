import fs from 'node:fs';
import path from 'node:path';
import { navigateHub, pageLoaded, captureHub } from './controlCenterSmoke.js';

export async function runLearningSmoke({ controlCenter, nativeImage, outputDirectory, mainWindow }) {
  await navigateHub(controlCenter, 'learning');
  const page = controlCenter.contents('learning'); await pageLoaded(page);
  const { runLearningImagesSmoke } = await import('./learningImagesSmoke.js');
  await runLearningImagesSmoke({ page, controlCenter, nativeImage, outputDirectory });
  const { runLearningPatchSmoke } = await import('./learningPatchSmoke.js');
  await runLearningPatchSmoke({ page, controlCenter, nativeImage, outputDirectory });
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    for (let i=0;i<100 && !document.querySelector('#lessons .lesson');i++) await new Promise(r=>setTimeout(r,30));
    if (!document.querySelector('#lessons .lesson')) throw new Error('Learning page did not render: '+byId('message').textContent);
    byId('search').value = 'blink'; byId('search').dispatchEvent(new Event('input'));
    if (!document.querySelector('#lessons .lesson h2').textContent.toLowerCase().includes('blink')) throw new Error('Learning search failed');
    document.querySelector('#lessons .actions button:last-child').click();
    for(let i=0;i<100;i++) { if(Number(byId('saved-count').textContent)>0) break; await new Promise(r=>setTimeout(r,20)); }
    if (!Number(byId('saved-count').textContent)) throw new Error('Bookmark did not persist');
    byId('saved').click(); if (!document.querySelector('#lessons .lesson')) throw new Error('Saved library empty');
    byId('search').value=''; byId('search').dispatchEvent(new Event('input'));
    byId('practice-saved').click();
    if(byId('session-scope').value!=='saved') throw new Error('Saved practice scope was lost');
    byId('start-session').click();
    for(let i=0;i<100 && !document.querySelector('#answers button');i++) await new Promise(r=>setTimeout(r,20));
    if (document.querySelectorAll('#answers button').length!==4) throw new Error('Quiz missing options');
    const data=await window.learningAPI.load(); const active=data.study.active;
    if(active.items.length!==1 || !data.progress[active.items[0].lesson.id].saved) throw new Error('Saved-only session included other words');
    [...document.querySelectorAll('#answers button')].find(b=>b.textContent===active.items[0].question.answer).click();
    for(let i=0;i<100 && byId('next').hidden;i++) await new Promise(r=>setTimeout(r,20));
    if(byId('next').hidden) throw new Error('Quiz answer failed');
    const saved=await window.learningAPI.load();
    if(!Object.values(saved.progress).some(r=>r.correct===1)) throw new Error('Quiz result not persisted');
    byId('next').click();
    if(byId('session-summary').hidden || !saved.study.active.completedAt) throw new Error('Session did not finish');
    byId('session-scope').value='all'; byId('session-size').value='5'; byId('kind').value='hero';
    byId('new-session').click();
    if (byId('study-setup').hidden || byId('tools').hidden || byId('start-session').hidden) throw new Error('Next-session planning controls are inaccessible');
    byId('start-session').click();
    for(let i=0;i<100;i++) {
      const state=await window.learningAPI.load();
      if(state.study.active.id!==active.id && document.querySelector('#answers button')) break;
      await new Promise(r=>setTimeout(r,20));
    }
    const state=await window.learningAPI.load();
    if(state.study.active.items.length!==5) throw new Error('Daily session length failed');
    const first=state.study.active.items[0];
    [...document.querySelectorAll('#answers button')].find(b=>b.textContent!==first.question.answer).click();
    for(let i=0;i<100 && byId('next').hidden;i++) await new Promise(r=>setTimeout(r,20));
    if(byId('next').hidden) throw new Error('Mistake not saved');
  })()`);
  // Reload the real document to verify automatic recovery of a partially completed daily session.
  page.reload(); await pageLoaded(page);
  await page.executeJavaScript(`(async () => {
    const byId=id=>document.getElementById(id);
    for(let i=0;i<100 && byId('total').textContent==='—';i++) await new Promise(r=>setTimeout(r,20));
    byId('quiz').click();
    const loaded=await window.learningAPI.load();
    if(loaded.study.active.answers.length!==1 || document.querySelectorAll('#answers button').length!==4) throw new Error('Daily session did not resume after reload');
    if(!byId('kind').disabled || byId('session-size').value!=='5') throw new Error('Active session settings changed');
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-session.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  await page.executeJavaScript(`(async () => {
    const byId=id=>document.getElementById(id), active=(await window.learningAPI.load()).study.active;
    for(let index=1;index<active.items.length;index++) {
      const answer=active.items[index].question.answer;
      [...document.querySelectorAll('#answers button')].find(button=>button.textContent===answer).click();
      for(let i=0;i<100 && byId('next').hidden;i++) await new Promise(r=>setTimeout(r,20));
      if(byId('next').hidden) throw new Error('Daily answer did not save');
      byId('next').click();
    }
    if(byId('session-summary').hidden || document.querySelectorAll('#session-mistakes .review-word').length!==1) throw new Error('Mistake summary failed');
    const final=await window.learningAPI.load();
    if(final.study.history.length!==3 || final.study.history[2].correct!==4) throw new Error('Daily history failed');
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-summary.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 150));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Daily practice overflows narrow window');
  await page.executeJavaScript("document.getElementById('session-summary').scrollIntoView({block:'start'})");
  fs.writeFileSync(path.join(outputDirectory, 'learning-summary-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  await page.executeJavaScript("document.getElementById('browse').click()");
  const { runLearningAudioSmoke } = await import('./learningAudioSmoke.js');
  await runLearningAudioSmoke(page);
  await navigateHub(controlCenter, 'services');
  if (!await page.executeJavaScript('window.__learningSmokeAudio.paused')) throw new Error('Audio continued after leaving learning');
  await navigateHub(controlCenter, 'learning');
  await page.executeJavaScript("document.getElementById('search').value=''; document.getElementById('kind').value='all'; document.getElementById('search').dispatchEvent(new Event('input')); window.scrollTo(0,0)");
  if (mainWindow.isDestroyed()) throw new Error('Learning page closed desktop companion');
  fs.writeFileSync(path.join(outputDirectory, 'learning-wide.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  // Verify every tab reveals its primary content above the fold at scrollY = 0 (no bloated repeated header).
  for (const [tabId, selector, maxTop, shot] of [
    ['starter-tab', '.starter-unit', 340, 'learning-tab-starter.png'],
    ['heroes-tab', '#hero-categories .hero-tile', 360, 'learning-tab-heroes.png'],
    ['items-tab', '#item-list .shop-column', 420, 'learning-tab-items.png'],
    ['phrases-tab', '#spoken-list .spoken-card', 360, 'learning-tab-phrases.png'],
    ['saved', '#lessons .lesson', 320, 'learning-tab-saved.png'],
  ]) {
    const top = await page.executeJavaScript(`(async () => {
      document.getElementById(${JSON.stringify(tabId)}).click();
      window.scrollTo(0, 0);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Tab ${tabId} missing content: ${selector}');
      return Math.round(el.getBoundingClientRect().top);
    })()`);
    if (top > maxTop) throw new Error(`Tab ${tabId} pushed main content too far down: top=${top}px > ${maxTop}px`);
    fs.writeFileSync(path.join(outputDirectory, shot), (await captureHub(controlCenter, nativeImage)).toPNG());
  }
  await page.executeJavaScript(`(async () => {
    document.getElementById('quiz').click();
    if (!document.getElementById('new-session').hidden) document.getElementById('new-session').click();
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (document.getElementById('progress-overview').hidden) throw new Error('Practice setup did not show progress overview');
    const setupTop = Math.round(document.getElementById('study-setup').getBoundingClientRect().top);
    const statsTop = Math.round(document.querySelector('#progress-overview .stats').getBoundingClientRect().top);
    if (setupTop > 260 || statsTop > 520) throw new Error('Practice overview pushed too far down: setup=' + setupTop + ', stats=' + statsTop);
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-tab-practice.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  await page.executeJavaScript("document.getElementById('browse').click(); window.scrollTo(0, 0);");
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 200));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Learning page overflows narrow window');
  fs.writeFileSync(path.join(outputDirectory, 'learning-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  const { runStarterPathSmoke } = await import('./starterPathSmoke.js');
  await runStarterPathSmoke({ page, controlCenter, nativeImage, outputDirectory });

  // End-to-end verification of Patch 7.42 -> item detail -> focused practice, re-practice after completion,
  // switching from unanswered drills without cross-tab search pollution, pause/resume, and honest mastery display.
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    const wait = async (pred, label) => {
      for (let i = 0; i < 120; i++) {
        if (await pred()) return;
        await new Promise(r => setTimeout(r, 20));
      }
      throw new Error('Timed out waiting for: ' + label);
    };

    // 1. starter-team is currently active; open Patch 7.42 -> Sabatons of Mordiggian -> Practice this item.
    byId('patch-pill').click();
    await wait(() => !byId('patch-modal').hidden, 'patch modal open');
    const sabatonsCard = [...document.querySelectorAll('#patch-modal .patch-spotlight-card')]
      .find(el => el.textContent.includes('Sabatons of Mordiggian'));
    if (!sabatonsCard) throw new Error('Sabatons of Mordiggian missing from Patch 7.42 modal');
    sabatonsCard.click();
    await wait(() => !byId('item-modal').hidden && document.querySelector('#item-modal .item-practice-btn'), 'Sabatons modal');
    if (!document.querySelector('#item-modal .item-patch-back-btn')) throw new Error('Back to Patch 7.42 chip missing in item modal');

    document.querySelector('#item-modal .item-practice-btn').click();
    await wait(() => !byId('practice').hidden && document.querySelectorAll('#answers button').length === 4, 'Sabatons focused quiz');
    let snap = await window.learningAPI.load();
    if (snap.study.active?.options?.scope !== 'focus' || snap.study.active.items[0]?.lesson.id !== 'item:1953') {
      throw new Error('Focused practice did not launch exact Sabatons of Mordiggian item');
    }
    if (snap.study.paused?.options?.scope !== 'starter-team') {
      throw new Error('In-progress starter session was not preserved in paused state');
    }
    if (byId('search').value !== '') throw new Error('Focused item practice polluted #search: ' + byId('search').value);

    // Answer Sabatons correctly and check contextual summary actions.
    [...document.querySelectorAll('#answers button')].find(b => b.textContent === snap.study.active.items[0].question.answer).click();
    await wait(() => !byId('next').hidden, 'Sabatons feedback');
    byId('next').click();
    await wait(() => !byId('session-summary').hidden, 'Sabatons summary');
    if (byId('summary-focus-card').hidden) throw new Error('Focused summary card missing');
    const extraBtns = [...document.querySelectorAll('#summary-extra-actions button')];
    if (extraBtns.length < 4) throw new Error('Expected reverse, back-to-item, back-to-patch, and resume-paused buttons, got ' + extraBtns.length);

    // 2. Return to Patch 7.42 -> click Sabatons AGAIN -> Practice this item AGAIN even though due is tomorrow.
    extraBtns[2].click();
    await wait(() => !byId('patch-modal').hidden, 'reopen Patch 7.42 from summary');
    const sabatonsCard2 = [...document.querySelectorAll('#patch-modal .patch-spotlight-card')]
      .find(el => el.textContent.includes('Sabatons of Mordiggian'));
    sabatonsCard2.click();
    await wait(() => !byId('item-modal').hidden, 'Sabatons modal second time');
    document.querySelector('#item-modal .item-practice-btn').click();
    await wait(() => !byId('practice').hidden && document.querySelectorAll('#answers button').length === 4, 'Sabatons re-practice');
    snap = await window.learningAPI.load();
    if (snap.study.active?.items[0]?.lesson.id !== 'item:1953' || !snap.study.active.items[0].earlyReview) {
      throw new Error('Re-practicing already-scheduled Sabatons did not launch earlyReview focus quiz');
    }
    [...document.querySelectorAll('#answers button')].find(b => b.textContent === snap.study.active.items[0].question.answer).click();
    await wait(() => !byId('next').hidden, 'Sabatons early feedback');
    byId('next').click();
    await wait(() => !byId('session-summary').hidden, 'Sabatons early summary');
    snap = await window.learningAPI.load();
    if (snap.progress['item:1953']?.box !== 1 || snap.progress['item:1953']?.attempts !== 2) {
      throw new Error('Early voluntary drill inflated SRS box or dropped attempt count');
    }

    // 3. Practice reverse direction from summary, then click Back (#quiz-end) to return to item modal.
    const prevDir = snap.study.active.options.direction;
    const expectedReverseDir = prevDir === 'en' ? 'zh' : 'en';
    const expectedReversePrompt = expectedReverseDir === 'zh' ? '莫尔迪基安的护足' : 'Sabatons of Mordiggian';
    document.querySelector('#summary-extra-actions .is-primary').click();
    await wait(() => !byId('practice').hidden && byId('question').textContent === expectedReversePrompt, 'Sabatons reverse direction quiz');
    snap = await window.learningAPI.load();
    if (snap.study.active?.options?.direction !== expectedReverseDir) {
      throw new Error('Reverse practice did not flip direction to ' + expectedReverseDir);
    }
    byId('quiz-end').click();
    await wait(() => !byId('item-modal').hidden && document.querySelector('#item-modal h2')?.textContent === 'Sabatons of Mordiggian', 'Back returned to Sabatons modal');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    // 4. Colliding item name (Cloak vs Cloak of Flames / Trickster Cloak), leave unanswered, switch tabs cleanly, then switch to Bloodslinger.
    const cloakTile = document.querySelector('.shop-icon-tile[data-item-id="item:31"]');
    if (!cloakTile) throw new Error('Cloak tile missing from Shop Grid');
    cloakTile.click();
    await wait(() => !byId('item-modal').hidden, 'Cloak modal');
    document.querySelector('#item-modal .item-practice-btn').click();
    await wait(() => !byId('practice').hidden, 'Cloak quiz');
    snap = await window.learningAPI.load();
    if (snap.study.active?.items[0]?.lesson.id !== 'item:31') {
      throw new Error('Cloak collided with another item: ' + snap.study.active?.items[0]?.lesson.id);
    }

    // Switch to Heroes without answering Cloak: Heroes must not be poisoned by search.
    byId('heroes-tab').click();
    if (byId('search').value !== '' || !document.querySelector('#hero-categories .hero-tile')) {
      throw new Error('Switching to Heroes left stale search or empty hero wall');
    }

    // Open Bloodslinger from Patch 7.42 while Cloak is still unanswered: must switch cleanly to Bloodslinger!
    byId('patch-pill').click();
    await wait(() => !byId('patch-modal').hidden, 'patch modal for Bloodslinger');
    const bloodCard = [...document.querySelectorAll('#patch-modal .patch-spotlight-card')]
      .find(el => el.querySelector('strong')?.textContent === 'Bloodslinger');
    if (!bloodCard) throw new Error('Bloodslinger missing from Patch 7.42 modal');
    bloodCard.click();
    await wait(() => !byId('item-modal').hidden, 'Bloodslinger modal');
    document.querySelector('#item-modal .item-practice-btn').click();
    await wait(async () => (await window.learningAPI.load()).study.active?.items[0]?.lesson.id === 'item:1942', 'Bloodslinger replaced unanswered Cloak');
    byId('quiz-end').click();
    await wait(() => !byId('item-modal').hidden, 'Returned to Bloodslinger modal');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    // 5. Untranslated archive item (Stone of Recall) must disable its Practice button cleanly.
    document.querySelector('[data-realm="archive"]').click();
    await wait(() => document.querySelector('[data-item-id="item:1949"]'), 'Stone of Recall tile in Archive');
    document.querySelector('[data-item-id="item:1949"]').click();
    await wait(() => !byId('item-modal').hidden, 'Stone of Recall modal');
    if (!document.querySelector('#item-modal .item-practice-btn')?.disabled) {
      throw new Error('Unquizzable archive item Practice button was not disabled');
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.querySelector('[data-realm="shop"]').click();

    // 6. Practice tab shows paused starter banner + honest Hero mastery (0 mastered), resume + end session cleanly.
    byId('quiz').click();
    await wait(() => !byId('study-setup').hidden && !byId('paused-banner').hidden, 'Practice setup with paused banner');
    const heroMastery = document.querySelector('[data-mastery-key="hero"] .mastery-count')?.textContent || '';
    if (!heroMastery.startsWith('0/')) throw new Error('Heroes mastery inflated with <3 streak: ' + heroMastery);
    byId('resume-paused').click();
    await wait(() => !byId('guided-lesson').hidden, 'Resumed paused starter-team session');
    byId('guide-end').click();
    await wait(() => !byId('study-setup').hidden && byId('paused-banner').hidden, 'Ended session back to clean Practice setup');
  })()`);
  console.log('[Learning] PASS: search, saved-only practice, daily session, reload recovery, mistakes, history, focused Patch 7.42 item practice/re-practice, pause/resume, honest mastery, desktop companion, responsive layout');
}

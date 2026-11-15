import fs from 'node:fs';
import path from 'node:path';
import { navigateHub, pageLoaded, captureHub } from './controlCenterSmoke.js';

export async function runLearningSmoke({ controlCenter, nativeImage, outputDirectory, mainWindow }) {
  await navigateHub(controlCenter, 'learning');
  const page = controlCenter.contents('learning'); await pageLoaded(page);
  await page.executeJavaScript(`(async () => {
    const byId = id => document.getElementById(id);
    for (let i=0;i<100 && !document.querySelector('.lesson');i++) await new Promise(r=>setTimeout(r,30));
    if (!document.querySelector('.lesson')) throw new Error('Learning page did not render: '+byId('message').textContent);
    byId('search').value = 'blink'; byId('search').dispatchEvent(new Event('input'));
    if (!document.querySelector('.lesson h2').textContent.toLowerCase().includes('blink')) throw new Error('Learning search failed');
    document.querySelector('.actions button:last-child').click();
    for(let i=0;i<100;i++) { if(Number(byId('saved-count').textContent)>0) break; await new Promise(r=>setTimeout(r,20)); }
    if (!Number(byId('saved-count').textContent)) throw new Error('Bookmark did not persist');
    byId('saved').click(); if (!document.querySelector('.lesson')) throw new Error('Saved library empty');
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
    for(let i=0;i<100 && !document.querySelector('.lesson');i++) await new Promise(r=>setTimeout(r,20));
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
    if(final.study.history.length!==2 || final.study.history[1].correct!==4) throw new Error('Daily history failed');
  })()`);
  fs.writeFileSync(path.join(outputDirectory, 'learning-summary.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 150));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Daily practice overflows narrow window');
  await page.executeJavaScript("document.getElementById('session-summary').scrollIntoView({block:'start'})");
  fs.writeFileSync(path.join(outputDirectory, 'learning-summary-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  await page.executeJavaScript("document.getElementById('browse').click()");
  if (mainWindow.isDestroyed()) throw new Error('Learning page closed desktop companion');
  fs.writeFileSync(path.join(outputDirectory, 'learning-wide.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 200));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Learning page overflows narrow window');
  fs.writeFileSync(path.join(outputDirectory, 'learning-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  console.log('[Learning] PASS: search, saved-only practice, daily session, reload recovery, mistakes, history, desktop companion, responsive layout');
}

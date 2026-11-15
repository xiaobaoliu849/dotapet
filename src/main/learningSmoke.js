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
    byId('quiz').click(); if (document.querySelectorAll('#answers button').length!==4) throw new Error('Quiz missing options');
    const data=await window.learningAPI.load(); const prompt=byId('question').textContent;
    const answer=data.catalog.lessons.find(r=>r.en===prompt).zh;
    [...document.querySelectorAll('#answers button')].find(b=>b.textContent===answer).click();
    for(let i=0;i<100 && byId('next').hidden;i++) await new Promise(r=>setTimeout(r,20));
    if(byId('next').hidden) throw new Error('Quiz answer failed');
    const saved=await window.learningAPI.load();
    if(!Object.values(saved.progress).some(r=>r.correct===1)) throw new Error('Quiz result not persisted');
    byId('browse').click();
  })()`);
  if (mainWindow.isDestroyed()) throw new Error('Learning page closed desktop companion');
  fs.writeFileSync(path.join(outputDirectory, 'learning-wide.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(620, 730);
  await new Promise(resolve => setTimeout(resolve, 200));
  if (await page.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Learning page overflows narrow window');
  fs.writeFileSync(path.join(outputDirectory, 'learning-narrow.png'), (await captureHub(controlCenter, nativeImage)).toPNG());
  controlCenter.window.setSize(1060, 820);
  console.log('[Learning] PASS: search, bookmarks, quiz, persistence, desktop companion, responsive layout');
}

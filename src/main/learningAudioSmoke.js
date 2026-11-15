/** Exercise real Chromium MP3 decoding and the page's actual play/stop controls, muted. */
export async function runLearningAudioSmoke(page) {
  await page.executeJavaScript(`(async () => {
    const api = window.learningAPI, data = await api.load();
    const OriginalAudio = window.Audio;
    window.Audio = function(...args) { const audio = new OriginalAudio(...args); audio.volume = 0; window.__learningSmokeAudio = audio; return audio; };
    window.Audio.prototype = OriginalAudio.prototype;
    for (const kind of ['hero', 'ability', 'item', 'phrase']) {
      const lesson = data.catalog.lessons.find(lesson => lesson.kind === kind && data.audio.entries[lesson.id]);
      const entry = data.audio.entries[lesson.id], audio = new Audio();
      audio.src = new URL('assets/learning-audio/' + entry.file, location.href).href;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('MP3 decode timed out: ' + kind)), 4000);
        audio.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
        audio.onerror = () => { clearTimeout(timeout); reject(new Error('MP3 decode failed: ' + kind)); };
        audio.load();
      });
      if (!(audio.duration > 0)) throw new Error('Empty MP3 duration: ' + kind);
      audio.removeAttribute('src'); audio.load();
    }
    const byId = id => document.getElementById(id);
    byId('kind').value='ability'; byId('search').value='Mana Break'; byId('search').dispatchEvent(new Event('input'));
    const button = document.querySelector('#lessons .recording-button:not(:disabled)');
    if(!button) throw new Error('Recorded ability button missing');
    button.click();
    for(let i=0;i<100 && button.dataset.audioState!=='playing';i++) await new Promise(resolve=>setTimeout(resolve,20));
    if(button.dataset.audioState!=='playing') throw new Error('MP3 play button failed');
    if(!window.__learningSmokeAudio.src.includes('/assets/learning-audio/ability/')) throw new Error('Playback did not use bundled MP3: ' + window.__learningSmokeAudio.src);
    if(window.__learningSmokeAudio.playbackRate!==1) throw new Error('Recording speed was changed');
    button.click(); if(!window.__learningSmokeAudio.paused) throw new Error('Stop did not pause MP3');
    button.click();
    for(let i=0;i<100 && button.dataset.audioState!=='playing';i++) await new Promise(resolve=>setTimeout(resolve,20));
  })()`);
}

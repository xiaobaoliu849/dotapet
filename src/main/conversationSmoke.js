import fs from 'node:fs';
import path from 'node:path';

/** Drive the real renderer via production IPC; no cloud account is contacted. */
export async function runConversationSmoke({ mainWindow, outputDirectory }) {
  const page = mainWindow.webContents;
  const before = mainWindow.getBounds();
  // Hidden smoke windows do not advance CSS transitions reliably. Check their
  // final layout deterministically; production retains the movement animation.
  const style = await page.insertCSS('* { transition: none !important; animation: none !important; }');
  const run = source => page.executeJavaScript(`(async () => {
    const get = id => document.getElementById(id);
    const wait = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const rect = id => { const r = get(id).getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
    ${source}
  })()`);
  const send = (channel, data) => page.send(channel, data);
  const complete = () => send('voice:complete', { hadAudio: true });
  const geometry = async () => {
    // Force a compositor frame so ResizeObserver runs even for this hidden
    // window after toggling the GSI bar or a compact root transform.
    await page.capturePage();
    return run(`
    await wait();
    const pet = rect('pet-wrapper'), panel = rect('transcript-panel'), header = rect('hud-top-bar');
    const dock = document.querySelector('.hud-bottom-dock').getBoundingClientRect();
    const scale = get('companion-root').getBoundingClientRect().width / 340;
    check(header.bottom < pet.top, 'Conversation character overlaps toolbar');
    check(pet.bottom < panel.top, 'Conversation transcript overlaps character: ' + JSON.stringify({pet, panel, classes:document.body.className, offset:get('companion-root').style.cssText}));
    check(panel.bottom < dock.top, 'Conversation transcript overlaps controls');
    check(get('transcript-list').clientHeight > 80, 'Conversation reading area is too small');
    check(panel.height > 0 && panel.bottom <= innerHeight, 'Transcript clipped outside window');
    check(Math.abs(pet.width / scale - 180 * .68) < 1, 'Conversation character has wrong scale');
    check(getComputedStyle(document.querySelector('.hud-bottom-dock')).opacity === '1', 'Conversation controls faded away');
    if (!get('hud-toast').classList.contains('hidden')) {
      const toast = rect('hud-toast');
      check(toast.right < pet.left && toast.bottom < panel.top, 'Transient notice obscures character or transcript');
    }
    return { pet, panel };
  `);
  };
  try {
    await run(`get('btn-close-transcript').click(); get('btn-close-bubble').click();
      window.__conversationRest = rect('pet-wrapper');`);
    send('voice:status', { status: 'connecting', provider: 'Smoke' });
    await run(`await wait(); check(get('transcript-panel').classList.contains('hidden'), 'Connecting prematurely opens transcript');`);
    send('voice:status', { status: 'connected', provider: 'Smoke' });
    await run(`await wait(); check(!get('transcript-panel').classList.contains('hidden'), 'Connected session has no transcript');
      check(get('btn-transcript').getAttribute('aria-expanded') === 'true', 'Transcript toggle is not expanded');`);
    const empty = await geometry();

    for (let i = 0; i < 18; i++) {
      send('voice:user-final', `第 ${i + 1} 条：现在应该推进中路还是先打肉山？`);
      send('voice:text-delta', { fullText: `第 ${i + 1} 条回复：先确认对方位置，再和队友一起行动。Keep your team together and check the map.` });
      complete();
    }
    const filled = await geometry();
    if (empty.panel.height !== filled.panel.height) throw new Error('Streaming changed transcript height');
    await run(`
      const list = get('transcript-list');
      check(list.scrollHeight > list.clientHeight, 'History did not overflow');
      list.scrollTop = 350; list.dispatchEvent(new Event('scroll')); await wait();
      window.__historyPosition = list.scrollTop;
    `);
    send('voice:user-final', '新的消息不应该抢走历史滚动位置');
    send('voice:text-delta', { fullText: 'History stays where you left it.' });
    complete();
    await run(`await wait(); check(Math.abs(get('transcript-list').scrollTop - window.__historyPosition) < 2, 'New reply stole history viewport');
      check(get('transcript-jump-pill').classList.contains('visible'), 'History has no return-to-latest control');
      const list = get('transcript-list');
      window.__readingAnchor = [...list.querySelectorAll('.transcript-msg')].find(msg => msg.getBoundingClientRect().bottom > list.getBoundingClientRect().top);
      window.__readingOffset = window.__readingAnchor.offsetTop - list.scrollTop;
      get('transcript-list').focus(); get('btn-close-transcript').click();
      check(document.activeElement === get('btn-transcript'), 'Closing transcript lost keyboard focus');
      check(!document.body.classList.contains('has-transcript-open'), 'Closing transcript retained small character');
      check(Math.abs(rect('pet-wrapper').width - window.__conversationRest.width) < 1, 'Resting character size not restored');
    `);
    send('voice:text-delta', { fullText: 'A late streamed reply must not reopen the panel.' });
    complete();
    for (let i = 0; i < 2; i++) {
      send('voice:user-final', 'Hidden history continues to receive messages.');
      send('voice:text-delta', { fullText: 'Keep the same reading anchor while older messages are pruned.' });
      complete();
    }
    await run(`await wait(); check(get('transcript-panel').classList.contains('hidden'), 'Stream reopened a dismissed transcript');
      get('btn-transcript').click(); await wait();`);
    await page.capturePage();
    await run(`await wait();
      check(get('transcript-list').textContent.includes('late streamed reply'), 'Hidden reply was lost');
      check(window.__readingAnchor.isConnected, 'Test history anchor was pruned unexpectedly');
      check(Math.abs(window.__readingAnchor.offsetTop - get('transcript-list').scrollTop - window.__readingOffset) < 2, 'Reopening history lost the reading position');
      get('transcript-jump-pill').click();
      get('btn-clear-transcript').click(); await wait();
      check(get('transcript-list').querySelectorAll('.transcript-msg').length === 0, 'Clear retained messages');
      check(rect('transcript-panel').height > 100, 'Empty transcript collapsed the reading area');
      get('btn-ptt-mic').click();
      for (let i = 0; i < 50 && !get('btn-ptt-mic').classList.contains('active'); i++) await wait();
      check(get('btn-ptt-mic').classList.contains('active'), 'Fake microphone did not start');
      get('btn-ptt-mic').click();
      check(!get('btn-ptt-mic').classList.contains('active'), 'Microphone did not stop');
      check(document.body.classList.contains('has-transcript-open'), 'Stopping microphone collapsed history');
    `);
    send('voice:status', { status: 'disconnected', provider: 'Smoke' });
    await run(`await wait(); check(!get('transcript-panel').classList.contains('hidden'), 'Disconnect discarded history');
      get('btn-close-transcript').click(); get('btn-transcript').click();
      check(document.body.classList.contains('has-transcript-open'), 'Offline history did not make room for character');
      get('gsi-hud-bar').classList.remove('hidden'); await wait();`);
    await geometry();
    for (const mode of ['scale-compact', 'scale-mini']) {
      await run(`document.body.classList.add('${mode}'); await wait();`);
      await geometry();
      await run(`document.body.classList.remove('${mode}');`);
    }
    await run(`get('gsi-hud-bar').classList.add('hidden');
      get('btn-pet-toggle').click(); await wait();`);
    send('voice:user-interim', '测试萌宠的语音状态');
    await run(`await wait(); check(get('dialogue-hud').classList.contains('hidden'), 'Pet quote obscured live transcript');
      check(get('status-text').textContent.includes('识别'), 'Pet voice state did not update');`);
    send('voice:text-delta', { fullText: '我会留在上方，你可以在下方查看对话。I am here, above your conversation.' });
    complete();
    await geometry();
    fs.writeFileSync(path.join(outputDirectory, 'conversation-pet.png'), (await page.capturePage()).toPNG());
    send('translate:result', { original: 'push mid', meaningZh: '一起推进中路。'.repeat(40), intent: 'strategy', suggestions: ['push mid'] });
    await run(`await wait();
      check(getComputedStyle(get('transcript-panel')).visibility === 'hidden', 'Translation and transcript overlap');
      check(rect('pet-wrapper').bottom < rect('dialogue-hud').top, 'Translation covers character');
      check(rect('dialogue-hud').bottom < document.querySelector('.hud-bottom-dock').getBoundingClientRect().top, 'Long translation covers controls');
      get('btn-close-bubble').click();
      check(getComputedStyle(get('transcript-panel')).visibility === 'visible', 'Closing translation did not restore transcript');
      get('btn-pet-toggle').click(); await wait();
    `);
    await geometry();
    fs.writeFileSync(path.join(outputDirectory, 'conversation-hero.png'), (await page.capturePage()).toPNG());
    await run(`get('btn-close-transcript').click(); get('btn-close-bubble').click();`);
    if (JSON.stringify(mainWindow.getBounds()) !== JSON.stringify(before)) throw new Error('Conversation moved or resized the desktop window');
    return { connectedLayout: true, fixedReadingArea: true, historyScroll: true, manualCollapse: true,
      microphoneStop: true, offlineHistory: true, hiddenHistoryPruning: true, scales: 3, gsi: true, petQuotes: true, translation: true, fixedWindow: true };
  } finally {
    await page.removeInsertedCSS(style);
  }
}

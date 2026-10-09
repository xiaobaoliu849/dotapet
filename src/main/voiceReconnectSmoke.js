import assert from 'node:assert/strict';
import fs from 'node:fs';

/** Isolated Electron smoke: real encrypted store, shortcut, IPC and microphone.
 * Only the cloud handshake is faked, so this never sends audio or keys online.
 */
export async function runVoiceReconnectSmoke({ mainWindow, store, client, connection, disconnect, getSettingsWindow, runConversation }) {
  const engine = client.cloudEngine;
  const originalConnect = engine.connect;
  const attempts = [];
  let mode = 'ready';
  const sleep = () => new Promise(resolve => setTimeout(resolve, 30));
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await sleep(); }
    throw new Error('Voice reconnect smoke timed out');
  };
  const page = mainWindow.webContents;
  const run = source => page.executeJavaScript(`(async () => { ${source} })()`);
  const micActive = () => run("return document.getElementById('btn-ptt-mic').classList.contains('active')");
  const toggle = () => page.send('shortcut:toggle-voice');
  const closeSettings = () => getSettingsWindow()?.close();
  engine.connect = function () {
    attempts.push({ key: this.apiKey, provider: this.provider, model: this.googleModel });
    const generation = this.googleConnectGen;
    this.isConnecting = true;
    this.emit('status', { status: 'connecting', providerId: this.provider });
    if (mode === 'hold') return;
    setTimeout(() => {
      if (generation !== this.googleConnectGen) return;
      if (mode === 'auth') { this.emit('status', { status: 'error', error: '401 invalid API key: reconnect-smoke-key' }); return; }
      this.isConnecting = false;
      this.isConnected = true;
      this.emit('status', { status: 'connected', providerId: this.provider });
      this.emit('session_ready', {});
    }, 30);
  };
  try {
    closeSettings();
    store.save({ provider: 'google', secrets: { apiKey: 'reconnect-smoke-key' } });
    const saved = fs.readFileSync(store.filePath, 'utf8');
    await run(`window.__voiceSmokeStreams = [];
      window.__voiceSmokeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await window.__voiceSmokeGetUserMedia(options);
        window.__voiceSmokeStreams.push(stream); return stream;
      };`);
    disconnect();
    toggle();
    await waitFor(micActive);
    assert.equal(attempts.length, 1);
    assert.deepEqual(attempts[0], { key: 'reconnect-smoke-key', provider: 'google', model: 'gemini-3.8-live' });
    assert.ok(!getSettingsWindow(), 'Saved credentials unexpectedly opened settings');
    // A renderer without a connected snapshot can reuse the main's live session.
    toggle(); await waitFor(async () => !await micActive());
    page.send('voice:status', { status: 'disconnected' });
    toggle(); await waitFor(micActive);
    assert.equal(attempts.length, 1, 'A stale renderer snapshot redialed a ready session');
    // An unexpected close uses exactly the same saved credentials on Alt+Q.
    engine.emit('status', { status: 'error', error: '连接已断开，请手动重试。' });
    await waitFor(async () => !await micActive());
    const notice = await run("return document.getElementById('hud-toast').textContent");
    assert.match(notice, /Alt\+Q/);
    toggle(); await waitFor(micActive);
    assert.equal(attempts.length, 2);
    assert.ok(!getSettingsWindow());
    assert.equal(fs.readFileSync(store.filePath, 'utf8'), saved, 'Reconnect required rewriting credentials');
    toggle(); await waitFor(async () => !await micActive());
    // A second press while connecting cancels both the pending dial and mic.
    disconnect(); mode = 'hold';
    const streamsBefore = await run('return window.__voiceSmokeStreams.length');
    toggle(); await waitFor(() => connection.pending);
    assert.equal(await run('return window.__voiceSmokeStreams.length'), streamsBefore);
    toggle(); await waitFor(() => !connection.pending);
    assert.equal(engine.isConnecting, false);
    assert.equal(await micActive(), false);
    // Auth errors keep the saved key, expose no secret and never open settings.
    mode = 'auth'; toggle();
    await waitFor(() => attempts.length === 4 && !connection.pending);
    await sleep();
    assert.equal(await micActive(), false);
    const authNotice = await run("return document.getElementById('hud-toast').textContent");
    assert.match(authNotice, /密钥无效/);
    assert.ok(!authNotice.includes('reconnect-smoke-key'));
    assert.ok(!getSettingsWindow());
    mode = 'ready'; toggle(); await waitFor(micActive);
    toggle(); await waitFor(async () => !await micActive());
    const conversation = await runConversation();
    // Missing credentials really do require the settings page, without a dial.
    disconnect(); store.deleteSecrets('google');
    const dials = attempts.length;
    toggle(); await waitFor(() => Boolean(getSettingsWindow()));
    assert.equal(attempts.length, dials);
    assert.equal(await micActive(), false);
    assert.equal(await run('return window.__voiceSmokeStreams.every(stream => stream.getTracks().every(track => track.readyState === "ended"))'), true);
    return { savedKeyStart: true, readySessionReuse: true, disconnectedRetry: true, cancelPending: true, authFailure: true, missingKeySettings: true, noSecretLeak: true, conversation };
  } finally {
    disconnect();
    engine.connect = originalConnect;
    closeSettings();
    await run('navigator.mediaDevices.getUserMedia = window.__voiceSmokeGetUserMedia; delete window.__voiceSmokeGetUserMedia; delete window.__voiceSmokeStreams;');
  }
}

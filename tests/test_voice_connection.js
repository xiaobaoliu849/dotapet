import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import { createVoiceConnection } from '../src/main/voiceConnection.js';

function fixture(t, options = {}) {
  const engine = Object.assign(new EventEmitter(), { provider: null, isConnected: false });
  const starts = [], failures = [];
  const connection = createVoiceConnection({ engine, timeoutMs: 1000,
    start: provider => { starts.push(provider); engine.provider = provider; engine.emit('status', { status: 'connecting' }); },
    onFailure: result => { failures.push(result); engine.isConnected = false; }, ...options });
  t.after(() => connection.dispose());
  const ready = () => { engine.isConnected = true; engine.emit('status', { status: 'connected' }); engine.emit('session_ready'); };
  return { engine, connection, starts, failures, ready };
}

test('construction stays offline, duplicate starts join, ready sessions are reused', async t => {
  const f = fixture(t);
  assert.deepEqual(f.starts, []);
  const first = f.connection.ensure('google');
  assert.equal(f.connection.ensure('google'), first);
  assert.equal(f.connection.pending, true);
  f.ready();
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await f.connection.ensure('google'), { ok: true });
  assert.deepEqual(f.starts, ['google']);
});

test('a new requested session greets once after readiness, never on reuse or config updates', async t => {
  let greetings = 0;
  const f = fixture(t, { onReady: () => greetings++ });
  const attempt = f.connection.ensure('qwen');
  f.ready(); assert.equal(greetings, 0);
  f.engine.emit('session_configured'); await attempt;
  assert.equal(greetings, 1);
  f.engine.emit('session_configured');
  await f.connection.ensure('qwen');
  assert.equal(greetings, 1);
  f.engine.emit('status', { status: 'disconnected' });
  // An internal reconnect (e.g. persona change) is not a user start.
  f.ready(); f.engine.emit('session_configured');
  assert.equal(greetings, 1);
  f.engine.emit('status', { status: 'disconnected' });
  const retry = f.connection.ensure('google'); f.ready(); await retry;
  assert.equal(greetings, 2);
});

test('cancelled and failed connections never greet, even with late readiness', async t => {
  let greetings = 0;
  const f = fixture(t, { onReady: () => greetings++ });
  const attempt = f.connection.ensure('google'); f.connection.cancel();
  assert.equal((await attempt).cancelled, true); f.ready();
  assert.equal(greetings, 0);
  const next = f.connection.ensure('doubao');
  f.engine.emit('status', { status: 'error', error: '401' }); await next;
  f.ready(); assert.equal(greetings, 0);
});

test('unexpected disconnection permits retry without changing provider or saving keys', async t => {
  const f = fixture(t);
  const first = f.connection.ensure('google'); f.ready(); await first;
  f.engine.isConnected = false;
  f.engine.emit('status', { status: 'error', error: '连接已断开，请手动重试。' });
  const second = f.connection.ensure('google'); f.ready();
  assert.equal((await second).ok, true);
  assert.deepEqual(f.starts, ['google', 'google']);
});

test('Qwen waits for session.updated, and Doubao waits beyond socket connected', async t => {
  const f = fixture(t);
  const first = f.connection.ensure('qwen'); f.ready();
  assert.equal(f.connection.pending, true);
  f.engine.emit('session_configured');
  assert.equal((await first).ok, true);
  const second = f.connection.ensure('doubao');
  f.engine.isConnected = true; f.engine.emit('status', { status: 'connected' });
  assert.equal(f.connection.pending, true);
  f.engine.emit('session_ready');
  assert.equal((await second).ok, true);
});

test('switch and cancellation settle old waiters, and disposal removes listeners', async t => {
  const f = fixture(t);
  const first = f.connection.ensure('google');
  const second = f.connection.ensure('qwen');
  assert.equal((await first).cancelled, true);
  assert.equal(f.connection.isPending(first), false);
  assert.equal(f.connection.isPending(second), true);
  f.connection.cancel();
  assert.equal((await second).cancelled, true);
  assert.equal(f.connection.pending, false);
  f.connection.dispose();
  for (const event of ['status', 'session_ready', 'session_configured']) assert.equal(f.engine.listenerCount(event), 0);
});

test('timeout ends a hung handshake and reports a retryable failure', async t => {
  const f = fixture(t, { timeoutMs: 10 });
  const result = await f.connection.ensure('google');
  assert.equal(result.ok, false); assert.match(result.error, /超时/);
  assert.equal(f.failures.length, 1);
  assert.equal(f.connection.pending, false);
});

test('missing or unreadable keys require settings; network errors are sanitized', async t => {
  const f = fixture(t, { start: () => { throw Object.assign(new Error('保存的密钥无法解密'), { needsSettings: true }); } });
  assert.equal((await f.connection.ensure('google')).needsSettings, true);
  const g = fixture(t);
  const pending = g.connection.ensure('google');
  g.engine.emit('status', { status: 'error', error: '401 invalid API key: SECRET' });
  const result = await pending;
  assert.match(result.error, /密钥无效/); assert.ok(!result.error.includes('SECRET'));
  assert.equal(result.needsSettings, undefined);
});

const rendererSource = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const micSource = rendererSource.slice(rendererSource.indexOf('async function startMicrophone()'), rendererSource.indexOf('/**\n * Copy text helper'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function renderer() {
  const connection = deferred(), media = deferred();
  const state = { microphoneGeneration: 0, voiceDisconnectGeneration: 0, voiceConnected: false };
  const calls = { media: 0, settings: 0, cancelled: [] };
  const context = vm.createContext({ state, navigator: { mediaDevices: { getUserMedia() { calls.media++; return media.promise; } } },
    window: { electronAPI: { ensureVoiceConnected: () => connection.promise, cancelVoiceConnect: id => calls.cancelled.push(id),
      openAISettings: () => calls.settings++, commitVoiceUtterance() {} } },
    elements: { pttLabel: {}, btnPttMic: { classList: { remove() {} } } },
    setAppState() {}, showToast() {}, console });
  vm.runInContext(micSource, context);
  return { context, state, calls, connection, media, start: () => vm.runInContext('startMicrophone()', context), stop: () => vm.runInContext('stopMicrophone()', context) };
}

test('cancel during connection never requests microphone, even with late success', async () => {
  const r = renderer(); const started = r.start();
  assert.equal(r.calls.media, 0);
  r.stop(); r.connection.resolve({ ok: true }); await started;
  assert.equal(r.calls.media, 0); assert.equal(r.calls.cancelled.length, 1);
  assert.equal(r.state.isMicActive, false);
});

test('cancel while microphone permission is pending stops the later stream', async () => {
  const r = renderer(); const started = r.start();
  r.connection.resolve({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.calls.media, 1);
  r.stop(); let stopped = 0;
  r.media.resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await started;
  assert.equal(stopped, 1); assert.equal(r.state.isMicActive, false);
});

test('a disconnect overtaking the ready reply cannot reopen the microphone', async () => {
  const r = renderer(); const started = r.start();
  r.state.voiceDisconnectGeneration++;
  r.connection.resolve({ ok: true }); await started;
  assert.equal(r.calls.media, 0);
  assert.equal(r.state.voiceConnected, false);
  assert.equal(r.state.isMicStarting, false);
});

test('only configuration failures open settings; network errors never open mic', async () => {
  for (const needsSettings of [false, true]) {
    const r = renderer(); const started = r.start();
    r.connection.resolve({ ok: false, error: 'test failure', needsSettings }); await started;
    assert.equal(r.calls.settings, needsSettings ? 1 : 0);
    assert.equal(r.calls.media, 0); assert.equal(r.state.isMicStarting, false);
  }
});

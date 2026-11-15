import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import {
  CloudVoiceEngine,
  CLOUD_KEYS,
  configureCloudKeys,
  DEFAULT_MOSS_REALTIME_MODEL,
  DEFAULT_MOSS_ENGLISH_VOICE,
  DEFAULT_MOSS_CHINESE_VOICE,
  MOSS_INPUT_FRAME_BYTES,
  MOSS_OUTPUT_SAMPLE_RATE,
} from '../src/services/cloudVoiceEngine.js';
import { MossPlaybackClock } from '../src/services/voice/moss.js';
import { AISettingsStore } from '../src/main/aiSettingsStore.js';
import { engineOptions } from '../src/main/aiConfiguration.js';
import { aiKeyPage } from '../src/main/aiSettingsIpc.js';

function startMockMossServer() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const connections = [];
    wss.on('connection', (ws, req) => {
      const conn = {
        ws,
        url: req.url,
        headers: req.headers,
        jsonMessages: [],
        binaryFrames: [],
      };
      connections.push(conn);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          conn.binaryFrames.push(Buffer.from(data));
          return;
        }
        const msg = JSON.parse(Buffer.from(data).toString('utf8'));
        conn.jsonMessages.push(msg);
        if (msg.action === 'attach_session') {
          ws.send(JSON.stringify({ action: 'session_attached', data: { session_id: 'moss-sess-1' } }));
        } else if (msg.action === 'change_voice') {
          ws.send(JSON.stringify({ action: 'voice_changed', data: { voice_name: msg.voice_name } }));
        } else if (msg.action === 'session.update') {
          ws.send(JSON.stringify({ action: 'session.updated', data: {} }));
        }
      });
    });
    wss.on('listening', () => {
      const { port } = wss.address();
      resolve({
        wss,
        wsUrl: `ws://127.0.0.1:${port}/v1/realtime`,
        connections,
        close: () => new Promise(done => wss.close(done)),
      });
    });
  });
}

function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for condition'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('MOSS-Live connects with Bearer auth, sends change_voice for native English voice (Amber), and frames 640B audio', async () => {
  const server = await startMockMossServer();
  const prevUrl = CLOUD_KEYS.moss_ws_url;
  configureCloudKeys({ moss_ws_url: server.wsUrl });

  const engine = new CloudVoiceEngine({
    provider: 'moss',
    apiKey: 'moss-test-key',
    autoReconnect: false,
  });

  try {
    const readyPromise = new Promise((resolve, reject) => {
      engine.once('session_ready', resolve);
      engine.on('status', (s) => { if (s.status === 'error') reject(new Error(s.error)); });
    });

    engine.connect();
    await readyPromise;

    assert.equal(server.connections.length, 1);
    const conn = server.connections[0];
    await waitFor(() => conn.jsonMessages.some(m => m.action === 'mic_state'));
    assert.equal(conn.url, `/v1/realtime?model=${DEFAULT_MOSS_REALTIME_MODEL}`);
    assert.equal(conn.headers.authorization, 'Bearer moss-test-key');

    const attach = conn.jsonMessages.find(m => m.action === 'attach_session');
    const changeVoice = conn.jsonMessages.find(m => m.action === 'change_voice');
    const update = conn.jsonMessages.find(m => m.action === 'session.update');
    const mic = conn.jsonMessages.find(m => m.action === 'mic_state');
    assert.ok(attach);
    assert.equal(changeVoice?.voice_name, DEFAULT_MOSS_ENGLISH_VOICE);
    assert.ok(update?.session?.instructions.includes('native UK English accent'));
    assert.ok(update?.session?.instructions.includes('Never utter Chinese characters'));
    assert.equal(mic?.enabled, true);

    // Send 1000 bytes -> 1 frame of 640 bytes, 360 bytes buffered; then +300 bytes -> 2nd 640-byte frame.
    engine.sendAudioChunk(Buffer.alloc(1000, 1));
    engine.sendAudioChunk(Buffer.alloc(300, 2));
    await waitFor(() => conn.binaryFrames.length === 2);
    assert.equal(conn.binaryFrames[0].length, MOSS_INPUT_FRAME_BYTES);
    assert.equal(conn.binaryFrames[1].length, MOSS_INPUT_FRAME_BYTES);
  } finally {
    engine.disconnect();
    configureCloudKeys({ moss_ws_url: prevUrl });
    await server.close();
  }
});

test('MOSS-Live supports native Chinese and UK English voices and mid-session voice switching', async () => {
  const server = await startMockMossServer();
  const prevUrl = CLOUD_KEYS.moss_ws_url;
  configureCloudKeys({ moss_ws_url: server.wsUrl });

  const engine = new CloudVoiceEngine({
    provider: 'moss',
    apiKey: 'moss-test-key',
    mossVoice: DEFAULT_MOSS_CHINESE_VOICE,
    autoReconnect: false,
  });

  try {
    const readyPromise = new Promise(resolve => engine.once('session_ready', resolve));
    engine.connect();
    await readyPromise;

    const conn = server.connections[0];
    const firstChange = conn.jsonMessages.find(m => m.action === 'change_voice');
    const firstUpdate = conn.jsonMessages.find(m => m.action === 'session.update');
    assert.equal(firstChange?.voice_name, DEFAULT_MOSS_CHINESE_VOICE);
    assert.ok(firstUpdate.session.instructions.includes('原生中文口音要求'));

    // Switch mid-session to Chenlin (Native UK British English)
    const chenlinUkId = 'ad8f9ced-3276-42f1-a2ca-a686c7d5e01d';
    engine.setMossAccent(chenlinUkId);
    await waitFor(() => conn.jsonMessages.filter(m => m.action === 'session.update').length === 2);
    const secondChange = conn.jsonMessages.filter(m => m.action === 'change_voice')[1];
    const secondUpdate = conn.jsonMessages.filter(m => m.action === 'session.update')[1];
    assert.equal(secondChange?.voice_name, chenlinUkId);
    assert.ok(secondUpdate.session.instructions.includes('native UK English accent'));
  } finally {
    engine.disconnect();
    configureCloudKeys({ moss_ws_url: prevUrl });
    await server.close();
  }
});

test('MOSS-Live streams 48kHz binary audio, acks playback chunks, and suppresses barge-in residue', async () => {
  const server = await startMockMossServer();
  const prevUrl = CLOUD_KEYS.moss_ws_url;
  configureCloudKeys({ moss_ws_url: server.wsUrl });

  const engine = new CloudVoiceEngine({
    provider: 'moss',
    apiKey: 'moss-test-key',
    autoReconnect: false,
  });

  const events = [];
  engine.on('speech_interim', (t) => events.push(['speech_interim', t]));
  engine.on('speech_final', (t) => events.push(['speech_final', t]));
  engine.on('agent_audio_start', (d) => events.push(['agent_audio_start', d]));
  engine.on('agent_audio_chunk', (d) => events.push(['agent_audio_chunk', d.sampleRate, d.buffer.length]));
  engine.on('agent_text_delta', (d) => events.push(['agent_text_delta', d.delta, d.fullText]));
  engine.on('agent_complete', (d) => events.push(['agent_complete', d.text, d.hadAudio]));
  engine.on('interrupted', () => events.push(['interrupted']));

  try {
    const readyPromise = new Promise(resolve => engine.once('session_ready', resolve));
    engine.connect();
    await readyPromise;
    const conn = server.connections[0];

    // Turn 1: user speech + assistant 48kHz audio + transcript + completion
    conn.ws.send(JSON.stringify({ action: 'input.speech.started', data: {} }));
    conn.ws.send(JSON.stringify({ action: 'input.transcript.updated', data: { text: 'Hello' } }));
    conn.ws.send(JSON.stringify({ action: 'input.transcript.done', data: { text: 'Hello DotaPet' } }));
    conn.ws.send(JSON.stringify({ action: 'response.audio.started', data: { run_id: 'r1', turn_id: 't1' } }));
    conn.ws.send(JSON.stringify({ action: 'response.audio.context', data: { chunk_id: 'c1', run_id: 'r1', turn_id: 't1' } }));
    conn.ws.send(Buffer.alloc(1920, 7)); // 20ms at 48kHz S16LE
    conn.ws.send(JSON.stringify({ action: 'output.transcript.updated', data: { run_id: 'r1', text: 'Hey!' } }));
    conn.ws.send(JSON.stringify({ action: 'output.transcript.done', data: { run_id: 'r1', text: 'Hey! Ready to lane?' } }));
    conn.ws.send(JSON.stringify({ action: 'response.audio.done', data: { run_id: 'r1', turn_id: 't1' } }));
    conn.ws.send(JSON.stringify({ action: 'response.ended', data: { run_id: 'r1', turn_id: 't1', status: 'completed' } }));

    await waitFor(() => events.some(e => e[0] === 'agent_complete'));
    await waitFor(() => conn.jsonMessages.some(m => m.action === 'playback.completed'));

    assert.ok(events.some(e => e[0] === 'speech_interim' && e[1] === 'Hello'));
    assert.ok(events.some(e => e[0] === 'speech_final' && e[1] === 'Hello DotaPet'));
    assert.ok(events.some(e => e[0] === 'agent_audio_chunk' && e[1] === MOSS_OUTPUT_SAMPLE_RATE && e[2] === 1920));
    assert.ok(events.some(e => e[0] === 'agent_complete' && e[1] === 'Hey! Ready to lane?' && e[2] === true));

    const chunkAck = conn.jsonMessages.find(m => m.action === 'playback.chunk.completed');
    assert.deepEqual(chunkAck, { action: 'playback.chunk.completed', chunk_id: 'c1', run_id: 'r1', turn_id: 't1' });

    // Turn 2: barge-in stops r2 and drops trailing binary frames
    conn.ws.send(JSON.stringify({ action: 'response.audio.started', data: { run_id: 'r2', turn_id: 't2' } }));
    conn.ws.send(JSON.stringify({ action: 'response.audio.context', data: { chunk_id: 'c2', run_id: 'r2', turn_id: 't2' } }));
    conn.ws.send(Buffer.alloc(1920, 8));
    conn.ws.send(JSON.stringify({ action: 'response.audio.stop', data: { run_id: 'r2', turn_id: 't2' } }));
    conn.ws.send(JSON.stringify({ action: 'response.audio.context', data: { chunk_id: 'c3', run_id: 'r2', turn_id: 't2' } }));
    conn.ws.send(Buffer.alloc(1920, 9)); // residue after stop — must be dropped
    conn.ws.send(JSON.stringify({ action: 'response.ended', data: { run_id: 'r2', turn_id: 't2', status: 'aborted' } }));

    await waitFor(() => conn.jsonMessages.some(m => m.action === 'playback.stopped'));
    assert.equal(events.filter(e => e[0] === 'interrupted').length, 1);
    assert.equal(events.filter(e => e[0] === 'agent_audio_chunk').length, 2); // c1 and c2 only, c3 dropped
    assert.equal(events.filter(e => e[0] === 'agent_complete').length, 1); // r2 did not complete
  } finally {
    engine.disconnect();
    configureCloudKeys({ moss_ws_url: prevUrl });
    await server.close();
  }
});

test('MossPlaybackClock reports played_audio_ms on stop', () => {
  const sent = [];
  let now = 10.0;
  const clock = new MossPlaybackClock((msg) => sent.push(msg), { clock: () => now, leadSeconds: 0.1 });
  clock.addChunk({ chunk_id: 'c1', run_id: 'r1', turn_id: 't1' }, 96000); // 1.0s at 48kHz
  now = 10.35; // 0.25s past start (10.1)
  clock.stop('r1', 't1');
  clock.dispose();
  assert.deepEqual(sent, [{ action: 'playback.stopped', run_id: 'r1', turn_id: 't1', played_audio_ms: 250 }]);
});

test('AISettingsStore and engineOptions support MOSS-Live voice UUIDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-moss-'));
  const filePath = path.join(dir, 'ai-settings.json');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  };
  try {
    const store = new AISettingsStore({ filePath, safeStorage });
    store.save({
      provider: 'moss',
      model: 'moss-live-1.0',
      voice: DEFAULT_MOSS_CHINESE_VOICE,
      secrets: { apiKey: 'moss-secret-123' },
    });
    const opts = engineOptions(store, 'moss');
    assert.equal(opts.provider, 'moss');
    assert.equal(opts.apiKey, 'moss-secret-123');
    assert.equal(opts.mossVoice, DEFAULT_MOSS_CHINESE_VOICE);
    assert.equal(opts.mossModel, 'moss-live-1.0');
    assert.equal(aiKeyPage('moss'), 'https://platform.moss.cn');

    assert.throws(() => store.save({ provider: 'moss', voice: 'not-a-moss-voice' }), /请选择支持的音色/);

    // Verify legacy 'en' / '0f2815fb-0d4c-4cee-ac8c-0bb916af7b28' / '29ab8244-1319-40d4-b508-2b58bb5e2d81' voice values migrate cleanly to Chenlin
    for (const legacyVoice of ['en', '0f2815fb-0d4c-4cee-ac8c-0bb916af7b28', '29ab8244-1319-40d4-b508-2b58bb5e2d81']) {
      const rawVault = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      rawVault.providers.moss.voice = legacyVoice;
      fs.writeFileSync(filePath, JSON.stringify(rawVault));
      const reloaded = new AISettingsStore({ filePath, safeStorage });
      assert.equal(reloaded.error, '');
      assert.equal(reloaded.getPrivate('moss').voice, DEFAULT_MOSS_ENGLISH_VOICE);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

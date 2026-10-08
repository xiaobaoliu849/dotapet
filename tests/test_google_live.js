/**
 * Offline smoke test for the Google Gemini Live providers in CloudVoiceEngine.
 *
 * Spins up local mock BidiGenerateContent WebSocket servers that speak the
 * same wire protocol as generativelanguage.googleapis.com (setup →
 * setupComplete → serverContent frames) and drives both modes end-to-end:
 *   - 'google'            chat: VAD barge-in, cumulative transcript merge,
 *                         model audio, text turns
 *   - 'google-translate'  live translate: finished markers + 2s idle finalize
 *
 * Usage: node tests/test_google_live.js
 */
import assert from 'assert';
import WebSocket, { WebSocketServer } from 'ws';
import {
  CloudVoiceEngine,
  CLOUD_KEYS,
  DEFAULT_GOOGLE_REALTIME_MODEL,
  DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL,
  DEFAULT_GOOGLE_REALTIME_VOICE,
  GOOGLE_REALTIME_VOICES,
  GOOGLE_LIVE_WS_URL,
} from '../src/services/cloudVoiceEngine.js';

console.log('=== Google Gemini Live Provider Test Suite ===\n');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal mock of Google's BidiGenerateContent server. Records the client
 * setup frame, replies setupComplete, and lets tests push scripted server
 * frames. `onClientMessage` exposes client→server frames for assertions.
 */
class MockGoogleLiveServer {
  constructor() {
    this.setup = null;
    this.clientMessages = [];
    this.sockets = new Set();
    this.server = null;
    this.port = 0;
  }

  start() {
    return new Promise((resolve) => {
      this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
        this.port = this.server.address().port;
        resolve(this);
      });
      this.server.on('connection', (socket, request) => {
        this.sockets.add(socket);
        // Emulate Google's auth behaviour: a rejected key gets the connection
        // closed with 1007 + the exact server reason text.
        const clientKey = request.headers['x-goog-api-key'];
        socket.on('close', () => this.sockets.delete(socket));
        if (this.validKeys && clientKey && !this.validKeys.includes(clientKey)) {
          socket.close(1007, 'API key not valid. Please pass a valid API key.');
          return;
        }
        let gotSetup = false;
        socket.on('message', (data) => {
          let msg;
          try {
            msg = JSON.parse(data.toString('utf-8'));
          } catch {
            return;
          }
          this.clientMessages.push(msg);
          if (msg.setup && !gotSetup) {
            gotSetup = true;
            this.setup = msg.setup;
            socket.send(JSON.stringify({ setupComplete: {} }));
          }
        });
        socket.on('close', () => this.sockets.delete(socket));
      });
    });
  }

  send(obj) {
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    }
  }

  lastClientMessage() {
    return this.clientMessages[this.clientMessages.length - 1] || null;
  }

  async stop() {
    for (const socket of this.sockets) {
      try { socket.close(); } catch {}
    }
    await new Promise((resolve) => this.server.close(resolve));
  }
}

async function runAsyncTests() {
  // --- Static protocol-shape tests -----------------------------------
  test('Google Live constants match VoiceSpirit defaults', () => {
    assert.strictEqual(DEFAULT_GOOGLE_REALTIME_MODEL, 'gemini-3.1-flash-live-preview');
    assert.strictEqual(DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL, 'gemini-3.5-live-translate-preview');
    assert.strictEqual(DEFAULT_GOOGLE_REALTIME_VOICE, 'Puck');
    assert.ok(GOOGLE_REALTIME_VOICES.includes('Puck'));
    assert.ok(GOOGLE_LIVE_WS_URL.startsWith('wss://generativelanguage.googleapis.com/ws/'));
  });

  test('Chat setup frame: speechConfig, transcriptions and VAD are wired', () => {
    const engine = new CloudVoiceEngine({ provider: 'google', apiKey: 'k' });
    engine.setHero({
      id: 'pudge', nameZh: '帕吉', nameEn: 'Pudge',
      systemPrompt: '腐烂的屠夫', catchphrases: ['肉块，来！'],
    });
    engine.provider = 'google';
    const msg = JSON.parse(engine.buildGoogleSetupMessage());
    assert.strictEqual(msg.setup.model, 'models/gemini-3.1-flash-live-preview');
    assert.deepStrictEqual(msg.setup.generationConfig.responseModalities, ['AUDIO']);
    assert.strictEqual(
      msg.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      'Puck',
    );
    assert.ok(msg.setup.inputAudioTranscription);
    assert.ok(msg.setup.outputAudioTranscription);
    assert.strictEqual(
      msg.setup.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity,
      'START_SENSITIVITY_HIGH',
    );
    assert.ok(msg.setup.systemInstruction.parts[0].text.includes('帕吉'));
    assert.strictEqual(msg.setup.translationConfig, undefined);
  });

  test('Translate setup frame: translationConfig inside generationConfig, no persona', () => {
    const engine = new CloudVoiceEngine({ provider: 'google-translate', apiKey: 'k' });
    const msg = JSON.parse(engine.buildGoogleSetupMessage());
    assert.strictEqual(msg.setup.model, 'models/gemini-3.5-live-translate-preview');
    assert.strictEqual(msg.setup.generationConfig.translationConfig.targetLanguageCode, 'en');
    // Official default: no echo. With echo on, target-language input is
    // parroted back verbatim — the "我说英语它也念英语" symptom.
    assert.strictEqual(msg.setup.generationConfig.translationConfig.echoTargetLanguage, false);
    assert.ok(msg.setup.inputAudioTranscription);
    assert.ok(msg.setup.outputAudioTranscription);
    assert.strictEqual(msg.setup.systemInstruction, undefined);
    assert.strictEqual(msg.setup.speechConfig, undefined);
  });

  test('Translate setup frame honors a custom target language', () => {
    const engine = new CloudVoiceEngine({ provider: 'google-translate', apiKey: 'k', translateTargetLanguage: 'zh-Hans' });
    const msg = JSON.parse(engine.buildGoogleSetupMessage());
    assert.strictEqual(msg.setup.generationConfig.translationConfig.targetLanguageCode, 'zh-Hans');
    // Explicit opt-in still supports echo (bilingual parrot practice mode).
    const echoEngine = new CloudVoiceEngine({ provider: 'google-translate', apiKey: 'k', translateEcho: true });
    const echoMsg = JSON.parse(echoEngine.buildGoogleSetupMessage());
    assert.strictEqual(echoMsg.setup.generationConfig.translationConfig.echoTargetLanguage, true);
  });

  // --- Chat-mode live flow -------------------------------------------
  const chatMock = await new MockGoogleLiveServer().start();
  CLOUD_KEYS.google_ws_url = `ws://127.0.0.1:${chatMock.port}`;
  const chatEvents = [];
  const chatEngine = new CloudVoiceEngine({ provider: 'google', apiKey: 'test-key' });
  chatEngine.setHero({ id: 'pudge', nameZh: '帕吉', nameEn: 'Pudge', systemPrompt: 'x', catchphrases: [] });
  for (const name of ['status', 'session_ready', 'speech_interim', 'speech_final', 'agent_audio_start', 'agent_audio_chunk', 'agent_text_delta', 'agent_complete', 'interrupted']) {
    chatEngine.on(name, (data) => chatEvents.push([name, data]));
  }
  chatEngine.connect();
  await sleep(120);

  test('Chat: setup frame carries hero persona and model', () => {
    assert.ok(chatMock.setup, 'mock never received setup');
    assert.strictEqual(chatMock.setup.model, 'models/gemini-3.1-flash-live-preview');
    assert.ok(chatMock.setup.systemInstruction.parts[0].text.includes('帕吉'));
  });

  test('Chat: session_ready + connected status on setupComplete', () => {
    assert.ok(chatEvents.some(([n, d]) => n === 'session_ready' && d.provider === 'Google'));
    assert.ok(chatEvents.some(([n, d]) => n === 'status' && d.status === 'connected'));
  });

  chatMock.send({ serverContent: { inputTranscription: { text: '你好' } } });
  chatMock.send({ serverContent: { inputTranscription: { text: '你好，世界' } } });
  await sleep(60);

  test('Chat: cumulative input transcription merges (overlap-safe interim)', () => {
    const interims = chatEvents.filter(([n]) => n === 'speech_interim').map(([, d]) => d);
    assert.ok(interims.includes('你好'), `interim '你好' missing: ${JSON.stringify(interims)}`);
    assert.ok(interims.includes('你好，世界'), `merged interim missing: ${JSON.stringify(interims)}`);
  });

  chatMock.send({
    serverContent: {
      interrupted: true,
    },
  });
  chatMock.send({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from([1, 2, 3, 4]).toString('base64') } }],
      },
    },
  });
  await sleep(60);

  test('Chat: barge-in interrupted event, then audio resumes a fresh turn', () => {
    assert.ok(chatEvents.some(([n]) => n === 'interrupted'));
    const start = chatEvents.filter(([n]) => n === 'agent_audio_start').pop();
    assert.ok(start, 'agent_audio_start missing');
    const chunk = chatEvents.filter(([n]) => n === 'agent_audio_chunk').pop();
    assert.ok(chunk, 'agent_audio_chunk missing');
    assert.strictEqual(chunk[1].sampleRate, 24000);
    assert.ok(Buffer.isBuffer(chunk[1].buffer));
  });

  chatMock.send({ serverContent: { outputTranscription: { text: 'Hello' } } });
  chatMock.send({ serverContent: { outputTranscription: { text: 'Hello there' } } });
  await sleep(60);

  test('Chat: output transcription publishes only the novel suffix', () => {
    const deltas = chatEvents.filter(([n]) => n === 'agent_text_delta').map(([, d]) => d.delta);
    assert.deepStrictEqual(deltas, ['Hello', ' there']);
    const full = chatEvents.filter(([n]) => n === 'agent_text_delta').map(([, d]) => d.fullText);
    assert.strictEqual(full[full.length - 1], 'Hello there');
  });

  chatMock.send({ serverContent: { turnComplete: true } });
  await sleep(60);

  test('Chat: turnComplete finalizes user transcript + assistant turn', () => {
    const final = chatEvents.filter(([n]) => n === 'speech_final').map(([, d]) => d).pop();
    assert.ok(final, 'speech_final missing');
    const completes = chatEvents.filter(([n]) => n === 'agent_complete').map(([, d]) => d);
    assert.ok(completes.length > 0, 'agent_complete missing');
    assert.strictEqual(completes[completes.length - 1].text, 'Hello there');
  });

  chatMock.clientMessages = [];
  chatEngine.sendAudioChunk(Buffer.alloc(640, 1));
  chatEngine.sendUserText('给我报个点');
  await sleep(60);

  test('Chat: mic audio goes out as realtimeInput.audio, text as clientContent', () => {
    const audioMsg = chatMock.clientMessages.find((m) => m.realtimeInput?.audio);
    assert.ok(audioMsg, 'realtimeInput.audio missing');
    assert.strictEqual(audioMsg.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
    const textMsg = chatMock.clientMessages.find((m) => m.clientContent);
    assert.ok(textMsg, 'clientContent missing');
    assert.strictEqual(textMsg.clientContent.turns[0].parts[0].text, '给我报个点');
    assert.strictEqual(textMsg.clientContent.turnComplete, true);
  });

  test('Chat: client VAD commits the utterance with audioStreamEnd after trailing silence', () => {
    // flash-live generation never commits server-side — the engine must send
    // realtimeInput.audioStreamEnd once ~1.1s of silence follows real speech.
    const engine = new CloudVoiceEngine({ provider: 'google', apiKey: 'k' });
    engine.provider = 'google';
    engine.isConnected = true;
    const frames = [];
    engine.ws = { readyState: WebSocket.OPEN, send: (s) => frames.push(JSON.parse(s)) };
    engine.resetGoogleLiveState();

    const loud = Buffer.alloc(3200);
    new Int16Array(loud.buffer).fill(2000); // RMS 2000 >= threshold
    const silence = Buffer.alloc(3200);     // RMS 0, 100ms per chunk

    engine.sendAudioChunk(loud);
    for (let i = 0; i < 12; i++) {
      engine.sendAudioChunk(silence); // 12 × 100ms >= 1100ms trailing silence
    }
    assert.ok(
      frames.some((f) => f.realtimeInput?.audioStreamEnd === true),
      'audioStreamEnd frame missing after trailing silence',
    );
    // No speech → never commit (quiet mic must not spam empty turns).
    const framesBefore = frames.length;
    engine.resetGoogleLiveState();
    for (let i = 0; i < 12; i++) {
      engine.sendAudioChunk(silence);
    }
    assert.strictEqual(
      frames.slice(framesBefore).some((f) => f.realtimeInput?.audioStreamEnd === true),
      false,
      'audioStreamEnd fired without preceding speech',
    );
    engine.disconnect();
  });

  chatEngine.disconnect();
  await chatMock.stop();

  // --- Translate-mode live flow --------------------------------------
  const trMock = await new MockGoogleLiveServer().start();
  CLOUD_KEYS.google_ws_url = `ws://127.0.0.1:${trMock.port}`;
  const trEvents = [];
  const trEngine = new CloudVoiceEngine({ provider: 'google-translate', apiKey: 'test-key' });
  for (const name of ['status', 'session_ready', 'speech_interim', 'speech_final', 'agent_text_delta', 'agent_complete', 'agent_audio_chunk']) {
    trEngine.on(name, (data) => trEvents.push([name, data]));
  }
  trEngine.connect();
  await sleep(120);

  test('Translate: setup uses live-translate model with translationConfig', () => {
    assert.ok(trMock.setup, 'mock never received setup');
    assert.strictEqual(trMock.setup.model, 'models/gemini-3.5-live-translate-preview');
    assert.strictEqual(trMock.setup.generationConfig.translationConfig.targetLanguageCode, 'en');
  });

  trEngine.setTranslateTargetLanguage('zh-Hans');
  await sleep(200);

  test('Translate: changing the target language re-sends setup with the new code', () => {
    assert.strictEqual(trEngine.translateTargetLanguage, 'zh-Hans');
    const setups = trMock.clientMessages.filter((m) => m.setup);
    const last = setups[setups.length - 1];
    assert.ok(last, 'no setup frame after language change');
    assert.strictEqual(last.setup.generationConfig.translationConfig.targetLanguageCode, 'zh-Hans');
  });

  test('Translate: language change is a no-op outside google-translate', () => {
    const chatOnly = new CloudVoiceEngine({ provider: 'doubao', translateTargetLanguage: 'en' });
    chatOnly.isConnecting = true; // would reconnect if the guard were provider-blind
    chatOnly.disconnect = () => { throw new Error('disconnect must not fire for non-translate providers'); };
    chatOnly.connect = () => { throw new Error('connect must not fire for non-translate providers'); };
    chatOnly.setTranslateTargetLanguage('ja');
    assert.strictEqual(chatOnly.translateTargetLanguage, 'ja');
  });

  trMock.send({ serverContent: { inputTranscription: { text: '中路miss' } } });
  trMock.send({ serverContent: { inputTranscription: { text: '中路miss了', finished: true } } });
  trMock.send({ serverContent: { outputTranscription: { text: 'Mid missing', finished: true } } });
  await sleep(80);

  test('Translate: both finished markers close the turn immediately', () => {
    const final = trEvents.filter(([n]) => n === 'speech_final').map(([, d]) => d).pop();
    assert.strictEqual(final, '中路miss了');
    const completes = trEvents.filter(([n]) => n === 'agent_complete').map(([, d]) => d);
    assert.ok(completes.length === 1, `expected 1 agent_complete, got ${completes.length}`);
    assert.strictEqual(completes[0].mode, 'live_translate');
    assert.strictEqual(completes[0].text, 'Mid missing');
    // Mock pushed no model audio → the engine must NOT claim audio happened.
    assert.strictEqual(completes[0].hadAudio, false);
  });

  trEvents.length = 0;
  trMock.send({ serverContent: { outputTranscription: { text: 'Push now' } } });
  await sleep(2800);

  test('Translate: 2s downstream silence force-finalizes the pending turn', () => {
    const completes = trEvents.filter(([n]) => n === 'agent_complete').map(([, d]) => d);
    assert.ok(completes.length === 1, `expected idle finalize, got ${JSON.stringify(completes)}`);
    assert.strictEqual(completes[0].text, 'Push now');
  });

  trEvents.length = 0;
  trEngine.sendUserText('hello');
  await sleep(40);

  test('Translate: text input is rejected with an explicit error status', () => {
    assert.ok(trEvents.some(([n, d]) => n === 'status' && d.status === 'error' && d.error.includes('仅支持实时语音')));
  });

  trEngine.disconnect();
  await trMock.stop();
  CLOUD_KEYS.google_ws_url = '';

  // --- Rejected user key must never use another account ----------------
  const foMock = await new MockGoogleLiveServer().start();
  foMock.validKeys = ['good-key'];
  CLOUD_KEYS.google_ws_url = `ws://127.0.0.1:${foMock.port}`;
  CLOUD_KEYS.gemini = 'good-key';
  const foEngine = new CloudVoiceEngine({ provider: 'google', apiKey: 'bad-key', autoReconnect: false });
  const foEvents = [];
  for (const name of ['session_ready', 'status']) {
    foEngine.on(name, (data) => foEvents.push([name, data]));
  }
  foEngine.connect();
  await sleep(300);

  test('Rejected explicit key does not fall back to another stored key', () => {
    assert.ok(foEvents.some(([n, d]) => n === 'status' && d.status === 'error'));
    assert.ok(!foEvents.some(([n]) => n === 'session_ready'));
    assert.strictEqual(foMock.setup, null);
  });

  foEngine.disconnect();
  CLOUD_KEYS.gemini = '';
  await foMock.stop();
  CLOUD_KEYS.google_ws_url = '';
}

await runAsyncTests();

console.log(`\n=== ${passed}/${total} tests passed ===`);
process.exit(passed === total ? 0 : 1);

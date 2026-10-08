import assert from 'assert';
import { CloudVoiceEngine, CLOUD_KEYS, FREE_CHAT_HERO_ID, DEFAULT_DOUBAO_DUPLEX_ENDPOINT, DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL, DEFAULT_DOUBAO_REALTIME_VOICE, DOUBAO_REALTIME_VOICES } from '../src/services/cloudVoiceEngine.js';
import { VoiceSpiritClient } from '../src/services/voiceSpiritClient.js';

console.log('=== Starting DOTA 2 VoiceSpirit Companion Doubao Duplex Test Suite ===\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

async function runAsyncTests() {
  // Test 1: CloudVoiceEngine Defaults and Constants
  test('CloudVoiceEngine defaults match Doubao Duplex standards', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    assert.strictEqual(engine.provider, 'doubao');
    assert.strictEqual(engine.doubaoVoice, DEFAULT_DOUBAO_REALTIME_VOICE);
    assert.strictEqual(engine.model, DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL);
    assert.strictEqual(DEFAULT_DOUBAO_DUPLEX_ENDPOINT, 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue');
    assert.ok(DOUBAO_REALTIME_VOICES.includes('zh_female_vv_jupiter_bigtts'));
    assert.ok(DOUBAO_REALTIME_VOICES.includes('zh_male_yunzhou_jupiter_bigtts'));
  });

  // Test 2: Hero Persona Injection and Instructions
  test('Hero Persona injection creates compliant instructions', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    const heroMock = {
      id: 'invoker',
      nameZh: '祈求者',
      nameEn: 'Invoker',
      systemPrompt: '高傲自信的大魔导师',
      catchphrases: ['吾乃魔法之极！', '知识就是力量！'],
    };
    engine.setHero(heroMock);
    const prompt = engine.getHeroSystemPrompt();
    assert.ok(prompt.includes('祈求者 (Invoker)'));
    assert.ok(prompt.includes('高傲自信的大魔导师'));
    assert.ok(prompt.includes('吾乃魔法之极！'));
    assert.ok(prompt.includes('DOTA 2'));
  });

  // Test 3: Session.create handshake message formatting
  test('Doubao Duplex session.create handshake generation', () => {
    const engine = new CloudVoiceEngine({
      provider: 'doubao',
      doubaoVoice: 'zh_female_vv_jupiter_bigtts',
      model: '1.2.6.1',
    });
    engine.setHero({ id: 'pudge', nameZh: '帕吉', nameEn: 'Pudge' });

    let sentMsg = null;
    engine.ws = {
      readyState: 1, // OPEN
      send: (str) => {
        sentMsg = JSON.parse(str);
      },
    };

    engine.sendDoubaoSessionCreate();
    assert.ok(sentMsg);
    assert.strictEqual(sentMsg.type, 'session.create');
    assert.ok(sentMsg.event_id.startsWith('sess_create_'));
    assert.strictEqual(sentMsg.session.model, '1.2.6.1');
    assert.strictEqual(sentMsg.session.audio.input.format.rate, 16000);
    assert.strictEqual(sentMsg.session.audio.output.format.rate, 24000);
    assert.strictEqual(sentMsg.session.audio.output.voice, 'zh_female_vv_jupiter_bigtts');
    assert.ok(sentMsg.session.instructions.includes('帕吉'));
    assert.ok(sentMsg.extension.asr);
    assert.ok(sentMsg.extension.tts);
    assert.ok(sentMsg.extension.dialog);
  });

  // Test 4: Audio chunk upload payload formatting
  test('Audio chunk streaming encoding (input_audio_buffer.append)', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    engine.isConnected = true;

    let sentJson = null;
    engine.ws = {
      readyState: 1,
      send: (str) => {
        sentJson = JSON.parse(str);
      },
    };

    const pcmChunk = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
    engine.sendAudioChunk(pcmChunk);

    assert.ok(sentJson);
    assert.strictEqual(sentJson.type, 'input_audio_buffer.append');
    assert.strictEqual(sentJson.audio, pcmChunk.toString('base64'));
  });

  // Test 5: Downlink Event Processing - Session Ready & ASR
  // Protocol semantics (2026-08-24 packet capture, VoiceSpirit 301cd74):
  // input_audio_transcription.delta is a full "as of now" SNAPSHOT that
  // revises backwards near the end — each frame REPLACES the interim text.
  // The old append-based expectation duplicated the interim over and over.
  test('Downlink session.created and user transcript snapshot handling', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    let readySessionId = '';
    let interimText = '';
    let finalText = '';

    engine.on('session_ready', (data) => {
      readySessionId = data.sessionId;
    });
    engine.on('speech_interim', (text) => {
      interimText = text;
    });
    engine.on('speech_final', (text) => {
      finalText = text;
    });

    engine.handleDoubaoDuplexEvent({
      type: 'session.created',
      session: { id: 'sess_123456' },
    });
    assert.strictEqual(readySessionId, 'sess_123456');

    // Each delta frame is the whole transcript so far — never appended.
    engine.handleDoubaoDuplexEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '去打',
    });
    assert.strictEqual(interimText, '去打');
    engine.handleDoubaoDuplexEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '去打肉山',
    });
    assert.strictEqual(interimText, '去打肉山');
    // A backward revision near end-of-speech must also win wholesale.
    engine.handleDoubaoDuplexEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '去打肉山，集合！',
    });
    assert.strictEqual(interimText, '去打肉山，集合！');

    engine.handleDoubaoDuplexEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '去打肉山，集合！',
    });
    assert.strictEqual(finalText, '去打肉山，集合！');
  });

  // Test 6: Assistant Audio Output & Completion
  test('Assistant Audio stream processing and completion', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    let receivedChunks = [];
    let completedTurn = false;
    let textDeltas = [];

    engine.on('agent_audio_chunk', (chunk) => {
      receivedChunks.push(chunk);
    });
    engine.on('agent_text_delta', (data) => {
      textDeltas.push(data.delta);
    });
    engine.on('agent_complete', () => {
      completedTurn = true;
    });

    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.started',
      response_id: 'resp_001',
    });
    assert.strictEqual(engine.suppressOutput, false);
    assert.strictEqual(engine.ttsActive, true);

    const testPcmB64 = Buffer.from([10, 20, 30, 40]).toString('base64');
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.delta',
      delta: testPcmB64,
    });
    assert.strictEqual(receivedChunks.length, 1);
    assert.strictEqual(receivedChunks[0].sampleRate, 24000);
    assert.strictEqual(receivedChunks[0].buffer.length, 4);

    engine.handleDoubaoDuplexEvent({
      type: 'response.output_text.delta',
      delta: '收到，肉山坑集结！',
    });
    assert.strictEqual(textDeltas.join(''), '收到，肉山坑集结！');

    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.done',
    });
    assert.strictEqual(completedTurn, true);
    assert.strictEqual(engine.ttsActive, false);
  });

  // Test 7: Barge-in and Output Suppression Window
  test('Barge-in / Interruption output suppression window drops late audio', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    let interruptedTriggered = false;
    let audioReceivedAfterInterrupt = false;

    engine.on('interrupted', () => {
      interruptedTriggered = true;
    });
    engine.on('agent_audio_chunk', () => {
      audioReceivedAfterInterrupt = true;
    });

    // Start assistant turn
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.started',
      response_id: 'resp_002',
    });
    assert.strictEqual(engine.ttsActive, true);

    // User starts speaking -> barge-in!
    engine.handleDoubaoDuplexEvent({
      type: 'conversation.item.input_audio_transcription.started',
    });
    assert.strictEqual(engine.suppressOutput, true);
    assert.strictEqual(engine.ttsActive, false);
    assert.strictEqual(interruptedTriggered, true);

    // Late audio packets from server from previous turn MUST be suppressed
    const lateAudioB64 = Buffer.from([99, 99, 99, 99]).toString('base64');
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.delta',
      delta: lateAudioB64,
    });
    assert.strictEqual(audioReceivedAfterInterrupt, false); // Suppressed!

    // Targeted suppression (VoiceSpirit 301cd74): residue explicitly carrying
    // the interrupted response_id is dropped too…
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.delta',
      response_id: 'resp_002',
      delta: lateAudioB64,
    });
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_text.delta',
      response_id: 'resp_002',
      delta: '被打断的残句',
    });
    assert.strictEqual(audioReceivedAfterInterrupt, false);

    // …and when the interrupted stream's done arrives, it fires no completion
    // but DOES lift the window (synthesis ended; a lingering blank window
    // would eat the next reply's opening).
    let lateCompleteTriggered = false;
    engine.on('agent_complete', () => {
      lateCompleteTriggered = true;
    });
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.done',
    });
    assert.strictEqual(lateCompleteTriggered, false);
    assert.strictEqual(engine.suppressedResponseId, null);

    // A genuinely NEW reply now streams freely even before its own started —
    // leading text deltas may even arrive BEFORE its own output_audio.started.
    let newTextDelta = '';
    let newAudioChunks = 0;
    engine.on('agent_text_delta', (d) => { newTextDelta = d.fullText; });
    engine.on('agent_audio_chunk', () => { newAudioChunks++; });

    engine.handleDoubaoDuplexEvent({
      type: 'response.output_text.delta',
      response_id: 'resp_003',
      delta: '新的回复开头',
    });
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.started',
      response_id: 'resp_003',
    });
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.delta',
      response_id: 'resp_003',
      delta: Buffer.from([1, 2, 3, 4]).toString('base64'),
    });
    assert.strictEqual(newTextDelta, '新的回复开头');
    assert.strictEqual(newAudioChunks, 1);
    assert.strictEqual(engine.suppressedResponseId, null);
  });

  // Test 8: VoiceSpiritClient Interruption and Event Relaying
  test('VoiceSpiritClient relays all duplex events & interrupt API', () => {
    const client = new VoiceSpiritClient({ provider: 'doubao' });
    let interruptedEmitted = false;

    client.on('interrupted', () => {
      interruptedEmitted = true;
    });

    client.interrupt();
    assert.strictEqual(interruptedEmitted, true);
    assert.strictEqual(client.cloudEngine.suppressOutput, true);
    // Default voice ported from VoiceSpirit: xiaohe (Taiwan-accent female).
    assert.strictEqual(client.cloudEngine.doubaoVoice, 'zh_female_xiaohe_jupiter_bigtts');
  });

  // Test 10: Default Doubao voice is 小何 and language detection never moves it
  test('Doubao defaults to xiaohe Taiwan-accent voice; dynamic switching stays off', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    assert.strictEqual(engine.doubaoVoice, 'zh_female_xiaohe_jupiter_bigtts');

    // Neither language may yank the voice away. The old dynamic switcher
    // flipped to the English-only Dacey on detected English speech — after
    // that, every Chinese reply died with "the voice you selected doesn't
    // support this language" (DOTA callouts mix 中英 constantly).
    engine.adaptVoiceForLanguage('en');
    engine.adaptVoiceForLanguage('zh');
    assert.strictEqual(
      engine.doubaoVoice,
      'zh_female_xiaohe_jupiter_bigtts',
      'xiaohe must stay pinned for the whole session'
    );

    // Explicit per-request choice still wins (Test 3 covers session.create).
    const custom = new CloudVoiceEngine({ provider: 'doubao', doubaoVoice: 'zh_female_vv_jupiter_bigtts' });
    assert.strictEqual(custom.doubaoVoice, 'zh_female_vv_jupiter_bigtts');
  });

  // Test 9: Websearch Extension Configuration
  test('Volcengine Built-in Websearch configuration when key present', () => {
    CLOUD_KEYS.doubao_websearch_key = 'test_websearch_key';
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    let sentMsg = null;
    engine.ws = {
      readyState: 1,
      send: (str) => {
        sentMsg = JSON.parse(str);
      },
    };
    engine.sendDoubaoSessionCreate();
    assert.ok(sentMsg.extension.dialog.extra.enable_volc_websearch);
    assert.strictEqual(sentMsg.extension.dialog.extra.volc_websearch_type, 'web');
    CLOUD_KEYS.doubao_websearch_key = '';
  });

  // Test 11: Free-Chat Companion persona with smart hero routing
  test('Free-chat mode: no hero locked, model routes role-play on demand', () => {
    // No hero set at all → free chat (also the fresh-install default).
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    assert.strictEqual(engine.currentHero, null);
    const freePrompt = engine.getHeroSystemPrompt('bilingual');
    assert.ok(freePrompt.includes('VoiceSpirit'), 'free prompt introduces the companion');
    assert.ok(freePrompt.includes('漫聊'), 'free prompt allows aimless chatting');
    assert.ok(freePrompt.includes('角色扮演'), 'free prompt routes hero role-play');
    assert.ok(!freePrompt.includes('你现在是《DOTA 2》中的英雄'), 'no locked-hero framing');

    // Selecting the companion pseudo-hero explicitly yields the same routing.
    engine.setHero({ id: FREE_CHAT_HERO_ID, nameZh: '自由伴侣', nameEn: 'Free Chat' });
    assert.strictEqual(engine.getHeroSystemPrompt('bilingual'), freePrompt);

    // Explicit hero selection still locks the hero persona as before.
    engine.setHero({
      id: 'pudge',
      nameZh: '帕吉',
      nameEn: 'Pudge',
      systemPrompt: '肉钩大魔头',
      catchphrases: ['新鲜肉块！'],
    });
    const heroPrompt = engine.getHeroSystemPrompt('bilingual');
    assert.ok(heroPrompt.includes('帕吉'));
    assert.ok(heroPrompt.includes('新鲜肉块！'));

    // English route gets its own free-chat variant.
    const enFree = new CloudVoiceEngine({ provider: 'cartesia' });
    const enPrompt = enFree.getHeroSystemPrompt('auto');
    assert.ok(enPrompt.includes('FREE CHAT'));
    assert.ok(enPrompt.includes('PURE ENGLISH REQUIREMENT'));
  });

  // Test 12 (REGRESSION): interrupt() must capture "was playing" BEFORE it
  // zeroes ttsActive, or the cancel-window arming condition can only see the
  // half it just cleared. An id-less reply already streaming audio must still
  // arm the blank suppression window.
  test('interrupt() arms a blank suppression window for id-less playing replies', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });
    engine.ttsActive = true;
    engine.activeTurnId = 'resp_noid';
    engine.activeResponseId = null;

    engine.interrupt();

    assert.strictEqual(engine.suppressedResponseId, '', 'blank window must be armed');
    assert.strictEqual(engine.turnFinalized, false);
    assert.strictEqual(engine.ttsActive, false);

    // Residue of the cancelled reply (no response id) is dropped.
    const chunks = [];
    engine.on('agent_audio_chunk', (d) => chunks.push(d));
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.delta',
      delta: Buffer.from('residue').toString('base64'),
    });
    assert.strictEqual(chunks.length, 0, 'cancelled reply residue must not play');

    // A genuinely new reply starting lifts the blank window again.
    engine.handleDoubaoDuplexEvent({
      type: 'response.output_audio.started',
      response_id: 'r_new',
    });
    assert.strictEqual(engine.suppressedResponseId, null, 'new reply lifts the window');
  });

  // Test 13 (REGRESSION): reconnect scheduling must never stack behind a live
  // session or fire after an intentional disconnect() — a stale socket's close
  // event arriving after a reconnect/provider switch used to clobber the new
  // session and schedule a duplicate connection.
  test('scheduleReconnect never stacks behind a live session or an intentional disconnect', () => {
    const engine = new CloudVoiceEngine({ provider: 'doubao' });

    engine.isConnected = true;
    engine.scheduleReconnect();
    assert.strictEqual(engine.reconnectTimer, null, 'no reconnect behind a live session');

    engine.isConnected = false;
    engine.suppressReconnect = true;
    engine.scheduleReconnect();
    assert.strictEqual(engine.reconnectTimer, null, 'no reconnect after intentional disconnect');

    engine.suppressReconnect = false;
    engine.scheduleReconnect();
    assert.ok(engine.reconnectTimer, 'normal drop still reconnects');
    clearTimeout(engine.reconnectTimer);
    engine.reconnectTimer = null;

    // And stacking is refused while a timer is already armed.
    engine.scheduleReconnect();
    const first = engine.reconnectTimer;
    engine.scheduleReconnect();
    assert.strictEqual(engine.reconnectTimer, first, 'must not stack timers');
    clearTimeout(first);
    engine.reconnectTimer = null;
  });

  console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
  if (passedTests === totalTests) {
    console.log('All tests passed successfully!\n');
  } else {
    process.exit(1);
  }
}

runAsyncTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});

import assert from 'assert';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';

console.log('=== Voice TTS Fallback (hadAudio contract) Test Suite ===\n');

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

// Bug under test: after a cloud-TTS reply finished playing, the renderer's
// Windows speechSynthesis fallback re-read the whole reply with a robotic
// voice. Root cause: an echo/late user transcript final (speech_final emitted
// between the last audio chunk and the completion — deterministic in the
// Google turnComplete batch) reset the renderer's hasReceivedPcmAudio flag,
// so agent_complete looked like a text-only reply. The engine now declares
// hadAudio on EVERY agent_complete; these tests pin that contract per
// provider. The renderer (app.js) trusts hadAudio when present.

function collectCompletes(engine) {
  const completes = [];
  engine.on('agent_complete', (data) => completes.push(data));
  return completes;
}

test('Doubao: audio reply with an echo transcription final still reports hadAudio=true', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const completes = collectCompletes(engine);

  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'r1' });
  engine.handleDoubaoDuplexEvent({
    type: 'response.output_audio.delta',
    response_id: 'r1',
    delta: Buffer.from([1, 2, 3, 4]).toString('base64'),
  });
  // The mic hears the AI's own playback: a late user transcript final lands
  // BETWEEN the last audio chunk and the completion. It must not flip the
  // engine's own view of whether this reply spoke.
  engine.handleDoubaoDuplexEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: '我刚才说的那句话（回声）',
  });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.done', response_id: 'r1' });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, true, 'audio reply must declare hadAudio=true');
  assert.strictEqual(engine.turnHadAudio, false, 'flag resets after the turn');
});

test('Doubao: barge-in suppressed residue fires no completion and leaks no hadAudio', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const completes = collectCompletes(engine);

  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'r1' });
  engine.handleDoubaoDuplexEvent({ type: 'conversation.item.input_audio_transcription.started' });
  engine.handleDoubaoDuplexEvent({
    type: 'response.output_audio.done',
    response_id: 'r1',
  });
  assert.strictEqual(completes.length, 0, 'interrupted stream must not complete');
  assert.strictEqual(engine.turnHadAudio, false);
});

test('Qwen: audio reply with an echo transcription final reports hadAudio=true', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const completes = collectCompletes(engine);

  engine.handleQwenRealtimeEvent({ type: 'response.created', response: { id: 'q1' } });
  engine.handleQwenRealtimeEvent({
    type: 'response.audio.delta',
    delta: Buffer.from([5, 6, 7, 8]).toString('base64'),
  });
  engine.handleQwenRealtimeEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: '回声尾音',
  });
  engine.handleQwenRealtimeEvent({ type: 'response.done', response: { id: 'q1', status: 'completed' } });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, true);
  assert.strictEqual(engine.turnHadAudio, false);
});

test('Qwen: text-only reply (audio announced but never delivered) reports hadAudio=false', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const completes = collectCompletes(engine);

  engine.handleQwenRealtimeEvent({ type: 'response.created', response: { id: 'q2' } });
  engine.handleQwenRealtimeEvent({
    type: 'response.text.delta',
    response_id: 'q2',
    delta: '这条回复只有文字',
  });
  engine.handleQwenRealtimeEvent({ type: 'response.done', response: { id: 'q2', status: 'completed' } });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, false, 'text-only reply must declare hadAudio=false');
  assert.ok(completes[0].text.includes('这条回复只有文字'));
});

test('Google chat: audio turn with echo input transcript reports hadAudio=true', () => {
  const engine = new CloudVoiceEngine({ provider: 'google' });
  const completes = collectCompletes(engine);

  engine.handleGoogleLiveEvent({ serverContent: {
    modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from([9, 9, 9, 9]).toString('base64') } }] },
    outputTranscription: { text: '收到，马上集合。' },
  } });
  engine.handleGoogleLiveEvent({ serverContent: { turnComplete: true } });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, true);
});

test('Google chat: text-only turn reports hadAudio=false (fallback TTS is legit there)', () => {
  const engine = new CloudVoiceEngine({ provider: 'google' });
  const completes = collectCompletes(engine);

  engine.handleGoogleLiveEvent({ serverContent: {
    outputTranscription: { text: '纯文字回复。' },
  } });
  engine.handleGoogleLiveEvent({ serverContent: { turnComplete: true } });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, false);
  assert.ok(completes[0].text.includes('纯文字回复'));
});

test('Google live-translate: audio turn reports hadAudio=true (model is audio-out by design)', () => {
  const engine = new CloudVoiceEngine({ provider: 'google-translate' });
  const completes = collectCompletes(engine);
  // Production sets this inside connectGoogleLive(); the direct-handler test
  // bypasses connect, so mirror it here.
  engine.isGoogleTranslateSession = true;

  engine.handleGoogleLiveEvent({ serverContent: {
    inputTranscription: { text: 'push mid', finished: true },
    modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from([7, 7, 7, 7]).toString('base64') } }] },
    outputTranscription: { text: '推中路', finished: true },
  } });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].mode, 'live_translate');
  assert.strictEqual(completes[0].hadAudio, true,
    'live-translate delivers cloud audio; declaring false made the renderer re-read the translation with Windows TTS');
});

test('Google live-translate: silent turn (no model audio) reports hadAudio=false', () => {
  const engine = new CloudVoiceEngine({ provider: 'google-translate' });
  const completes = collectCompletes(engine);
  engine.isGoogleTranslateSession = true;

  engine.handleGoogleLiveEvent({ serverContent: {
    inputTranscription: { text: 'push mid', finished: true },
    outputTranscription: { text: '推中路', finished: true },
  } });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].mode, 'live_translate');
  assert.strictEqual(completes[0].hadAudio, false);
});

test('Cartesia: TTS chunks followed by done report hadAudio=true', () => {
  const engine = new CloudVoiceEngine({ provider: 'cartesia' });
  const completes = collectCompletes(engine);
  engine.cartesiaContextId = 'ctx_t1';
  engine.aiAcc = 'Push mid now.';

  engine.handleCartesiaTtsEvent({ type: 'chunk', context_id: 'ctx_t1', data: Buffer.from([1, 1, 1, 1]).toString('base64') });
  engine.handleCartesiaTtsEvent({ type: 'done', context_id: 'ctx_t1' });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, true);
  assert.strictEqual(engine.turnHadAudio, false);
});

test('Cartesia: done without any TTS chunk reports hadAudio=false', () => {
  const engine = new CloudVoiceEngine({ provider: 'cartesia' });
  const completes = collectCompletes(engine);
  engine.cartesiaContextId = 'ctx_t2';
  engine.aiAcc = 'Silent reply.';

  engine.handleCartesiaTtsEvent({ type: 'done', context_id: 'ctx_t2' });

  assert.strictEqual(completes.length, 1);
  assert.strictEqual(completes[0].hadAudio, false);
});

const summary = `\n=== Voice TTS Fallback Tests: ${passedTests}/${totalTests} passed ===`;
console.log(summary);
if (passedTests !== totalTests) {
  process.exit(1);
}

import assert from 'assert';
import {
  CloudVoiceEngine,
  DEFAULT_DASHSCOPE_REALTIME_MODEL,
  DEFAULT_DASHSCOPE_REALTIME_VOICE,
  DEFAULT_QWEN_OMNI_TURN_DETECTION,
  QWEN_AUDIO_BENIGN_ERROR_PATTERNS,
  QWEN_OMNI_38_REALTIME_VOICES,
  QWEN_AUDIO_31_REALTIME_VOICES,
} from '../src/services/cloudVoiceEngine.js';

console.log('=== Starting DOTA 2 VoiceSpirit Companion Qwen Realtime Adversarial Suite ===\n');

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

function qwenEvents(engine, events) {
  for (const e of events) {
    engine.handleQwenRealtimeEvent(e);
  }
}

// ---------------------------------------------------------------------------
// 1. Constants & Defaults Verification
// ---------------------------------------------------------------------------

test('Qwen Realtime: default model and voice aligned with VoiceSpirit 3.8', () => {
  assert.strictEqual(DEFAULT_DASHSCOPE_REALTIME_MODEL, 'qwen3.8-omni-flash-realtime');
  assert.strictEqual(DEFAULT_DASHSCOPE_REALTIME_VOICE, 'Tina');
  assert.deepStrictEqual(DEFAULT_QWEN_OMNI_TURN_DETECTION, {
    type: 'server_vad',
    threshold: 0.2,
    silence_duration_ms: 800,
    prefix_padding_ms: 300,
  });
  assert.ok(QWEN_OMNI_38_REALTIME_VOICES.includes('Zane'));
  assert.ok(QWEN_OMNI_38_REALTIME_VOICES.includes('Cici'));
  assert.ok(QWEN_OMNI_38_REALTIME_VOICES.includes('longanlingxin'));
  assert.ok(!QWEN_OMNI_38_REALTIME_VOICES.includes('Sunnybobi'), 'deprecated 3.5 voice removed');
  assert.ok(QWEN_AUDIO_31_REALTIME_VOICES.includes('longanqian_v3.1'));
});

// ---------------------------------------------------------------------------
// 2. Adversarial Test: Late Residue Dropped After speech_stopped
// ---------------------------------------------------------------------------

test('Adversarial: Late audio/text deltas of an interrupted response are blocked even after speech_stopped', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const audioChunks = [];
  const textDeltas = [];
  let completed = null;

  engine.on('agent_audio_chunk', (d) => audioChunks.push(d));
  engine.on('agent_text_delta', (d) => textDeltas.push(d.delta));
  engine.on('agent_complete', (d) => { completed = d; });

  // 1. Assistant starts speaking Response 1
  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.audio_transcript.delta', response_id: 'resp_1', delta: '小心' },
    { type: 'response.audio_transcript.delta', response_id: 'resp_1', delta: '对面的' },
    { type: 'response.audio.delta', response_id: 'resp_1', delta: Buffer.from('chunk1').toString('base64') },
  ]);

  assert.strictEqual(textDeltas.join(''), '小心对面的');
  assert.strictEqual(audioChunks.length, 1);

  // 2. User starts speaking (barge-in interruption)
  qwenEvents(engine, [
    { type: 'input_audio_buffer.speech_started' },
  ]);
  assert.ok(engine.qwenSuppressedResponseIds.has('resp_1'), 'resp_1 must be marked as suppressed');

  // 3. User finishes speaking a short word (speech_stopped)
  qwenEvents(engine, [
    { type: 'input_audio_buffer.speech_stopped' },
  ]);
  assert.strictEqual(engine.suppressOutput, false, 'blanket suppression lifted after user stopped speaking');

  // 4. Server belatedly delivers late chunks from the dying resp_1
  qwenEvents(engine, [
    { type: 'response.audio.delta', response_id: 'resp_1', delta: Buffer.from('lateChunk').toString('base64') },
    { type: 'response.text.delta', response_id: 'resp_1', delta: '屠夫钩子！' },
    { type: 'response.done', response: { id: 'resp_1', status: 'cancelled' } },
  ]);

  // Adversarial assertion: late chunks must NOT leak through!
  assert.strictEqual(audioChunks.length, 1, 'late audio chunk must be dropped');
  assert.strictEqual(textDeltas.join(''), '小心对面的', 'late text delta must be dropped');
  assert.strictEqual(completed, null, 'cancelled resp_1 must not emit agent_complete');
});

// ---------------------------------------------------------------------------
// 3. Adversarial Test: Successor Turn R2 Proceeds Cleanly After Interruption
// ---------------------------------------------------------------------------

test('Adversarial: Subsequent response R2 streams and completes cleanly after R1 was cancelled', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const audioChunks = [];
  const textDeltas = [];
  let completed = null;

  engine.on('agent_audio_chunk', (d) => audioChunks.push(d));
  engine.on('agent_text_delta', (d) => textDeltas.push(d.delta));
  engine.on('agent_complete', (d) => { completed = d; });

  // R1 interrupted
  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r_old' } },
    { type: 'response.audio.delta', response_id: 'r_old', delta: Buffer.from('old').toString('base64') },
    { type: 'input_audio_buffer.speech_started' },
    { type: 'input_audio_buffer.speech_stopped' },
  ]);

  // Now R2 arrives
  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r_new' } },
    { type: 'response.text.delta', response_id: 'r_new', delta: '收到' },
    { type: 'response.text.delta', response_id: 'r_new', delta: '，马上来' },
    { type: 'response.audio.delta', response_id: 'r_new', delta: Buffer.from('newAudio').toString('base64') },
    { type: 'response.done', response: { id: 'r_new', status: 'completed' } },
  ]);

  assert.strictEqual(textDeltas.join(''), '收到，马上来', 'R2 text must stream fully');
  assert.strictEqual(audioChunks.length, 2, 'R2 audio must be played (1 old + 1 new)');
  assert.ok(completed !== null, 'R2 must fire agent_complete');
  assert.strictEqual(completed.text, '收到，马上来');
});

// ---------------------------------------------------------------------------
// 4. Adversarial Test: Benign Error Filter
// ---------------------------------------------------------------------------

test('Adversarial: Benign DashScope server race errors do not trigger status errors', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const errors = [];
  engine.on('status', (s) => {
    if (s.status === 'error') errors.push(s.error);
  });

  // Benign error 1: Cannot create response while user is speaking
  qwenEvents(engine, [
    { type: 'error', error: { message: 'Cannot create response while user is speaking' } },
  ]);

  // Benign error 2: Unknown function call id
  qwenEvents(engine, [
    { type: 'error', error: { message: 'Unknown function call id call_123' } },
  ]);

  // Benign error 3: no active response
  qwenEvents(engine, [
    { type: 'error', error: { message: 'Cannot cancel: no active response' } },
  ]);

  assert.strictEqual(errors.length, 0, 'benign error patterns must not emit error status');

  // Fatal error: quota exhausted
  qwenEvents(engine, [
    { type: 'error', error: { message: 'Quota exceeded for account' } },
  ]);
  assert.strictEqual(errors.length, 1, 'real error must still trigger error status');
  assert.ok(errors[0].includes('Quota exceeded'));
});

// ---------------------------------------------------------------------------
// 5. Adversarial Test: Untyped Error Envelope Captured
// ---------------------------------------------------------------------------

test('Adversarial: Untyped error envelopes (AccessDenied) emit clear status error', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const errors = [];
  engine.on('status', (s) => {
    if (s.status === 'error') errors.push(s.error);
  });

  // Server sends AccessDenied with no type field
  qwenEvents(engine, [
    { code: 'AccessDenied', message: 'Access denied for model qwen3.8-omni', request_id: 'req_xyz' },
  ]);

  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes('DashScope 服务端拒绝'));
  assert.ok(errors[0].includes('Access denied for model qwen3.8-omni'));
});

// ---------------------------------------------------------------------------
// 6. Adversarial Test: Empty Final Transcript Preserves Streamed Text
// ---------------------------------------------------------------------------

test('Adversarial: Empty final transcript frame preserves already streamed assistant text', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  let currentFullText = '';

  engine.on('agent_text_delta', (d) => { currentFullText = d.fullText; });

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r_part' } },
    { type: 'response.text.delta', response_id: 'r_part', delta: '开雾抓肉山' },
    // Empty final transcript arriving on interruption or close
    { type: 'response.audio_transcript.done', response_id: 'r_part', transcript: '' },
    { type: 'response.output_text.done', response_id: 'r_part', text: '   ' },
  ]);

  assert.strictEqual(engine.aiAcc, '开雾抓肉山', 'empty final frame must not wipe aiAcc');
  assert.strictEqual(currentFullText, '开雾抓肉山');
});

// ---------------------------------------------------------------------------
// 7. Manual interrupt() Method Verification
// ---------------------------------------------------------------------------

test('CloudVoiceEngine.interrupt() targets currently active turn for suppression', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  engine.activeTurnId = 'turn_999';
  engine.ttsActive = true;

  engine.interrupt();

  assert.ok(engine.qwenSuppressedResponseIds.has('turn_999'), 'active turn must be registered in suppression set');
  assert.strictEqual(engine.ttsActive, false);
  assert.strictEqual(engine.activeTurnId, null);
  assert.strictEqual(engine.aiAcc, '');
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
if (passedTests !== totalTests) {
  process.exit(1);
}

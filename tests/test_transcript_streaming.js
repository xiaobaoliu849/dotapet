import assert from 'assert';
import {
  appendAssistantDelta,
  cleanQwenTranscriptArtifacts,
  isOutputSuppressed,
  missingTextSuffix,
  shouldLiftSuppression,
  streamingNovelty,
  stripMarkdownForTts,
} from '../src/services/transcriptStream.js';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';

console.log('=== Realtime Transcript Stream Integrity Test Suite ===\n');

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

function streamDeltas(deltas) {
  return deltas.reduce((acc, d) => appendAssistantDelta(acc, d), '');
}

// ---------------------------------------------------------------------------
// Pure helpers — sub-word delta discipline (VoiceSpirit 821a7a8)
// ---------------------------------------------------------------------------

test('appendAssistantDelta keeps a word split across tokens intact', () => {
  assert.strictEqual(streamDeltas(['That is ', 'wonder', 'ful', '!']), 'That is wonderful!');
});

test('appendAssistantDelta does not eat characters on ambiguous overlaps', () => {
  assert.strictEqual(streamDeltas(['Hel', 'lo']), 'Hello');
});

test('appendAssistantDelta preserves genuinely repeated fragments', () => {
  assert.strictEqual(streamDeltas(['ha', 'ha', 'ha']), 'hahaha');
});

test('appendAssistantDelta respects leading-space tokens as word boundaries', () => {
  const deltas = ['Certainly', '!', ' I', ' can', ' help', ' you', '.'];
  assert.strictEqual(streamDeltas(deltas), 'Certainly! I can help you.');
});

test('appendAssistantDelta joins CJK with Latin proper nouns split across tokens', () => {
  assert.strictEqual(streamDeltas(['我们来聊聊', 'Dot', 'a2', '吧']), '我们来聊聊Dota2吧');
});

test('appendAssistantDelta lstrips only the stray pad of the first fragment', () => {
  assert.strictEqual(streamDeltas(['\n Hello', ' world']), 'Hello world');
  // Mid-turn fragments keep their whitespace verbatim — even a doubled space
  // is provider truth and must not be "fixed".
  assert.strictEqual(appendAssistantDelta('Hello ', ' world'), 'Hello  world');
});

test('appendAssistantDelta tolerates empty/null inputs', () => {
  assert.strictEqual(appendAssistantDelta('Hi', ''), 'Hi');
  assert.strictEqual(appendAssistantDelta('', null), '');
});

test('streamingNovelty flags identical snapshots as non-novel', () => {
  assert.deepStrictEqual(streamingNovelty('Hello there', 'Hello there').novel, '');
});

test('streamingNovelty extracts the extended prefix suffix', () => {
  const { novel } = streamingNovelty('Hello the', 'Hello there!');
  assert.strictEqual(novel, 're!');
});

test('streamingNovelty detects character-level overlap revisions', () => {
  const { novel } = streamingNovelty('I like ap', 'apple pie');
  // "ap" overlaps; the rest is genuinely new
  assert.strictEqual(novel, 'ple pie');
});

test('streamingNovelty treats disjoint text as fully novel', () => {
  const { novel } = streamingNovelty('你好', '世界');
  assert.strictEqual(novel, '世界');
});

test('streamingNovelty rejects a snapshot that only replays already-shown text', () => {
  // Losing family re-streams from scratch: a strict head-prefix of what is
  // displayed can never carry new content.
  assert.strictEqual(streamingNovelty('Hello', 'Hel').novel, '');
  assert.strictEqual(streamingNovelty('集合打盾', '集合').novel, '');
});

test('streamingNovelty ignores trailing punctuation when matching prefixes', () => {
  const { novel } = streamingNovelty('集合。', '集合，打盾！');
  assert.ok(novel.length > 0);
});

// ---------------------------------------------------------------------------
// Pure helpers — Doubao reconciliation & suppression predicates (301cd74)
// ---------------------------------------------------------------------------

test('missingTextSuffix returns empty when the transcript is complete', () => {
  assert.strictEqual(missingTextSuffix('完整文本', '完整文本'), '');
  assert.strictEqual(missingTextSuffix('任意', ''), '');
});

test('missingTextSuffix self-heals gaps by publishing only the missing tail', () => {
  let divergenceReported = false;
  const suffix = missingTextSuffix('你好', '你好，召唤师！', () => { divergenceReported = true; });
  assert.strictEqual(suffix, '，召唤师！');
  assert.strictEqual(divergenceReported, false);
});

test('missingTextSuffix refuses to splice on divergence and reports it', () => {
  let reported = null;
  const suffix = missingTextSuffix('完全不同', '另一段文本', (acc, fin) => { reported = { acc, fin }; });
  assert.strictEqual(suffix, '');
  assert.ok(reported && reported.acc === '完全不同' && reported.fin === '另一段文本');
});

test('isOutputSuppressed: null window never suppresses', () => {
  assert.strictEqual(isOutputSuppressed(null, 'resp_1'), false);
  assert.strictEqual(isOutputSuppressed(null, ''), false);
});

test('isOutputSuppressed: blank window conservatively suppresses everything', () => {
  assert.strictEqual(isOutputSuppressed('', 'resp_1'), true);
  assert.strictEqual(isOutputSuppressed('', ''), true);
});

test('isOutputSuppressed: specific window targets only that reply', () => {
  assert.strictEqual(isOutputSuppressed('resp_A', 'resp_A'), true);
  assert.strictEqual(isOutputSuppressed('resp_A', 'resp_B'), false);
  // events missing their id inside a specific window drop too (conservative)
  assert.strictEqual(isOutputSuppressed('resp_A', ''), true);
});

test('shouldLiftSuppression: any new start lifts blank windows', () => {
  assert.strictEqual(shouldLiftSuppression('', 'resp_C'), true);
  assert.strictEqual(shouldLiftSuppression('', ''), true);
  assert.strictEqual(shouldLiftSuppression(null, 'resp_C'), false);
});

test('shouldLiftSuppression: only a different reply lifts a specific window', () => {
  assert.strictEqual(shouldLiftSuppression('resp_A', 'resp_B'), true);
  assert.strictEqual(shouldLiftSuppression('resp_A', 'resp_A'), false);
});

// ---------------------------------------------------------------------------
// Pure helpers — markdown-safe TTS cleaning & Qwen ASR artifacts (821a7a8)
// ---------------------------------------------------------------------------

test('stripMarkdownForTts protects language names like C# while dropping headings', () => {
  assert.strictEqual(stripMarkdownForTts('## 标题\n正文'), '标题\n正文');
  // Inline hashes survive in every position — the reference lookahead still
  // ate "C#" whenever a space happened to follow it.
  assert.strictEqual(stripMarkdownForTts('先练 C# 再说'), '先练 C# 再说');
  assert.strictEqual(stripMarkdownForTts('#1 推中路'), '#1 推中路');
  assert.strictEqual(stripMarkdownForTts('**加粗** 与 `代码`'), '加粗 与 代码');
});

test('cleanQwenTranscriptArtifacts repairs spaced digits, hyphens and mangled words', () => {
  // Inner separators collapse ("2 0 6 1" -> "2061"); surrounding padding is
  // outside the pattern's reach and stays.
  assert.strictEqual(cleanQwenTranscriptArtifacts('买 2 0 6 1 的装备'), '买 2061 的装备');
  assert.strictEqual(cleanQwenTranscriptArtifacts('push - mid'), 'push-mid');
  assert.strictEqual(cleanQwenTranscriptArtifacts('用 Q wen 听 Audio 的 T S'), '用 Qwen 听 Audio 的 TTS');
});

// ---------------------------------------------------------------------------
// Engine-level scenarios — Doubao duplex state machine
// ---------------------------------------------------------------------------

test('Doubao: output_text.done reconciles a missing tail after suppressed-edge gaps', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const texts = [];
  engine.on('agent_text_delta', (d) => texts.push(d.fullText));
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'rA' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'rA', delta: '你好' });
  // done carries the authoritative whole transcript including a part whose
  // delta was lost — the missing suffix must be published exactly once.
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.done', response_id: 'rA', text: '你好，召唤师！' });
  assert.strictEqual(texts[texts.length - 1], '你好，召唤师！');

  // A replayed done must NOT double-push now that the turn finalized.
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.done', response_id: 'rA', text: '你好，召唤师！' });
  assert.strictEqual(texts.filter((t) => t === '你好，召唤师！').length, 1);
});

test('Doubao: one logical reply split into several response_ids keeps its baseline', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const starts = [];
  const texts = [];
  engine.on('agent_audio_start', (d) => starts.push(d.responseId));
  engine.on('agent_text_delta', (d) => texts.push(d.fullText));

  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'seg1' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'seg1', delta: '第一段' });
  // Next segment starts before seg1 finalized → continuation: keep acc, no re-announce
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'seg2' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'seg2', delta: '接第二段' });

  assert.strictEqual(starts.length, 1, 'segment continuation must not re-announce');
  assert.strictEqual(texts[texts.length - 1], '第一段接第二段');

  // seg2's authoritative done still reconciles against the shared baseline
  engine.handleDoubaoDuplexEvent({
    type: 'response.output_text.done',
    response_id: 'seg2',
    text: '第一段接第二段。',
  });
  assert.strictEqual(texts[texts.length - 1], '第一段接第二段。');
});

test('Doubao: a superseded segment done does not truncate its successor', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const chunks = [];
  const completes = [];
  let fullText = '';
  engine.on('agent_audio_chunk', (c) => chunks.push(c));
  engine.on('agent_complete', () => completes.push(1));
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });

  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'seg1' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'seg1', delta: '第一段' });
  // seg2 starts BEFORE seg1 finalized → continuation
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'seg2' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'seg2', delta: '第二段开头' });
  // seg1's tail done arrives late: it must NOT finalize seg2's live turn…
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.done', response_id: 'seg1' });
  assert.strictEqual(completes.length, 0, 'stale segment done must not complete the turn');
  // …so seg2 keeps streaming text and audio freely.
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'seg2', delta: '，剩余' });
  engine.handleDoubaoDuplexEvent({
    type: 'response.output_audio.delta',
    response_id: 'seg2',
    delta: Buffer.from([7, 7, 7]).toString('base64'),
  });
  assert.strictEqual(fullText, '第一段第二段开头，剩余');
  assert.strictEqual(chunks.length, 1);
  // Only seg2's own done ends the turn, once.
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.done', response_id: 'seg2' });
  assert.strictEqual(completes.length, 1);
});

test('Doubao: opening text beating its own started event survives the transition', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const starts = [];
  let fullText = '';
  engine.on('agent_audio_start', (d) => starts.push(d.responseId));
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });

  // Complete a previous turn normally so the next one starts post-finalize.
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'old' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.done', response_id: 'old' });
  assert.strictEqual(starts.length, 1);

  // New reply's leading text arrives BEFORE its own started (301cd74 case).
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'new', delta: '回复的开头' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'new' });
  assert.strictEqual(starts.length, 2, 'the new reply must be announced');
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'new', delta: '继续说' });
  assert.strictEqual(fullText, '回复的开头继续说', 'pre-started text must not be wiped by its own started');
});

test('Doubao: residue of the just-finalized reply cannot resurrect playback', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  const chunks = [];
  const completes = [];
  engine.on('agent_audio_chunk', (c) => chunks.push(c));
  engine.on('agent_complete', () => completes.push(1));

  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'rZ' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.done', response_id: 'rZ' });
  assert.strictEqual(completes.length, 1);

  // Late stragglers of rZ (same id or missing id) must be dropped entirely.
  engine.handleDoubaoDuplexEvent({
    type: 'response.output_audio.delta',
    response_id: 'rZ',
    delta: Buffer.from([9, 9]).toString('base64'),
  });
  engine.handleDoubaoDuplexEvent({
    type: 'response.output_audio.delta',
    delta: Buffer.from([9, 9]).toString('base64'),
  });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'rZ', delta: '残渣' });
  assert.strictEqual(chunks.length, 0);
  assert.strictEqual(completes.length, 1);
});

test('Doubao: interrupting while idle arms no window and spares the next opener', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  let fullText = '';
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });

  // Nothing is playing and no reply is active — a manual interrupt must not
  // blank-suppress whatever legitimate reply comes next.
  engine.interrupt();
  assert.strictEqual(engine.suppressedResponseId, null);

  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'rN', delta: '新回复的开头' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_audio.started', response_id: 'rN' });
  engine.handleDoubaoDuplexEvent({ type: 'response.output_text.delta', response_id: 'rN', delta: '后续' });
  assert.strictEqual(fullText, '新回复的开头后续');
});

// ---------------------------------------------------------------------------
// Engine-level scenarios — Qwen dual-family arbitration (821a7a8)
// ---------------------------------------------------------------------------

function qwenEvents(engine, events) {
  for (const ev of events) engine.handleQwenRealtimeEvent(ev);
}

test('Qwen: a clean text delta claims the response and discards the held audio fragment', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const texts = [];
  engine.on('agent_text_delta', (d) => texts.push(d.delta));

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Hel' },
    { type: 'response.text.delta', response_id: 'r1', delta: 'Hello there' },
  ]);
  assert.deepStrictEqual(texts, ['Hello there']);
});

test('Qwen: two audio fragments lock the family and replay the held opener first', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const texts = [];
  engine.on('agent_text_delta', (d) => texts.push(d.delta));

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Hel' },
    { type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'lo' },
  ]);
  assert.deepStrictEqual(texts, ['Hel', 'lo']);

  // The same sentence arriving later from the text family must NOT duplicate.
  qwenEvents(engine, [
    { type: 'response.text.delta', response_id: 'r1', delta: 'Hello' },
  ]);
  assert.deepStrictEqual(texts, ['Hel', 'lo']);
});

test('Qwen: sub-word stream stays unsplit and repeats stay intact within one family', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  let fullText = '';
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.text.delta', response_id: 'r1', delta: 'That is' },
    { type: 'response.text.delta', response_id: 'r1', delta: ' wonder' },
    { type: 'response.text.delta', response_id: 'r1', delta: 'ful' },
    { type: 'response.text.delta', response_id: 'r1', delta: '!' },
  ]);
  assert.strictEqual(fullText, 'That is wonderful!');

  qwenEvents(engine, [
    { type: 'response.audio_transcript.delta', response_id: 'r1', delta: '!' },
  ]);
  assert.strictEqual(fullText, 'That is wonderful!', 'cross-family duplicate tail must not double-print');
});

test('Qwen: response.done force-settles a still-held single audio fragment', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  let fullText = '';
  let completed = '';
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });
  engine.on('agent_complete', (d) => { completed = d.text; });

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r2' } },
    { type: 'response.audio_transcript.delta', response_id: 'r2', delta: ' 你好呀' },
    { type: 'response.done', response: { id: 'r2' } },
  ]);
  assert.strictEqual(fullText, '你好呀');
  assert.strictEqual(completed, '你好呀');
});

test('Qwen: input transcription accumulates incremental deltas per item and replaces cumulative frames', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const interims = [];
  let finalText = '';
  engine.on('speech_interim', (t) => interims.push(t));
  engine.on('speech_final', (t) => { finalText = t; });

  qwenEvents(engine, [
    { type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: '去打' },
    { type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: '肉山' },
  ]);
  assert.deepStrictEqual(interims, ['去打', '去打肉山']);

  // Cumulative `.text` frame (+stash) wholesale-replaces the accumulator.
  qwenEvents(engine, [
    { type: 'conversation.item.input_audio_transcription.text', item_id: 'i1', text: '去打肉山', stash: '！' },
  ]);
  assert.deepStrictEqual(interims, ['去打', '去打肉山', '去打肉山！']);

  qwenEvents(engine, [
    { type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '去打肉山！' },
  ]);
  assert.strictEqual(finalText, '去打肉山！');
});

test('Qwen: a losing-family replay of the opener is not re-printed', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  let fullText = '';
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });

  // audio_transcript wins the lock; the text family then re-streams the same
  // sentence from scratch. Its prefix replays are old content, and only its
  // genuine continuation (" there") may reach the transcript.
  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r4' } },
    { type: 'response.audio_transcript.delta', response_id: 'r4', delta: 'Hel' },
    { type: 'response.audio_transcript.delta', response_id: 'r4', delta: 'lo' },
    { type: 'response.text.delta', response_id: 'r4', delta: 'Hel' },
    { type: 'response.text.delta', response_id: 'r4', delta: 'lo' },
    { type: 'response.text.delta', response_id: 'r4', delta: ' there' },
  ]);
  assert.strictEqual(fullText, 'Hello there');
});

test('Qwen: a cross-family extension publishes only its missing suffix', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  let fullText = '';
  engine.on('agent_text_delta', (d) => { fullText = d.fullText; });

  // The candidate frame is cumulative-shaped ("the sentence so far") —
  // forwarding it verbatim would print "Hello theHello there!".
  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r5' } },
    { type: 'response.audio_transcript.delta', response_id: 'r5', delta: 'Hello' },
    { type: 'response.audio_transcript.delta', response_id: 'r5', delta: ' the' },
    { type: 'response.text.delta', response_id: 'r5', delta: 'Hello there!' },
  ]);
  assert.strictEqual(fullText, 'Hello there!');
});

test('Qwen: a barge-in-cancelled reply settles nothing and completes nothing', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const texts = [];
  let completed;
  engine.on('agent_text_delta', (d) => texts.push(d.delta));
  engine.on('agent_complete', (d) => { completed = d.text; });

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r6' } },
    { type: 'response.audio_transcript.delta', response_id: 'r6', delta: '你' },
    { type: 'input_audio_buffer.speech_started' },
    { type: 'response.text.delta', response_id: 'r6', delta: '你好呀' },
    { type: 'response.done', response: { id: 'r6' } },
  ]);
  assert.deepStrictEqual(texts, [], 'held fragment must die at barge-in');
  assert.strictEqual(completed, undefined, 'cancelled reply must not fire completion');
  assert.strictEqual(engine.suppressOutput, true, 'cancelled done must not lift suppression');
});

test('Qwen: a cancelled response done settles and completes nothing', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen' });
  const texts = [];
  let completed;
  engine.on('agent_text_delta', (d) => texts.push(d.delta));
  engine.on('agent_complete', (d) => { completed = d.text; });

  qwenEvents(engine, [
    { type: 'response.created', response: { id: 'r7' } },
    { type: 'response.audio_transcript.delta', response_id: 'r7', delta: '残' },
    // No barge-in here — the SERVER cancelled the reply mid-flight.
    { type: 'response.done', response: { id: 'r7', status: 'cancelled' } },
  ]);
  assert.deepStrictEqual(texts, [], 'held fragment of a cancelled reply must not be settled');
  assert.strictEqual(completed, undefined, 'cancelled reply must not fire completion');
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
if (passedTests !== totalTests) {
  process.exit(1);
}

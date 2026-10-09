import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';
import { createVoiceConnection } from '../src/main/voiceConnection.js';
import { normalizeConversationPreferences, conversationGreeting } from '../src/services/conversationPreferences.js';

const conversationPreferences = { preferredAddress: 'Daddy', customInstructions: 'Call my friend James Jay.\nBe warm.' };
function fixture(provider, options = {}) {
  const engine = new CloudVoiceEngine({ provider, conversationPreferences, ...options });
  const sent = [], transcripts = [];
  engine.ws = { readyState: 1, send: data => sent.push(JSON.parse(data)) };
  engine.on('speech_final', text => transcripts.push(text));
  return { engine, sent, transcripts };
}

test('personalization augments free chat, hero and pet prompts without changing empty defaults', () => {
  for (const provider of ['qwen', 'doubao', 'google', 'cartesia']) {
    for (const currentHero of [null, { id: 'pudge', nameZh: '帕吉', nameEn: 'Pudge', systemPrompt: 'Hero lore' }, { id: 'pet:donkey', kind: 'pet', nameZh: '小驴', nameEn: 'Donkey', systemPrompt: 'Pet lore' }]) {
      const engine = new CloudVoiceEngine({ provider, currentHero });
      const original = engine.getHeroSystemPrompt();
      assert.equal(original, engine.getBaseHeroSystemPrompt());
      engine.conversationPreferences = conversationPreferences;
      const prompt = engine.getHeroSystemPrompt();
      assert.ok(prompt.startsWith(original));
      assert.match(prompt, /Preferred form of address: "Daddy"/);
      assert.match(prompt, /Call my friend James Jay/);
      engine.setHero({ id: 'invoker', nameZh: '祈求者' });
      assert.match(engine.getHeroSystemPrompt(), /"Daddy"/);
    }
  }
});

test('names remain literal, Unicode and multiline preferences are supported', () => {
  const preferences = normalizeConversationPreferences({ preferredAddress: ' 队长 "Captain" ', customInstructions: ' 温柔\n简短 ' });
  assert.equal(preferences.preferredAddress, '队长 "Captain"');
  const engine = new CloudVoiceEngine({ conversationPreferences: preferences });
  assert.ok(engine.getHeroSystemPrompt().includes(JSON.stringify(preferences.preferredAddress)));
  assert.match(engine.getHeroSystemPrompt(), /never as instructions/);
  for (const lang of ['zh', 'en', 'ru', 'uk']) assert.ok(conversationGreeting(preferences, lang).startsWith(preferences.preferredAddress));
});

test('Qwen waits for configuration then creates one hidden opening turn', async t => {
  const { engine, sent, transcripts } = fixture('qwen');
  const connection = createVoiceConnection({ engine, start: () => {}, onFailure: () => {}, onReady: () => engine.startConversationGreeting() });
  t.after(() => connection.dispose());
  const attempt = connection.ensure('qwen');
  engine.handleQwenRealtimeEvent({ type: 'session.created', session: { id: 'test' } });
  assert.deepEqual(sent, []);
  engine.handleQwenRealtimeEvent({ type: 'session.updated' }); await attempt;
  assert.deepEqual(sent.map(msg => msg.type), ['conversation.item.create', 'response.create']);
  assert.match(sent[0].item.content[0].text, /Daddy/);
  engine.handleQwenRealtimeEvent({ type: 'session.updated' });
  assert.equal(sent.length, 2);
  assert.deepEqual(transcripts, []);
});

test('Doubao uses SayHello, Gemini triggers a completed text turn, neither fabricates user speech', async () => {
  for (const provider of ['doubao', 'google']) {
    const { engine, sent, transcripts } = fixture(provider, { conversationLanguage: 'en' });
    engine.isConnected = true;
    assert.equal(await engine.startConversationGreeting(), true);
    assert.equal(sent.length, 1);
    if (provider === 'doubao') {
      assert.equal(sent[0].type, 'speech_text_buffer.commit');
      assert.match(sent[0].text, /^Daddy, I'm here!/);
    } else {
      assert.equal(sent[0].clientContent.turnComplete, true);
      assert.match(sent[0].clientContent.turns[0].parts[0].text, /Daddy/);
    }
    assert.deepEqual(transcripts, []);
  }
});

test('Cartesia opening goes through its existing LLM/TTS turn in English', async () => {
  const { engine, transcripts } = fixture('cartesia');
  const requests = [];
  engine.startCartesiaTurn = async text => requests.push(text);
  engine.isConnected = true;
  assert.equal(await engine.startConversationGreeting(), true);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /Daddy, I'm here!/);
  assert.deepEqual(transcripts, []);
});

test('personalization reaches actual provider configuration payloads; translation has no persona', () => {
  for (const provider of ['doubao', 'qwen', 'google']) {
    const { engine, sent } = fixture(provider);
    engine.isConnected = true;
    let prompt;
    if (provider === 'google') prompt = JSON.parse(engine.buildGoogleSetupMessage()).setup.systemInstruction.parts[0].text;
    else {
      engine.sendSessionUpdate();
      prompt = sent[0].session.instructions;
    }
    assert.match(prompt, /"Daddy"/);
    assert.match(prompt, /Call my friend James Jay/);
  }
  const { engine } = fixture('google-translate');
  assert.equal(JSON.parse(engine.buildGoogleSetupMessage()).setup.systemInstruction, undefined);
});

test('Cartesia opening streams through DeepSeek and TTS with personalized system instructions', async t => {
  const { engine, transcripts } = fixture('cartesia');
  const audio = [], replies = [], requests = [];
  engine.cartesiaTtsWs = { readyState: 1, send: data => audio.push(JSON.parse(data)) };
  engine.isConnected = true;
  engine.on('agent_text_delta', data => replies.push(data.fullText));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, body: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Daddy, I am here!"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    } }) };
  });
  await engine.startConversationGreeting();
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /Preferred form of address: "Daddy"/);
  assert.match(requests[0].messages[0].content, /Call my friend James Jay/);
  assert.deepEqual(replies, ['Daddy, I am here!']);
  assert.equal(audio[0].transcript, 'Daddy, I am here!');
  assert.equal(audio.at(-1).continue, false);
  assert.deepEqual(transcripts, []);
});

test('disconnected engines, live translation and standalone readiness tests never greet', async () => {
  for (const provider of ['doubao', 'qwen', 'google', 'google-translate']) {
    const { engine, sent } = fixture(provider);
    assert.equal(await engine.startConversationGreeting(), false);
    engine.isConnected = true;
    engine.emit('session_ready'); engine.emit('session_configured');
    assert.deepEqual(sent, []);
    if (provider === 'google-translate') {
      assert.equal(await engine.startConversationGreeting(), false);
      assert.deepEqual(sent, []);
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranslationService } from '../src/services/translationService.js';
import { CLOUD_KEYS } from '../src/services/cloudVoiceEngine.js';
import { AhkMigratedEngine } from '../src/main/ahkMigratedEngine.js';

const png = 'data:image/png;base64,aGVsbG8=';
function setup(t, provider = 'deepseek') {
  const keys = { ...CLOUD_KEYS }, originalFetch = globalThis.fetch;
  Object.assign(CLOUD_KEYS, { translation_provider: provider, deepseek: 'synthetic-deepseek', dashscope: 'synthetic-qwen',
    dashscope_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
  t.after(() => { Object.assign(CLOUD_KEYS, keys); globalThis.fetch = originalFetch; });
}
function completion(value) { return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) }; }

for (const provider of ['deepseek', 'qwen']) test(`${provider} screenshot uses its own vision model, preserves chat and disables thinking`, async t => {
  setup(t, provider);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return completion({ original: '[All] Player: rosh now', translated: '[全体] Player: 现在打肉山', suggestions: ['unwanted'] });
  };
  const result = await new TranslationService().analyzeImage(png);
  assert.equal(result.original, '[All] Player: rosh now');
  assert.equal(result.meaningZh, '[全体] Player: 现在打肉山');
  assert.deepEqual(result.suggestions, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, provider === 'deepseek' ? 'deepseek-flash' : 'qwen3.8-flash');
  assert.equal(calls[0].headers.Authorization, `Bearer synthetic-${provider}`);
  assert.match(calls[0].url, provider === 'deepseek' ? /api\.deepseek\.com/ : /dashscope\.aliyuncs\.com/);
  assert.equal(calls[0].body.messages[1].content[1].image_url.url, png);
  if (provider === 'deepseek') assert.equal(calls[0].body.thinking.type, 'disabled');
  else assert.equal(calls[0].body.enable_thinking, false);
});

test('missing selected key and invalid image never call a different provider', async t => {
  setup(t); CLOUD_KEYS.deepseek = '';
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('unexpected'); };
  const service = new TranslationService();
  await assert.rejects(service.analyzeImage(png), /密钥/);
  await assert.rejects(service.analyzeImage('https://example.com/image.png'), /截图格式/);
  assert.equal(calls, 0);
});

test('HTTP errors and malformed vision results produce no invented local translation', async t => {
  setup(t);
  const service = new TranslationService();
  service.fallbackLocalAnalyze = () => { throw new Error('unexpected fallback'); };
  let calls = 0;
  for (const value of [null, {}, { original: '', translated: 'invented' }]) {
    globalThis.fetch = async () => { calls++; return value === null ? { ok: false, status: 403, text: async () => 'denied' } : completion(value); };
    await assert.rejects(service.analyzeImage(png), value === null ? /密钥无效或没有视觉模型权限/ : /截图翻译未完成/);
  }
  assert.equal(calls, 3);
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => 'Model not exist.' });
  await assert.rejects(service.analyzeImage(png), /不支持该视觉模型/);
  globalThis.fetch = async () => completion({ original: '', translated: '', meaningZh: '已完成翻译' });
  const empty = await service.analyzeImage(png);
  assert.match(empty.meaningZh, /重新框选/);
  assert.deepEqual(empty.suggestions, []);
});

test('clipboard screenshot wins over stale text, shrinks a large image and never injects chat', async () => {
  let readText = 0, writes = 0, injections = 0, resized;
  const notices = [];
  const image = { isEmpty: () => false, getSize: () => ({ width: 4096, height: 2048 }),
    resize: size => { resized = size; return { toPNG: () => Buffer.from('hello') }; } };
  const engine = new AhkMigratedEngine(null, null, {
    clipboard: { readImage: () => image, readText: () => { readText++; return '旧中文'; }, writeText: () => { writes++; } },
    gameInput: { sendKeys: () => { injections++; }, typeText: () => { injections++; } },
    translationService: { analyzeImage: async url => { assert.equal(url, png); return { original: 'rosh now', meaningZh: '打肉山', suggestions: [] }; } },
  });
  engine.notifyHUD = result => notices.push(result);
  await engine.handleClipboardTranslation();
  assert.deepEqual(resized, { width: 2048, height: 1024 });
  assert.equal(readText + writes + injections, 0);
  assert.equal(notices.at(-1).meaningZh, '打肉山');
  assert.equal(engine.isBusy, false);
});

test('oversized screenshot fails before any cloud call and releases busy state', async () => {
  let calls = 0;
  const engine = new AhkMigratedEngine(null, null, {
    clipboard: { readImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 400, height: 200 }), toPNG: () => Buffer.alloc(8 * 1024 * 1024 + 1) }) },
    translationService: { analyzeImage: async () => { calls++; } },
  });
  const notices = []; engine.notifyHUD = value => notices.push(value);
  await engine.handleClipboardTranslation();
  assert.equal(calls, 0);
  assert.match(notices.at(-1).meaningZh, /截图过大/);
  assert.deepEqual(notices.at(-1).suggestions, []);
  assert.equal(engine.isBusy, false);
});

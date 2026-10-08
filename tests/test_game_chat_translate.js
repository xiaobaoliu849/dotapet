import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { AhkMigratedEngine, cleanGameText, isLikelyCode } from '../src/main/ahkMigratedEngine.js';
import { GameInputHelper } from '../src/main/gameInput.js';
import { TranslationService } from '../src/services/translationService.js';
import { CLOUD_KEYS } from '../src/services/cloudVoiceEngine.js';

/**
 * The local-fallback tests must not depend on whether THIS machine has cloud
 * keys configured (AppData config / .env) — blank them for the duration.
 */
function withCloudKeysBlanked(fn) {
  const saved = { dashscope: CLOUD_KEYS.dashscope, deepseek: CLOUD_KEYS.deepseek };
  CLOUD_KEYS.dashscope = '';
  CLOUD_KEYS.deepseek = '';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      CLOUD_KEYS.dashscope = saved.dashscope;
      CLOUD_KEYS.deepseek = saved.deepseek;
    });
}

// ---------- fakes ----------

function makeClipboard() {
  let store = '';
  return {
    readText: () => store,
    writeText: (t) => { store = String(t); },
    _set: (t) => { store = String(t); },
    _get: () => store,
  };
}

/**
 * Simulates the game side: each queued entry is what the chat box "copies"
 * into the clipboard when the engine sends the Ctrl+A/Ctrl+C capture chord.
 */
function makeGameInput({ foreground = 'dota2', captureQueue = [], foregroundError = null } = {}) {
  return {
    calls: [],
    clipboard: null,
    captureQueue: [...captureQueue],
    async foregroundProcessName() {
      this.calls.push(['foreground']);
      if (foregroundError) throw new Error(foregroundError);
      return foreground;
    },
    async sendCaptureChord() {
      this.calls.push(['capture']);
      this.clipboard._set(this.captureQueue.length > 0 ? this.captureQueue.shift() : '');
    },
    async replaceWithText(text) {
      this.calls.push(['replace', text]);
      this.clipboard._set(text);
    },
    async sendEnter() {
      this.calls.push(['enter']);
    },
  };
}

function makeTranslateStub(response) {
  return {
    calls: [],
    async analyzeText(text, options) {
      this.calls.push({ text, options });
      return typeof response === 'function' ? response(text) : response;
    },
  };
}

function makeEngine({ clipboard, gameInput, translationService }) {
  const engine = new AhkMigratedEngine(null, null, { clipboard, gameInput, translationService });
  engine.notifications = [];
  const original = engine.notifyHUD.bind(engine);
  engine.notifyHUD = (data) => { engine.notifications.push(data); original(data); };
  return engine;
}

// ---------- pure-function ports from legacy AHK ----------

describe('Legacy AHK ported guards', () => {
  it('cleanGameText strips console noise, quotes and trims', () => {
    assert.strictEqual(cleanGameText('  "推中路"  '), '推中路');
    assert.strictEqual(cleanGameText('(控制台): say hi'), '');
    assert.strictEqual(cleanGameText('Starting translation: foo'), '');
  });

  it('isLikelyCode mirrors the AHK marker scoring', () => {
    assert.strictEqual(isLikelyCode('#Requires AutoHotkey v2.0'), true);
    assert.strictEqual(isLikelyCode('x := {a:1}'), false); // 2 markers < 3
    assert.strictEqual(isLikelyCode('#Requires AutoHotkey\nfoo := {}'), true);
    assert.strictEqual(isLikelyCode('push mid now'), false);
  });
});

// ---------- F8 in-game flow ----------

describe('F8 in-game chat translation', () => {
  it('captures Chinese from the chat box, translates and types English back', async () => {
    const clipboard = makeClipboard();
    const gameInput = makeGameInput({ captureQueue: ['推中路别刷了', '推中路别刷了'] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: 'push mid now', commandPrefix: '', meaningZh: '推进中路', intent: 'strategy', suggestions: [] });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate('invoker');

    const replaces = gameInput.calls.filter((c) => c[0] === 'replace');
    assert.strictEqual(replaces.length, 1, 'must type the translation into the chat box');
    assert.strictEqual(replaces[0][1], 'push mid now');
    assert.strictEqual(clipboard._get(), 'push mid now', 'clipboard keeps the translation as safety net');
    assert.ok(engine.notifications.at(-1).meaningZh.includes('✅'));
  });

  it('preserves /all command prefix when filling the chat box', async () => {
    const clipboard = makeClipboard();
    const gameInput = makeGameInput({ captureQueue: ['/all 推中路', '/all 推中路'] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: 'push mid', commandPrefix: '/all ', meaningZh: '', intent: 'strategy' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    const replaces = gameInput.calls.filter((c) => c[0] === 'replace');
    assert.strictEqual(replaces[0][1], '/all push mid');
  });

  it('explains English chat on the HUD without touching the chat box', async () => {
    const clipboard = makeClipboard();
    const gameInput = makeGameInput({ captureQueue: ['go rosh now'] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: '打肉山', meaningZh: '提议打肉山', intent: 'strategy' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(gameInput.calls.filter((c) => c[0] === 'replace').length, 0);
    assert.ok(engine.notifications.at(-1).meaningZh.includes('打肉山'));
  });

  it('reports an empty chat box instead of doing nothing', async () => {
    const clipboard = makeClipboard();
    const gameInput = makeGameInput({ captureQueue: [''] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: 'x' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(translationService.calls.length, 0, 'must not translate nothing');
    assert.ok(engine.notifications.at(-1).meaningZh.includes('聊天框为空'));
  });

  it('skips likely-code content like the legacy script did', async () => {
    const clipboard = makeClipboard();
    const code = '#Requires AutoHotkey v2.0\nx := {}';
    const gameInput = makeGameInput({ captureQueue: [code] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: 'x' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(translationService.calls.length, 0);
    assert.ok(engine.notifications.at(-1).meaningZh.includes('代码'));
  });

  it('never types blind: if the chat box changed mid-translation, only clipboard is filled', async () => {
    const clipboard = makeClipboard();
    // Second capture returns different text: player kept typing / closed the box.
    const gameInput = makeGameInput({ captureQueue: ['推中路', '推下路改主意了'] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: 'push mid now', commandPrefix: '', meaningZh: '' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(gameInput.calls.filter((c) => c[0] === 'replace').length, 0, 'must NOT spray keys into the game');
    assert.strictEqual(clipboard._get(), 'push mid now', 'translation still lands on the clipboard');
    assert.ok(engine.notifications.at(-1).meaningZh.includes('剪贴板'));
  });

  it('gives busy feedback on a second press instead of silently eating it', async () => {
    const clipboard = makeClipboard();
    const gameInput = makeGameInput({ captureQueue: ['推中路', '推中路'] });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub(async (text) => {
      await new Promise((r) => setTimeout(r, 50));
      return { translated: 'push mid', commandPrefix: '', meaningZh: '' };
    });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    const first = engine.handleGameChatTranslate();
    await engine.handleGameChatTranslate(); // second press while busy
    await first;

    assert.strictEqual(translationService.calls.length, 1);
    assert.ok(engine.notifications.some((n) => n.meaningZh.includes('⏳')));
  });

  it('falls back to clipboard translation when DOTA 2 is not foreground', async () => {
    const clipboard = makeClipboard();
    clipboard._set('gg wp');
    const gameInput = makeGameInput({ foreground: 'explorer' });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: '打得不错', meaningZh: '对局结束问候', intent: 'info' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(translationService.calls.length, 1);
    assert.strictEqual(gameInput.calls.filter((c) => c[0] === 'capture').length, 0, 'no key injection outside the game');
  });

  it('falls back to clipboard translation when the injection helper is unavailable', async () => {
    const clipboard = makeClipboard();
    clipboard._set('b b b');
    const gameInput = makeGameInput({ foregroundError: '按键注入助手进程已退出' });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: '撤退', meaningZh: '撤退信号', intent: 'request' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(translationService.calls.length, 1);
    assert.ok(engine.notifications.at(-1).meaningZh.length > 0);
  });

  it('shows an explicit hint when neither chat box nor clipboard has content', async () => {
    const clipboard = makeClipboard();
    const gameInput = makeGameInput({ foreground: 'explorer' });
    gameInput.clipboard = clipboard;
    const translationService = makeTranslateStub({ translated: 'x' });
    const engine = makeEngine({ clipboard, gameInput, translationService });

    await engine.handleGameChatTranslate();

    assert.strictEqual(translationService.calls.length, 0);
    assert.ok(engine.notifications.at(-1).meaningZh.includes('F8'));
  });
});

// ---------- Chinese local glossary fallback (cloud unavailable) ----------

describe('Chinese glossary fallback when cloud translation is unavailable', () => {
  it('substitutes known DOTA terms so F8 can still fill the box', () => withCloudKeysBlanked(async () => {
    const service = new TranslationService();
    const result = await service.analyzeText('开雾肉山');
    assert.strictEqual(result.translated, 'Smoke Roshan');
    assert.ok(result.meaningZh.includes('本地词表'));
  }));

  it('returns no translated text when the glossary cannot cover the sentence', () => withCloudKeysBlanked(async () => {
    const service = new TranslationService();
    const result = await service.analyzeText('今天晚上吃什么');
    assert.strictEqual(result.translated, '');
    assert.ok(result.meaningZh.includes('无法覆盖'));
  }));
});

// ---------- GameInputHelper JSON-line protocol ----------

function makeFakeChild() {
  const child = new EventEmitter();
  child.written = [];
  child.stdin = new EventEmitter();
  child.stdin.write = (line) => child.written.push(line);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

describe('GameInputHelper protocol', () => {
  it('sends JSON lines with base64-encoded text and resolves by id', async () => {
    const child = makeFakeChild();
    const helper = new GameInputHelper({ spawnFn: () => child, platform: 'win32' });

    const pending = helper.call('replace', { text: '推 mid' });
    assert.strictEqual(child.written.length, 1);
    const req = JSON.parse(child.written[0].trim());
    assert.strictEqual(req.action, 'replace');
    assert.strictEqual(Buffer.from(req.text, 'base64').toString('utf8'), '推 mid');

    child.stdout.emit('data', Buffer.from(JSON.stringify({ id: req.id, ok: true, value: 'ok' }) + '\n'));
    assert.strictEqual(await pending, 'ok');
    helper.dispose();
  });

  it('rejects when the helper reports an error', async () => {
    const child = makeFakeChild();
    const helper = new GameInputHelper({ spawnFn: () => child, platform: 'win32' });

    const pending = helper.call('capture');
    const req = JSON.parse(child.written[0].trim());
    child.stdout.emit('data', Buffer.from(JSON.stringify({ id: req.id, ok: false, error: 'SendInput failed' }) + '\n'));
    await assert.rejects(pending, /SendInput failed/);
    helper.dispose();
  });

  it('rejects pending calls when the helper process dies', async () => {
    const child = makeFakeChild();
    const helper = new GameInputHelper({ spawnFn: () => child, platform: 'win32' });

    const pending = helper.call('capture');
    child.emit('exit', 1);
    await assert.rejects(pending, /已退出/);
  });

  it('refuses to start on non-Windows platforms', async () => {
    const helper = new GameInputHelper({ spawnFn: () => makeFakeChild(), platform: 'darwin' });
    await assert.rejects(helper.call('capture'), /Windows/);
  });
});

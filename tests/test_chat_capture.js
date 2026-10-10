import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatCapture, normalizeRegion, regionPixels, isMostlyBlack, DEFAULT_CHAT_REGION, BlackCaptureError } from '../src/main/chatCapture.js';
import { AhkMigratedEngine } from '../src/main/ahkMigratedEngine.js';

const bitmap = (pixels, value) => Buffer.alloc(pixels * 4, value);
function fakeImage({ width = 2000, height = 1000, fill = 80, id = 'a' } = {}) {
  const image = { id, isEmpty: () => false, getSize: () => ({ width, height }), toBitmap: () => Buffer.from(`${id}`.repeat(16)),
    toPNG: () => Buffer.from(id), resize: () => image };
  image.crop = rect => { image.cropped = rect; return { ...fakeImage({ width: rect.width, height: rect.height, id: `${id}-chat` }), toBitmap: () => bitmap(64, fill) }; };
  return image;
}

test('regions are clamped, validated and mapped to screenshot pixels', () => {
  assert.equal(normalizeRegion(null), null);
  assert.equal(normalizeRegion({ x: 0, y: 0, width: 0.001, height: 0.5 }), null, 'too small');
  assert.equal(normalizeRegion({ x: 'a', y: 0, width: 1, height: 1 }), null);
  assert.deepEqual(normalizeRegion({ x: 0.8, y: -1, width: 0.5, height: 2 }), { x: 0.8, y: 0, width: 0.19999999999999996, height: 1 });
  assert.deepEqual(regionPixels(DEFAULT_CHAT_REGION, { width: 2000, height: 1000 }), { x: 560, y: 420, width: 880, height: 290 });
});

test('a black frame is recognised; a real one is not', () => {
  assert.equal(isMostlyBlack(bitmap(1000, 0)), true);
  assert.equal(isMostlyBlack(bitmap(1000, 90)), false);
  assert.equal(isMostlyBlack(Buffer.alloc(0)), true);
});

test('capture uses the display under the cursor at full resolution and the saved region', async () => {
  const screenImage = fakeImage({ width: 3000, height: 1500 });
  let asked;
  const capture = createChatCapture({
    screen: { getCursorScreenPoint: () => ({ x: 5, y: 5 }), getDisplayNearestPoint: () => ({ id: 7, scaleFactor: 1.5, size: { width: 2000, height: 1000 }, bounds: {} }) },
    desktopCapturer: { getSources: async options => { asked = options; return [{ display_id: '3', thumbnail: fakeImage() }, { display_id: '7', thumbnail: screenImage }]; } },
    getRegion: () => ({ x: 0.1, y: 0.5, width: 0.2, height: 0.2 }),
  });
  await capture.captureChat();
  assert.deepEqual(asked, { types: ['screen'], thumbnailSize: { width: 3000, height: 1500 } });
  assert.deepEqual(screenImage.cropped, { x: 300, y: 750, width: 600, height: 300 });
});

test('a black capture throws an actionable error', async () => {
  const capture = createChatCapture({
    screen: { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1, size: { width: 100, height: 100 } }) },
    desktopCapturer: { getSources: async () => [{ display_id: '1', thumbnail: fakeImage({ fill: 0 }) }] },
  });
  await assert.rejects(capture.captureChat(), BlackCaptureError);
});

function engine({ foreground = 'dota2', clipboardImage = null, capture } = {}) {
  const notices = [], sent = [];
  const clipboard = { image: clipboardImage, readImage() { return this.image || { isEmpty: () => true }; }, readText: () => '', writeText: () => {} };
  const instance = new AhkMigratedEngine(null, null, {
    clipboard,
    gameInput: { foregroundProcessName: async () => foreground },
    captureChat: capture || (async () => fakeImage({ id: 'chat' })),
    translationService: { analyzeImage: async url => { sent.push(Buffer.from(url.split(',')[1], 'base64').toString()); return { original: 'rosh', meaningZh: '肉山', suggestions: [] }; } },
  });
  instance.notifyHUD = result => notices.push(result);
  return { instance, notices, sent, clipboard };
}

test('Alt+T in Dota captures the chat area; a snip taken since the last press wins once', async () => {
  const { instance, sent, clipboard } = engine({ clipboardImage: fakeImage({ id: 'old' }) });
  await instance.handleClipboardTranslation();
  assert.deepEqual(sent, ['chat'], 'a screenshot already on the clipboard at launch is stale');
  clipboard.image = fakeImage({ id: 'snip' });
  await instance.handleClipboardTranslation();
  await instance.handleClipboardTranslation();
  assert.deepEqual(sent, ['chat', 'snip', 'chat']);
  assert.equal(instance.isBusy, false);
});

test('outside Dota Alt+T still translates the clipboard; capture errors reach the HUD', async () => {
  const outside = engine({ foreground: 'chrome', clipboardImage: fakeImage({ id: 'snip' }), capture: async () => { throw new Error('unexpected'); } });
  await outside.instance.handleClipboardTranslation();
  assert.deepEqual(outside.sent, ['snip']);
  const black = engine({ capture: async () => { throw new BlackCaptureError(); } });
  await black.instance.handleClipboardTranslation();
  assert.match(black.notices.at(-1).meaningZh, /无边框窗口/);
  assert.equal(black.instance.isBusy, false);
});

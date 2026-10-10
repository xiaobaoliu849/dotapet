/**
 * One-key chat capture: Alt+T in Dota grabs the remembered chat area of the
 * screen directly, so the player no longer snips with Win+Shift+S first.
 * Regions are stored relative to the display, so they survive resolution changes.
 */

/** Dota stacks chat lines up from just above the chat box, centred low on the screen. Alt+Shift+T replaces this. */
export const DEFAULT_CHAT_REGION = Object.freeze({ x: 0.28, y: 0.42, width: 0.44, height: 0.29 });
const MIN_REGION = 0.02;

/** A saved region, or null when it is missing or out of range. */
export function normalizeRegion(value) {
  if (!value || typeof value !== 'object') return null;
  const region = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const number = Number(value[key]);
    if (!Number.isFinite(number)) return null;
    region[key] = Math.min(1, Math.max(0, number));
  }
  region.width = Math.min(region.width, 1 - region.x);
  region.height = Math.min(region.height, 1 - region.y);
  return region.width >= MIN_REGION && region.height >= MIN_REGION ? region : null;
}

/** The region in the screenshot's own pixels. */
export function regionPixels(region, { width, height }) {
  const x = Math.round(region.x * width), y = Math.round(region.y * height);
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(region.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(region.height * height))) };
}

/**
 * Exclusive-fullscreen games can come back as a black frame. Samples the BGRA
 * bitmap; true when nearly every sample is (almost) black.
 */
export function isMostlyBlack(bitmap, samples = 4000) {
  const pixels = Math.floor(bitmap.length / 4);
  if (!pixels) return true;
  const step = Math.max(1, Math.floor(pixels / samples));
  let dark = 0, total = 0;
  for (let index = 0; index < pixels; index += step) {
    const offset = index * 4;
    if (bitmap[offset] < 12 && bitmap[offset + 1] < 12 && bitmap[offset + 2] < 12) dark++;
    total++;
  }
  return dark / total >= 0.995;
}

export class BlackCaptureError extends Error {
  constructor() {
    super('截到的是黑屏：当前显示模式不允许直接截图。请在 Dota 2 视频设置中改用「无边框窗口」；或者先按 Win+Shift+S 框选聊天，再按 Alt+T。');
    this.name = 'BlackCaptureError';
  }
}

export function createChatCapture({ desktopCapturer, screen, getRegion = () => null }) {
  /** The display under the cursor (the game's display) at full pixel resolution. */
  async function captureDisplay() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const thumbnailSize = { width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const source = sources.find(item => String(item.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('无法截取屏幕，请重试。');
    return { image: source.thumbnail, display };
  }
  return {
    captureDisplay,
    region: () => normalizeRegion(getRegion()) || DEFAULT_CHAT_REGION,
    /** The chat area as a NativeImage; throws BlackCaptureError when the game hides its frames. */
    async captureChat() {
      const { image } = await captureDisplay();
      const chat = image.crop(regionPixels(this.region(), image.getSize()));
      if (isMostlyBlack(chat.toBitmap())) throw new BlackCaptureError();
      return chat;
    },
  };
}

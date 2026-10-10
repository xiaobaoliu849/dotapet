import electron from 'electron';
import { createHash } from 'node:crypto';
const { clipboard: electronClipboard } = electron;
import { TranslationService } from '../services/translationService.js';
import { gameInput as defaultGameInput } from './gameInput.js';

/**
 * AHK Migrated Engine
 * Replaces legacy AutoHotkey scripts with native Node.js / Electron APIs
 *
 * F8 — In-Game Chat Translation (legacy CopyOrTranslate double-F8 flow):
 *   1. Verify dota2.exe owns the foreground (legacy STRICT_WINDOW check).
 *   2. Clear the clipboard, then Ctrl+A / Ctrl+C into the chat box
 *      (legacy CopyFromChatBox) and poll for the captured text.
 *   3. Clean / length-check / code-check the text (legacy CleanGameText etc.).
 *   4. Translate. For Chinese input the English result is typed BACK into the
 *      chat box (legacy SendToGame: Ctrl+A, Delete, type); the user presses
 *      Enter to send. English input is only explained on the HUD — typing the
 *      Chinese meaning over the box would clobber a message that was already
 *      English.
 *
 * Alt+T — Screenshot / clipboard translation (no key injection). With Dota in
 *   front it captures the remembered chat area itself; a screenshot snipped
 *   since the last press still wins. Elsewhere it translates the clipboard.
 */

const MAX_TEXT_LENGTH = 500;
const CHINESE_RE = /[一-龥]/;
/** Legacy AHK CleanGameText(): strip console noise and quotes. */
export function cleanGameText(text) {
  return String(text || '')
    .replace(/\(控制台\):.*/g, '')
    .replace(/Starting translation:.*/g, '')
    .replace(/"/g, '')
    .trim();
}

/** Legacy AHK IsLikelyCode(): refuse to translate pasted scripts. */
export function isLikelyCode(text) {
  let markers = 0;
  if (String(text).includes('#Requires')) markers += 2;
  if (String(text).includes('AutoHotkey')) markers += 2;
  if (String(text).includes('{') && String(text).includes('}')) markers += 1;
  if (String(text).includes(':=')) markers += 1;
  return markers >= 3;
}

export class AhkMigratedEngine {
  constructor(mainWindow, voiceClient, options = {}) {
    this.mainWindow = mainWindow;
    this.voiceClient = voiceClient;
    this.translationService = options.translationService || new TranslationService();
    this.clipboard = options.clipboard || electronClipboard;
    this.gameInput = options.gameInput || defaultGameInput;
    /** async () => NativeImage of the chat area; absent where the screen cannot be captured. */
    this.captureChat = options.captureChat || null;
    // A screenshot already on the clipboard at launch is not a fresh one.
    this.seenClipboardImage = this.clipboardImageId();
    this.isBusy = false;
    this.lastNotification = null;
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  setVoiceClient(client) {
    this.voiceClient = client;
  }

  /**
   * F8: translate whatever is currently typed in the DOTA 2 chat box and fill
   * the result back in. Falls back to plain clipboard translation when DOTA 2
   * is not the foreground window or key injection is unavailable.
   */
  async handleGameChatTranslate(heroId = 'invoker') {
    if (!this.acquireBusy()) return;

    try {
      // --- STRICT_WINDOW: only capture from the game when it is foreground ---
      let foreground = '';
      try {
        foreground = (await this.gameInput.foregroundProcessName()) || '';
      } catch (err) {
        console.warn('[AHK-Engine] Foreground check failed, using clipboard path:', err.message);
      }

      if (!/^dota2/i.test(foreground)) {
        await this.translateClipboardContent(heroId, {
          emptyHint: '未检测到 DOTA2 前台窗口，且剪贴板为空。请在游戏聊天框输入后按 F8，或先复制文本再按 Alt+T',
        });
        return;
      }

      // --- CopyFromChatBox: wipe clipboard so a stale clip can't fake a capture ---
      this.clipboard.writeText('');
      await this.gameInput.sendCaptureChord();
      const captured = await this.waitForFreshClipboard();
      const text = cleanGameText(captured);

      if (!text) {
        this.notifyHUD({
          original: '',
          // An empty capture with dota2 foreground can also mean UIPI silently
          // ate the injected keys (game running elevated, companion not).
          meaningZh: '❌ 聊天框为空或捕获失败——请确认聊天框有内容；若 DOTA2 以管理员身份运行，请用管理员身份启动本伴侣',
          intent: 'info',
        });
        return;
      }
      if (text.length > MAX_TEXT_LENGTH) {
        this.notifyHUD({
          original: text.slice(0, 60),
          meaningZh: `❌ 文本过长 (${text.length}/${MAX_TEXT_LENGTH})`,
          intent: 'info',
        });
        return;
      }
      if (isLikelyCode(text)) {
        this.notifyHUD({
          original: text.slice(0, 60),
          meaningZh: '⚠ 检测到代码，已跳过翻译',
          intent: 'info',
        });
        return;
      }

      console.log(`[AHK-Engine] F8 translating chat text: "${text.slice(0, 40)}..."`);
      this.notifyHUD({
        original: text,
        meaningZh: `🌐 正在翻译: "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`,
        intent: 'info',
      });

      const result = await this.translationService.analyzeText(text, { heroId });
      const finalText = ((result?.commandPrefix || '') + (result?.translated || '')).trim();

      // Chinese input → the chat message must be re-typed in English.
      // Anything else (reading teammates' English) is HUD-only: the box
      // already holds what the player meant to send.
      if (CHINESE_RE.test(text) && finalText) {
        await this.fillTranslatedText(text, finalText, result);
        return;
      }

      if (CHINESE_RE.test(text) && !finalText) {
        this.notifyHUD({
          ...result,
          original: text,
          meaningZh: '⚠ 云翻译不可用且本地词表无法直译该句，聊天框内容未改动',
        });
        return;
      }

      this.notifyHUD({ ...result, original: text });
    } catch (err) {
      console.error('[AHK-Engine] F8 translation error:', err);
      this.notifyHUD({
        original: '',
        meaningZh: `❌ 翻译异常: ${err.message}`,
        intent: 'other',
      });
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Legacy SendToGame(): replace the chat box content with the translation.
   *
   * The translation can land seconds after F8 — the player may have closed the
   * chat box or kept typing in the meantime. Typing blind then would spray raw
   * keypresses into the game (s=stop, m=move, ability keys...). So before
   * injecting we re-capture and demand the box still holds exactly what we
   * translated; on any mismatch the translation goes to the clipboard only.
   */
  async fillTranslatedText(originalText, finalText, result) {
    let verified = false;
    try {
      this.clipboard.writeText('');
      await this.gameInput.sendCaptureChord();
      const verify = await this.waitForFreshClipboard(500);
      verified = cleanGameText(verify) === originalText;
    } catch (err) {
      console.warn('[AHK-Engine] Pre-fill verification failed:', err.message);
    }

    // The translation always lands on the clipboard as a safety net.
    this.clipboard.writeText(finalText);

    if (!verified) {
      this.notifyHUD({
        ...result,
        original: originalText,
        meaningZh: `⚠ 聊天框已关闭或内容有变化，译文已复制到剪贴板——回车重开聊天框后 Ctrl+V 粘贴：${finalText}`,
      });
      return;
    }

    try {
      await this.gameInput.replaceWithText(finalText);
      const preview = finalText.length > 40 ? finalText.slice(0, 40) + '…' : finalText;
      this.notifyHUD({
        ...result,
        original: originalText,
        meaningZh: `✅ 翻译完成已填入: ${preview}\n请按 Enter 发送`,
      });
      console.log(`[AHK-Engine] F8 filled chat box: "${originalText.slice(0, 30)}" -> "${finalText.slice(0, 30)}"`);
    } catch (err) {
      console.error('[AHK-Engine] Chat box fill failed:', err);
      this.notifyHUD({
        ...result,
        original: originalText,
        meaningZh: `⚠ 自动填入失败，译文已复制到剪贴板，请手动 Ctrl+V：${finalText}`,
      });
    }
  }

  /**
   * Alt+T: Instant Clipboard / Selected Text Translation (no key injection).
   */
  async handleClipboardTranslation(heroId = 'invoker') {
    if (!this.acquireBusy()) return;
    try {
      if (this.captureChat && await this.isDotaForeground()) {
        await this.translateChatCapture();
        return;
      }
      await this.translateClipboardContent(heroId, {
        emptyHint: '先按 Win+Shift+S 框选队友聊天，再按 Alt+T 翻译截图；也可以复制文字后按 Alt+T。',
      });
    } finally {
      this.isBusy = false;
    }
  }

  async isDotaForeground() {
    try { return /^dota2/i.test((await this.gameInput.foregroundProcessName({ timeoutMs: 2000 })) || ''); }
    catch { return false; }
  }

  /** Identity of the clipboard image, or null; tells a new snip from one already translated. */
  clipboardImageId() {
    try {
      const image = this.clipboard.readImage?.();
      if (!image || image.isEmpty() || !image.toBitmap) return null;
      return createHash('sha1').update(image.toBitmap()).digest('hex');
    } catch { return null; }
  }

  /** Alt+T in Dota: a fresh snip if there is one, otherwise the remembered chat area. */
  async translateChatCapture() {
    try {
      const id = this.clipboardImageId();
      const fresh = id && id !== this.seenClipboardImage;
      this.seenClipboardImage = id;
      if (fresh) {
        await this.translateImage(this.clipboard.readImage());
        return;
      }
      this.notifyHUD({ original: '聊天截图', meaningZh: '正在截取并翻译聊天…', intent: 'info', suggestions: [] });
      await this.translateImage(await this.captureChat(), { announced: true });
    } catch (err) {
      console.error('[AHK-Engine] Chat capture error:', err);
      this.notifyHUD({ original: '', meaningZh: `❌ ${err.message}`, intent: 'info', suggestions: [] });
    }
  }

  async translateImage(image, { announced = false } = {}) {
    if (!announced) this.notifyHUD({ original: '聊天截图', meaningZh: '正在识别并翻译截图中的聊天…', intent: 'info', suggestions: [] });
    const { width, height } = image.getSize();
    const scale = Math.min(1, 2048 / Math.max(width, height));
    const resized = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : image;
    // JPEG keeps chat text legible at a fraction of a PNG's upload size.
    const jpeg = Boolean(resized.toJPEG);
    const data = jpeg ? resized.toJPEG(90) : resized.toPNG();
    if (data.length > 8 * 1024 * 1024) throw new Error('截图过大，请重新框选聊天区域。');
    this.notifyHUD(await this.translationService.analyzeImage(`data:image/${jpeg ? 'jpeg' : 'png'};base64,${data.toString('base64')}`));
  }

  async translateClipboardContent(heroId, { emptyHint } = {}) {
    try {
      const image = this.clipboard.readImage?.();
      if (image && !image.isEmpty()) {
        this.seenClipboardImage = this.clipboardImageId();
        await this.translateImage(image);
        return;
      }
      const rawText = this.clipboard.readText();
      if (!rawText || !rawText.trim()) {
        this.notifyHUD({
          original: '',
          meaningZh: emptyHint || '剪贴板内容为空',
          intent: 'info',
          suggestions: [],
        });
        return;
      }

      console.log(`[AHK-Engine] Translating clipboard: "${rawText.trim().slice(0, 40)}..."`);
      const result = await this.translationService.analyzeText(rawText.trim(), { heroId });

      // If Chinese text was translated to English, write the primary English
      // translation to clipboard for instant Ctrl+V.
      if (result && result.translated && CHINESE_RE.test(rawText)) {
        this.clipboard.writeText((result.commandPrefix || '') + result.translated);
      }

      this.notifyHUD(result);
    } catch (err) {
      console.error('[AHK-Engine] Translation error:', err);
      this.notifyHUD({
        original: '',
        meaningZh: `翻译异常: ${err.message}`,
        intent: 'other',
        suggestions: [],
      });
    }
  }

  /**
   * Legacy AHK `busy` guard — but the old companion ATE the second press
   * silently, which read as "F8 does nothing". Tell the user instead.
   */
  acquireBusy() {
    if (this.isBusy) {
      this.notifyHUD({
        original: '',
        meaningZh: '⏳ 正在翻译上一条，请稍候…',
        intent: 'info',
      });
      return false;
    }
    this.isBusy = true;
    return true;
  }

  async waitForFreshClipboard(timeoutMs = 700, intervalMs = 70) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const t = this.clipboard.readText();
      if (t && t.trim()) return t;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return '';
  }

  notifyHUD(data) {
    this.lastNotification = data;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('translate:result', data);
    }
  }
}

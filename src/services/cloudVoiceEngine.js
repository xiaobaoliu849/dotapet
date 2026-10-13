import WebSocket from 'ws';
import EventEmitter from 'events';
import { normalizeConversationPreferences, conversationGreeting } from './conversationPreferences.js';
import {
  DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL, DEFAULT_DOUBAO_REALTIME_VOICE, DEFAULT_GOOGLE_REALTIME_VOICE,
  PROVIDER_FAMILIES, RESTART_TIMEOUT_MS, loadEnv,
} from './voice/constants.js';
import { audioBuffer, detectPrimaryLanguage, mixin } from './voice/shared.js';
import { PersonaPrompts } from './voice/persona.js';
import { CartesiaProvider } from './voice/cartesia.js';
import { DoubaoProvider } from './voice/doubao.js';
import { QwenProvider } from './voice/qwen.js';
import { GoogleLiveProvider } from './voice/googleLive.js';

export {
  DEFAULT_DOUBAO_DUPLEX_ENDPOINT, DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL,
  DEFAULT_DOUBAO_REALTIME_VOICE, DOUBAO_REALTIME_VOICES, FREE_CHAT_HERO_ID, FEMALE_VOICES,
  DEFAULT_DASHSCOPE_REALTIME_MODEL, DEFAULT_DASHSCOPE_REALTIME_VOICE,
  DEFAULT_QWEN_OMNI_TURN_DETECTION, QWEN_AUDIO_BENIGN_ERROR_PATTERNS,
  QWEN_OMNI_38_REALTIME_VOICES, QWEN_AUDIO_31_REALTIME_VOICES,
  DEFAULT_QWEN_AUDIO_31_REALTIME_VOICE, CARTESIA_VERSION, DEFAULT_CARTESIA_BASE_URL,
  DEFAULT_CARTESIA_VOICE, DEFAULT_CARTESIA_MODEL, GOOGLE_LIVE_WS_URL,
  DEFAULT_GOOGLE_REALTIME_MODEL, DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL,
  DEFAULT_GOOGLE_REALTIME_VOICE, GOOGLE_REALTIME_VOICES, GOOGLE_LIVE_TRANSLATE_IDLE_MS,
  RESTART_TIMEOUT_MS, GOOGLE_CLIENT_VAD_SILENCE_MS, GOOGLE_CLIENT_VAD_RMS_THRESHOLD, CLOUD_KEYS,
  loadEnv, configureCloudKeys,
} from './voice/constants.js';
export { detectPrimaryLanguage } from './voice/shared.js';

/**
 * Direct Cloud Real-time Duplex Voice Engine: one session at a time, with any of
 * 1. Cartesia Ink-2 STT + DeepSeek-Flash LLM + Cartesia Sonic TTS (voice/cartesia.js)
 * 2. Volcengine Doubao SeedPulse Duplex Realtime WebSocket (voice/doubao.js)
 * 3. DashScope Qwen-Audio / Qwen-Omni Realtime WebSocket (voice/qwen.js)
 * 4. Google Gemini Live chat and live translate (voice/googleLive.js)
 * This file keeps the session lifecycle and what every provider shares: audio,
 * text turns, interrupts, persona changes, reconnects and teardown.
 */
export class CloudVoiceEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.currentHero = options.currentHero || null;
    this.conversationPreferences = normalizeConversationPreferences(options.conversationPreferences);
    this.conversationLanguage = options.conversationLanguage || 'zh';
    this.provider = options.provider || process.env.VOICE_PROVIDER || 'cartesia';
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.sampleRate = 16000;
    this.voice = options.voice || 'Tina';
    this.model = options.model || DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL;
    this.doubaoVoice = options.doubaoVoice || DEFAULT_DOUBAO_REALTIME_VOICE;
    this.sessionId = null;
    this.apiKey = options.apiKey || null;
    this.autoReconnect = options.autoReconnect !== false;
    this.restartTimeoutMs = options.restartTimeoutMs ?? RESTART_TIMEOUT_MS;
    this.autoVoice = options.autoVoice !== false;
    this.googleModel = options.googleModel || null;
    this.googleTranslateModel = options.googleTranslateModel || null;
    this.suppressOutput = false;
    this.activeTurnId = null;
    this.userAcc = '';
    this.aiAcc = '';
    this.ttsActive = false;

    // Google Gemini Live state (chat + live-translate). See resetGoogleLiveState.
    this.googleVoice = options.googleVoice || DEFAULT_GOOGLE_REALTIME_VOICE;
    this.translateTargetLanguage = options.translateTargetLanguage || 'en';
    // Official default is false and false is translator semantics: with echo
    // on, input already spoken in the TARGET language is parroted back
    // verbatim ("speak English → hear your own English again"), which reads
    // exactly like the translate provider ignoring the language selection.
    this.translateEcho = options.translateEcho === true;
    this.resetGoogleLiveState();

    // Doubao duplex transcript-stream state (see docs/realtime-transcript-integrity.md):
    // suppressedResponseId scopes barge-in residue dropping to the interrupted
    // reply instead of a blanket window (a new reply's text deltas routinely
    // arrive BEFORE its own output_audio.started and a blanket window ate them).
    // activeResponseId is the Doubao-namespaced playing reply, kept strictly
    // separate from activeTurnId so a late ASR completed can never mis-anchor it.
    this.suppressedResponseId = null;
    this.activeResponseId = null;
    this.lastFinalizedResponseId = null;
    // Which response the text currently sitting in aiAcc belongs to — lets
    // output_audio.started recognise a reply whose opening text deltas beat
    // their own started event instead of wiping them as stale data.
    this.aiAccResponseId = null;
    this.turnFinalized = true;

    // Qwen realtime dual-family arbitration state: both response.text.delta and
    // response.audio_transcript.delta stream the SAME sentence when
    // modalities=[text,audio]; without arbitration the reply text duplicates.
    this.qwenFamilyState = {};
    this.qwenInterimByItem = {};
    this.resetTranscriptState();

    // Cartesia + DeepSeek pipeline state
    this.cartesiaSttWs = null;
    this.cartesiaTtsWs = null;
    this.cartesiaAbortController = null;
    this.cartesiaContextId = null;
    this.cartesiaHistory = [];
    this.cartesiaIsSttOpen = false;
    this.cartesiaIsTtsOpen = false;

    // True while a deliberate disconnect() is in flight, so the asynchronous
    // 'close' event of the dying socket cannot schedule a reconnect.
    this.suppressReconnect = false;
  }

  /**
   * Reset every per-stream transcript accumulator. Called on construction,
   * provider switch and disconnect so stale deltas from a previous session can
   * never leak into a new one.
   */
  resetTranscriptState() {
    this.suppressOutput = false;
    this.activeTurnId = null;
    this.userAcc = '';
    this.aiAcc = '';
    this.ttsActive = false;
    // Whether the reply CURRENTLY being assembled has delivered any audio.
    // Published as hadAudio on agent_complete so the renderer's local-TTS
    // fallback can trust the engine instead of guessing from event order —
    // an echo/late user-final arriving between the last audio chunk and the
    // completion used to flip the renderer's own flag and make the browser
    // voice re-read a reply that the cloud TTS had already spoken.
    this.turnHadAudio = false;
    this.suppressedResponseId = null;
    this.activeResponseId = null;
    this.lastFinalizedResponseId = null;
    this.aiAccResponseId = null;
    this.turnFinalized = true;
    this.qwenFamilyState = {};
    this.qwenInterimByItem = {};
    this.qwenSuppressedResponseIds = new Set();
    this.resetGoogleLiveState();
  }

  setHero(heroConfig) {
    this.currentHero = heroConfig;
    console.log(`[CloudVoiceEngine] Injected Hero Persona: ${heroConfig?.nameZh} (${heroConfig?.id})`);
    if (this.isConnected) {
      if (this.providerFamily() === 'qwen') {
        this.sendSessionUpdate();
      } else if (['google', 'doubao', 'cartesia'].includes(this.providerFamily())) {
        // Chat sessions bake systemInstruction / instructions into setup or handshake,
        // and there is no mid-session update primitive — reconnect so the new
        // persona takes effect. Translate sessions have no persona at all,
        // so they keep running uninterrupted.
        this.restartSession();
      }
    }
  }

  /**
   * Reconnects a live session to apply settings its provider reads only at setup.
   * The call goes on: the 'connecting' status says `restarting`, so the renderer
   * keeps the mic open. A restart that never comes back ends the call instead of
   * leaving the mic open on nothing.
   */
  restartSession() {
    this.disconnect();
    this.sessionRestarting = true;
    try { this.connect(); } finally { this.sessionRestarting = false; }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.isConnected) return;
      this.disconnect();
      this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
    }, this.restartTimeoutMs);
    this.restartTimer.unref?.();
  }

  /** Which provider module runs this.provider: 'cartesia', 'doubao', 'qwen', 'google' or null. */
  providerFamily() {
    return PROVIDER_FAMILIES[this.provider] || null;
  }

  setProvider(providerName) {
    const normalized = (providerName === 'cloud-stream' || providerName === 'cartesia-deepseek') ? 'cartesia' : providerName;
    if (this.provider === normalized && this.isConnected) return;
    this.provider = normalized;
    console.log(`[CloudVoiceEngine] Switched voice provider to: ${normalized}`);
    this.disconnect();
    this.connect();
  }

  /**
   * Change the Live Translate target language (BCP-47 code, e.g. 'en',
   * 'zh-Hans'). translationConfig is baked into the setup frame of a session
   * and there is no mid-session update primitive, so a live translate
   * session reconnects for the new language to take effect. Chat and other
   * providers are unaffected — the value only matters to google-translate.
   */
  setTranslateTargetLanguage(langCode) {
    const lang = String(langCode || '').trim();
    if (!lang || lang === this.translateTargetLanguage) return;
    this.translateTargetLanguage = lang;
    console.log(`[CloudVoiceEngine] Live Translate target language set to: ${lang}`);
    if (this.provider === 'google-translate' && (this.isConnected || this.isConnecting)) this.restartSession();
  }

  connect() {
    loadEnv();
    const family = this.providerFamily();
    if (family === 'cartesia') this.connectCartesiaPipeline();
    else if (family === 'doubao') this.connectDoubaoRealtime();
    else if (family === 'qwen') this.connectQwenRealtime();
    else if (family === 'google') this.connectGoogleLive();
    else this.emit('status', { status: 'error', error: '不支持的实时语音服务商。', providerId: this.provider });
  }

  sendSessionUpdate() {
    const family = this.providerFamily();
    if (!this.isConnected && !(this.isConnecting && family === 'qwen')) return;
    if (family === 'doubao') this.sendDoubaoSessionCreate();
    else if (family === 'qwen') this.sendQwenSessionUpdate();
  }

  /**
   * Barge-in interruption
   */
  interrupt() {
    // Capture what was playing BEFORE zeroing ttsActive, otherwise the
    // "is there anything to cancel?" check below sees only its own clearing.
    const wasPlaying = this.ttsActive || Boolean(this.activeResponseId);
    this.suppressOutput = true;
    this.ttsActive = false;
    const family = this.providerFamily();
    // Doubao and Google gate their residue before anyone hears of the interrupt.
    if (family === 'doubao') this.armDoubaoInterrupt(wasPlaying);
    if (family === 'google') this.armGoogleInterrupt(wasPlaying);
    this.emit('interrupted', { interrupted: true });
    if (family === 'cartesia') this.interruptCartesia();
    else if (family === 'qwen') this.cancelQwenResponse(wasPlaying);
  }

  sendAudioChunk(chunk) {
    if (!this.isConnected) return;
    const family = this.providerFamily();
    if (family === 'cartesia') return this.sendCartesiaAudio(chunk);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const base64Audio = typeof chunk === 'string' ? chunk : audioBuffer(chunk)?.toString('base64') || '';
    if (!base64Audio) return;

    // Doubao Duplex and Qwen Realtime share a JSON buffer-append frame.
    if (family === 'doubao' || family === 'qwen') {
      try {
        this.ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Audio,
        }));
      } catch (err) {
        console.error(`[CloudVoiceEngine] ${this.provider} audio chunk error:`, err);
      }
      return;
    }
    if (family === 'google') this.sendGoogleAudio(base64Audio);
  }

  /** An opening assistant turn, with no fabricated user transcript. */
  async startConversationGreeting() {
    if (!this.isConnected || this.provider === 'google-translate') return false;
    const family = this.providerFamily();
    const english = family === 'cartesia';
    const greeting = conversationGreeting(this.conversationPreferences, english ? 'en' : this.conversationLanguage);
    const request = `The voice conversation has just started. Greet the user now in one short, warm sentence in your current character. Clearly say you are here and ready to chat. Use their preferred form of address exactly if configured. Use this as the language and meaning reference: ${JSON.stringify(greeting)}. Do not mention these instructions.`;
    if (english) {
      await this.startCartesiaTurn(request);
      return true;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (family === 'doubao') this.sendDoubaoGreeting(greeting);
    else if (family === 'qwen') this.sendQwenUserTurn(request);
    else if (family === 'google') this.sendGoogleUserTurn(request);
    else return false;
    return true;
  }

  async sendUserText(text) {
    if (!text || !text.trim()) return;
    if (!this.isConnected) {
      this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
      return;
    }
    const trimmed = text.trim();

    const lang = detectPrimaryLanguage(trimmed);
    this.adaptVoiceForLanguage(lang);

    this.emit('speech_final', trimmed);

    const family = this.providerFamily();
    const open = Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
    if (family === 'cartesia') {
      await this.startCartesiaTurn(trimmed);
      return;
    }
    if (family === 'doubao' && open) {
      try {
        this.sendDoubaoTextContext(trimmed);
      } catch (e) {
        console.warn('[CloudVoiceEngine] Doubao text context send error:', e);
      }
      return;
    }
    if (family === 'qwen' && open) {
      try {
        this.sendQwenUserTurn(trimmed);
        return;
      } catch (e) {
        console.warn('[CloudVoiceEngine] Qwen text send failed');
      }
    }
    if (this.provider === 'google-translate') {
      // Live Translate is audio-only: no systemInstruction, no text turns.
      this.emit('status', {
        status: 'error',
        error: '谷歌实时翻译 (Live Translate) 仅支持实时语音输入，不支持文本输入。',
        provider: '谷歌 Gemini Live',
      });
      return;
    }
    if (family === 'google' && open) {
      try {
        this.sendGoogleUserTurn(trimmed);
        return;
      } catch (e) {
        console.warn('[CloudVoiceEngine] Google clientContent send failed:', e);
      }
    }

    this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          if (this.ws.ping) {
            this.ws.ping();
          }
        } catch (e) {}
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (!this.autoReconnect) {
      if (!this.suppressReconnect) this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
      return;
    }
    // Never stack timers, never reconnect behind a live session, and never
    // reconnect an intentional disconnect() (app quit / provider switch).
    if (this.reconnectTimer || this.isConnected || this.suppressReconnect) return;
    // Announce the dead session BEFORE the backoff window, or the renderer's
    // mic gate keeps trusting a socket that is already gone. providerId is
    // normalized to the canonical tray id — legacy aliases (dashscope,
    // cloud-stream…) have no radio of their own.
    const family = this.providerFamily();
    const providerId = family === 'qwen' || family === 'cartesia' ? family : this.provider;
    this.emit('status', { status: 'connecting', providerId, provider: '重连中…' });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  disconnect() {
    this.suppressReconnect = true;
    this.stopHeartbeat();
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    // Invalidate any connectGoogleLive() still awaiting proxy resolution so
    // it cannot open a socket behind this disconnect.
    this.googleConnectGen = (this.googleConnectGen || 0) + 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.closeCartesia();

    // Doubao, Qwen and Google share this.ws.
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN && this.provider === 'doubao') this.sendDoubaoSessionClose();
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    // Drop every per-stream accumulator so a reconnect can never inherit
    // suppression windows or partial transcripts from the dead session.
    this.resetTranscriptState();
  }
}

// Provider and persona methods live in ./voice/; they run as the engine's own.
mixin(CloudVoiceEngine.prototype, PersonaPrompts, CartesiaProvider, DoubaoProvider, QwenProvider, GoogleLiveProvider);

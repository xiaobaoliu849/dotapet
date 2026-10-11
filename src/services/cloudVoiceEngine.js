import WebSocket from 'ws';
import EventEmitter from 'events';
import { normalizeConversationPreferences, conversationGreeting } from './conversationPreferences.js';
import {
  DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL, DEFAULT_DOUBAO_REALTIME_VOICE,
  DEFAULT_DASHSCOPE_REALTIME_VOICE, DEFAULT_QWEN_OMNI_TURN_DETECTION,
  DEFAULT_GOOGLE_REALTIME_VOICE, RESTART_TIMEOUT_MS, loadEnv,
} from './voice/constants.js';
import { detectPrimaryLanguage, generateEventId, mixin } from './voice/shared.js';
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
      if (this.provider === 'doubao' || this.provider === 'qwen' || this.provider === 'dashscope') {
        this.sendSessionUpdate();
      } else if (this.provider === 'google') {
        // Chat sessions bake systemInstruction into the Live setup message and
        // there is no mid-session update primitive — reconnect so the new
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
    if (this.provider === 'cartesia' || this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek') {
      this.connectCartesiaPipeline();
      return;
    }

    if (this.provider === 'doubao') {
      this.connectDoubaoRealtime();
      return;
    }

    if (this.provider === 'qwen' || this.provider === 'dashscope' || this.provider === 'dashscope-ws') {
      this.connectQwenRealtime();
      return;
    }

    if (this.provider === 'google' || this.provider === 'google-translate') {
      this.connectGoogleLive();
      return;
    }

    this.emit('status', { status: 'error', error: '不支持的实时语音服务商。', providerId: this.provider });
  }

  sendSessionUpdate() {
    if (!this.isConnected && !(this.isConnecting && ['qwen', 'dashscope'].includes(this.provider))) return;

    if (this.provider === 'doubao') {
      this.sendDoubaoSessionCreate();
      return;
    }

    if (this.provider === 'qwen' || this.provider === 'dashscope') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: this.voice || process.env.DASHSCOPE_REALTIME_VOICE || DEFAULT_DASHSCOPE_REALTIME_VOICE,
          instructions: this.getHeroSystemPrompt('bilingual'),
          input_audio_format: 'pcm',
          output_audio_format: 'pcm',
          turn_detection: {
            ...DEFAULT_QWEN_OMNI_TURN_DETECTION,
          },
          max_history_turns: 20,
        },
      };
      try {
        this.ws.send(JSON.stringify(sessionConfig));
      } catch (err) {
        console.error('[CloudVoiceEngine] Failed to send Qwen session update:', err);
      }
    }
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
    if (this.provider === 'doubao') {
      // Arm the same targeted residue window an ASR-started barge-in uses:
      // the doubao downlink gates on response identity, so a blanket flag
      // alone would let the cancelled reply's remaining chunks through.
      // Only when there is actually something to cancel — arming while idle
      // would blank-suppress the NEXT legitimate reply's opening text until
      // its own started event arrives.
      if (wasPlaying) {
        this.suppressedResponseId = this.activeResponseId || '';
        this.turnFinalized = false;
      }
    }
    if (this.provider === 'google' || this.provider === 'google-translate') {
      // The Live API has no client-side cancel primitive: blank the local
      // player and suppress the dying turn's downstream residue until the
      // server's turnComplete (or the translate idle finalizer) lifts it.
      // Arm ONLY when something is actually playing — translate sessions
      // never receive turnComplete, so a blanket window here would eat the
      // NEXT turn's translated text until its own idle finalize (same
      // reasoning as the Doubao suppressedResponseId guard above).
      if (wasPlaying) {
        this.googleSuppress = true;
        this.googleAiAcc = '';
        this.googleAudioStarted = false;
      }
    }
    this.emit('interrupted', { interrupted: true });

    if (this.provider === 'cartesia' || this.provider === 'cloud-stream') {
      this.interruptCartesia();
      return;
    }

    if (this.provider === 'qwen' || this.provider === 'dashscope') {
      if (wasPlaying) {
        const activeId = String(this.activeTurnId || this.activeResponseId || '');
        if (activeId) {
          this.qwenSuppressedResponseIds.add(activeId);
        }
      }
      this.activeTurnId = null;
      this.activeResponseId = null;
      this.qwenFamilyState = {};
      this.aiAcc = '';
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'response.cancel' }));
        } catch (e) {}
      }
    }
  }

  sendAudioChunk(chunk) {
    if (!this.isConnected) return;

    // 1. Cartesia Ink-2 STT WebSocket
    if (this.provider === 'cartesia' || this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek') {
      if (this.cartesiaSttWs && this.cartesiaSttWs.readyState === WebSocket.OPEN) {
        let binaryBuffer = null;
        if (Buffer.isBuffer(chunk)) {
          binaryBuffer = chunk;
        } else if (chunk instanceof ArrayBuffer) {
          binaryBuffer = Buffer.from(chunk);
        } else if (chunk?.buffer && chunk.buffer instanceof ArrayBuffer) {
          binaryBuffer = Buffer.from(chunk.buffer, chunk.byteOffset || 0, chunk.byteLength || chunk.length);
        } else if (typeof chunk === 'string') {
          binaryBuffer = Buffer.from(chunk, 'base64');
        }
        if (binaryBuffer && binaryBuffer.length > 0) {
          try {
            this.cartesiaSttWs.send(binaryBuffer);
          } catch (err) {
            console.error('[CloudVoiceEngine] Cartesia STT send error:', err);
          }
        }
      }
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let base64Audio = '';
    if (Buffer.isBuffer(chunk)) {
      base64Audio = chunk.toString('base64');
    } else if (chunk instanceof ArrayBuffer) {
      base64Audio = Buffer.from(chunk).toString('base64');
    } else if (chunk?.buffer && chunk.buffer instanceof ArrayBuffer) {
      base64Audio = Buffer.from(chunk.buffer, chunk.byteOffset || 0, chunk.byteLength || chunk.length).toString('base64');
    } else if (typeof chunk === 'string') {
      base64Audio = chunk;
    }

    if (!base64Audio) return;

    // 2. Doubao Duplex, 3. Qwen Realtime and 4. Google Live share a JSON
    // audio frame (Google's is a realtimeInput blob instead of a buffer append).
    if (this.provider === 'doubao' || this.provider === 'qwen' || this.provider === 'dashscope') {
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

    if (this.provider === 'google' || this.provider === 'google-translate') {
      try {
        this.ws.send(JSON.stringify({
          realtimeInput: {
            audio: { mimeType: 'audio/pcm;rate=16000', data: base64Audio },
          },
        }));
        // Flush end-of-speech audio while keeping automatic VAD/barge-in.
        if (this.provider === 'google') {
          this.trackGoogleClientVad(Buffer.from(base64Audio, 'base64'));
        }
      } catch (err) {
        console.error(`[CloudVoiceEngine] ${this.provider} audio chunk error:`, err);
      }
    }
  }

  /** An opening assistant turn, with no fabricated user transcript. */
  async startConversationGreeting() {
    if (!this.isConnected || this.provider === 'google-translate') return false;
    const english = ['cartesia', 'cloud-stream', 'cartesia-deepseek'].includes(this.provider);
    const greeting = conversationGreeting(this.conversationPreferences, english ? 'en' : this.conversationLanguage);
    const request = `The voice conversation has just started. Greet the user now in one short, warm sentence in your current character. Clearly say you are here and ready to chat. Use their preferred form of address exactly if configured. Use this as the language and meaning reference: ${JSON.stringify(greeting)}. Do not mention these instructions.`;
    if (english) {
      await this.startCartesiaTurn(request);
      return true;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (this.provider === 'doubao') {
      // Seeduplex SayHello: conversation.item.create only seeds history.
      this.ws.send(JSON.stringify({ type: 'speech_text_buffer.commit', event_id: generateEventId('greeting'), text: greeting }));
      return true;
    }
    if (['qwen', 'dashscope', 'dashscope-ws'].includes(this.provider)) {
      this.ws.send(JSON.stringify({ type: 'conversation.item.create', item: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text: request }],
      } }));
      this.ws.send(JSON.stringify({ type: 'response.create' }));
      return true;
    }
    if (this.provider === 'google') {
      this.ws.send(JSON.stringify({ clientContent: {
        turns: [{ role: 'user', parts: [{ text: request }] }], turnComplete: true,
      } }));
      return true;
    }
    return false;
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

    // 1. Cartesia + DeepSeek-Flash Pipeline
    if (this.provider === 'cartesia' || this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek') {
      await this.startCartesiaTurn(trimmed);
      return;
    }

    // 2. Doubao Duplex: text goes into conversation context
    if (this.provider === 'doubao' && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'conversation.item.create',
          event_id: generateEventId('item_create'),
          items: [{
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: trimmed }],
          }],
        }));
      } catch (e) {
        console.warn('[CloudVoiceEngine] Doubao text context send error:', e);
      }
      return;
    }

    // 3. Qwen Realtime WebSocket
    if ((this.provider === 'qwen' || this.provider === 'dashscope') && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: trimmed }],
          },
        }));
        this.ws.send(JSON.stringify({ type: 'response.create' }));
        return;
      } catch (e) {
        console.warn('[CloudVoiceEngine] Qwen text send failed');
      }
    }

    // 4. Google Gemini Live
    if (this.provider === 'google' || this.provider === 'google-translate') {
      if (this.provider === 'google-translate') {
        // Live Translate is audio-only: no systemInstruction, no text turns.
        this.emit('status', {
          status: 'error',
          error: '谷歌实时翻译 (Live Translate) 仅支持实时语音输入，不支持文本输入。',
          provider: '谷歌 Gemini Live',
        });
        return;
      }
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: trimmed }] }],
              turnComplete: true,
            },
          }));
          return;
        } catch (e) {
          console.warn('[CloudVoiceEngine] Google clientContent send failed:', e);
        }
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
    const providerId = (this.provider === 'dashscope' || this.provider === 'dashscope-ws')
      ? 'qwen'
      : (this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek')
        ? 'cartesia'
        : this.provider;
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

    // Clean Cartesia STT / TTS WebSockets
    if (this.cartesiaAbortController) {
      try { this.cartesiaAbortController.abort(); } catch (e) {}
      this.cartesiaAbortController = null;
    }
    if (this.cartesiaSttWs) {
      try { this.cartesiaSttWs.close(); } catch (e) {}
      this.cartesiaSttWs = null;
    }
    if (this.cartesiaTtsWs) {
      try { this.cartesiaTtsWs.close(); } catch (e) {}
      this.cartesiaTtsWs = null;
    }
    this.cartesiaIsSttOpen = false;
    this.cartesiaIsTtsOpen = false;

    // Clean Doubao / Qwen WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN && this.provider === 'doubao') {
        try {
          this.ws.send(JSON.stringify({
            type: 'session.close',
            event_id: generateEventId('sess_close'),
          }));
        } catch (e) {}
      }
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

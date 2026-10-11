import WebSocket from 'ws';
import EventEmitter from 'events';
import tls from 'tls';
import { normalizeConversationPreferences, conversationGreeting } from './conversationPreferences.js';
import { streamingNovelty } from './transcriptStream.js';
import {
  DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL, DEFAULT_DOUBAO_REALTIME_VOICE,
  DEFAULT_DASHSCOPE_REALTIME_VOICE, DEFAULT_QWEN_OMNI_TURN_DETECTION, GOOGLE_LIVE_WS_URL,
  DEFAULT_GOOGLE_REALTIME_MODEL, DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL,
  DEFAULT_GOOGLE_REALTIME_VOICE, GOOGLE_LIVE_TRANSLATE_IDLE_MS, RESTART_TIMEOUT_MS,
  GOOGLE_CLIENT_VAD_SILENCE_MS, GOOGLE_CLIENT_VAD_RMS_THRESHOLD, CLOUD_KEYS, loadEnv,
} from './voice/constants.js';
import { detectPrimaryLanguage, generateEventId, mixin } from './voice/shared.js';
import { resolveGoogleProxyCandidates, establishHttpTunnel } from './voice/googleProxy.js';
import { PersonaPrompts } from './voice/persona.js';
import { CartesiaProvider } from './voice/cartesia.js';
import { DoubaoProvider } from './voice/doubao.js';
import { QwenProvider } from './voice/qwen.js';

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
 * Direct Cloud Real-time Duplex Voice Engine
 * Supports:
 * 1. Cartesia Ink-2 STT + DeepSeek-Flash LLM + Cartesia Sonic TTS (High-speed conversational stream)
 * 2. Volcengine Doubao SeedPulse Duplex Realtime WebSocket (Pure JSON Full-Duplex Protocol)
 * 3. DashScope Qwen-Audio / Qwen-Omni Realtime WebSocket (OpenAI Realtime Protocol)
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

  /**
   * Reset every Google Gemini Live per-session accumulator. Google's
   * input/output transcription frames are cumulative-shaped with overlapping
   * revisions (same as DashScope LiveTranslate), so both sides merge through
   * streamingNovelty — a stale accumulator would glue old words onto a new
   * turn. The translate idle monitor owns its own interval and must survive
   * turn finalization, hence it is torn down only here / on disconnect.
   */
  resetGoogleLiveState() {
    this.googleUserAcc = '';
    this.googleAiAcc = '';
    this.googleUserAccHasContent = false;
    this.googleTranslateInputFinished = false;
    this.googleTranslateOutputFinished = false;
    this.googleTranslateHasContent = false;
    this.googleLastActivityMs = 0;
    this.googleAudioStarted = false;
    this.googleSuppress = false;
    this.googleSawSpeech = false;
    this.googleSilenceMs = 0;
    this.stopGoogleTranslateMonitor();
  }

  startGoogleTranslateMonitor() {
    this.stopGoogleTranslateMonitor();
    this.googleTranslateMonitor = setInterval(() => {
      if (
        this.provider === 'google-translate' &&
        this.googleTranslateHasContent &&
        this.googleLastActivityMs &&
        Date.now() - this.googleLastActivityMs >= GOOGLE_LIVE_TRANSLATE_IDLE_MS
      ) {
        this.finalizeGoogleLiveTranslateTurn(true);
      }
    }, 500);
  }

  stopGoogleTranslateMonitor() {
    if (this.googleTranslateMonitor) {
      clearInterval(this.googleTranslateMonitor);
      this.googleTranslateMonitor = null;
    }
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

  // ------------------------------------------------------------------
  // Provider 4: Google Gemini Live — 实时对话 (chat) & 实时翻译 (live translate)
  // Ported from VoiceSpirit backend/services/realtime_google_provider.py.
  // One BidiGenerateContent WebSocket carries both modes:
  //   'google'           → gemini-3.8-live, hero persona + server VAD
  //   'google-translate' → gemini-3.5-live-translate-preview, translationConfig only
  // Wire notes: input/output transcription configs and realtimeInputConfig
  // are TOP-LEVEL setup fields; translationConfig, responseModalities and
  // speechConfig live inside generationConfig. Both transcription streams are
  // cumulative-with-overlap → merged through streamingNovelty (same shape as
  // DashScope LiveTranslate).
  // ------------------------------------------------------------------
  async connectGoogleLive() {
    // Connect generation: connectGoogleLive awaits proxy resolution before
    // creating the socket, so a rapid provider switch / hero reconnect could
    // otherwise leave a second socket racing the first. A stale generation
    // aborts silently and destroys any tunnel it already opened.
    const connectGen = (this.googleConnectGen = (this.googleConnectGen || 0) + 1);
    const stale = () => connectGen !== this.googleConnectGen;
    loadEnv();
    const apiKey = this.apiKey || CLOUD_KEYS.gemini;
    if (!apiKey) {
      this.emit('status', {
        status: 'error',
        error: 'Google 密钥未配置，请打开 AI 设置。',
        provider: '谷歌 Gemini Live',
      });
      return;
    }

    const isTranslate = this.provider === 'google-translate';
    this.isGoogleTranslateSession = isTranslate;
    this.isConnecting = true;
    this.suppressReconnect = false;
    this.resetGoogleLiveState();
    this.emit('status', {
      status: 'connecting',
      providerId: isTranslate ? 'google-translate' : 'google',
      provider: isTranslate ? '谷歌实时翻译 (Gemini Live Translate)' : '谷歌实时对话 (Gemini Live)',
      ...(this.sessionRestarting && { restarting: true }),
    });

    const wsUrl = CLOUD_KEYS.google_ws_url || GOOGLE_LIVE_WS_URL;

    // Proxy resolution: plain ws() ignores the system proxy, so for wss
    // targets we pre-establish an HTTP CONNECT tunnel and hand ws the
    // already-tunneled socket. localhost/mock targets always go direct, and
    // a dead proxy candidate falls back to direct instead of stalling.
    let wsOptions = {
      headers: {
        'x-goog-api-key': apiKey,
        'user-agent': 'VoiceSpirit/Dota2Companion-GoogleLive',
      },
    };
    try {
      const target = new URL(wsUrl);
      const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname);
      if (target.protocol === 'wss:' && !isLocal) {
        for (const proxy of await resolveGoogleProxyCandidates()) {
          if (stale()) return;
          let tunnel = null;
          try {
            tunnel = await establishHttpTunnel(proxy, target.hostname, 443);
            if (stale()) {
              try { tunnel.destroy(); } catch (e) {}
              return;
            }
            wsOptions.createConnection = () =>
              tls.connect({ socket: tunnel, servername: target.hostname });
            console.log(`[CloudVoiceEngine] Google Live routing via proxy ${proxy.host}:${proxy.port}`);
            break;
          } catch (err) {
            console.warn(`[CloudVoiceEngine] Proxy ${proxy.host}:${proxy.port} failed, trying next/direct:`, err.message);
          }
        }
      }
    } catch (e) {
      console.warn('[CloudVoiceEngine] Proxy resolution skipped:', e.message);
    }
    if (stale()) return;

    try {
      const socket = new WebSocket(wsUrl, wsOptions);
      this.ws = socket;
      if (stale()) {
        try { socket.close(); } catch (e) {}
        return;
      }

      socket.on('open', () => {
        if (this.ws !== socket) return;
        // BidiGenerateContent requires the setup as the VERY FIRST frame.
        try {
          socket.send(this.buildGoogleSetupMessage());
        } catch (e) {
          console.error('[CloudVoiceEngine] Failed to send Google setup:', e);
        }
      });

      socket.on('message', (data) => {
        if (this.ws !== socket) return;
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const event = JSON.parse(raw);
          this.handleGoogleLiveEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Error parsing Google Live event:', e);
        }
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        const msg = String(err?.message || err);
        console.warn('[CloudVoiceEngine] Google Live WS error:', msg);
        if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: `谷歌 Gemini Live 鉴权失败 (${msg})。请检查 google_api_key 是否有效。`,
            provider: '谷歌 Gemini Live',
          });
          return;
        }
        this.emit('status', { status: 'error', error: msg, provider: '谷歌 Gemini Live' });
      });

      socket.on('close', (code, reason) => {
        if (this.ws !== socket) return;
        this.stopGoogleTranslateMonitor();
        const reasonStr = reason ? reason.toString() : '';
        console.log(`[CloudVoiceEngine] Google Live WS closed: code=${code}, reason=${reasonStr}`);

        // Surface the rejection for this key; retry is an explicit user action.
        this.isConnected = false;
        this.isConnecting = false;
        if (code === 1008 || /401|403|api.?key|unauthenticated|quota|resource.?exhausted/i.test(reasonStr)) {
          this.emit('status', {
            status: 'error',
            error: `谷歌 Gemini Live 会话被服务端关闭: ${reasonStr || code}。请检查 google_api_key / 网络。`,
            provider: '谷歌 Gemini Live',
          });
          return;
        }
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Google Live WS:', err);
      this.emit('status', { status: 'error', error: err.message, provider: '谷歌 Gemini Live' });
    }
  }

  /**
   * Build the BidiGenerateContentSetup frame. Live Translate accepts ONLY
   * translationConfig (+ transcription configs): systemInstruction /
   * speechConfig / VAD overrides are unsupported — input language is
   * auto-detected and translated into translateTargetLanguage (tray
   * selectable, default 'en'). echoTargetLanguage stays false (official
   * default): echoing input that is already the target language would make
   * the model parrot the speaker instead of translating.
   */
  buildGoogleSetupMessage() {
    const isTranslate = this.provider === 'google-translate';
    // Newest-generation models only (no legacy fallbacks by design):
    //   chat      → gemini-3.8-live
    //   translate → gemini-3.5-live-translate-preview
    const model = isTranslate ? (this.googleTranslateModel || DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL) : (this.googleModel || DEFAULT_GOOGLE_REALTIME_MODEL);
    this.googleActiveModel = model;

    const setup = { model: model.startsWith('models/') ? model : `models/${model}` };
    if (isTranslate) {
      // Wire shape verified against the google-genai SDK converter
      // (_LiveConnectConfig_to_mldev): translationConfig rides INSIDE
      // generationConfig; transcription configs are setup-level.
      setup.generationConfig = {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: this.translateTargetLanguage || 'en',
          echoTargetLanguage: this.translateEcho === true,
        },
      };
      setup.inputAudioTranscription = {};
      setup.outputAudioTranscription = {};
    } else {
      setup.generationConfig = {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.googleVoice || DEFAULT_GOOGLE_REALTIME_VOICE },
          },
        },
      };
      setup.inputAudioTranscription = {};
      setup.outputAudioTranscription = {};
      // Server VAD, HIGH sensitivity both ends; default activityHandling keeps
      // native barge-in enabled (user speech interrupts model audio), matching
      // the Doubao duplex UX.
      setup.realtimeInputConfig = {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          prefixPaddingMs: 500,
          silenceDurationMs: 1500,
        },
      };
      setup.systemInstruction = { parts: [{ text: this.getHeroSystemPrompt() }] };
    }
    return JSON.stringify({ setup });
  }

  markGoogleActivity() {
    this.googleLastActivityMs = Date.now();
    this.googleTranslateHasContent = true;
  }

  handleGoogleLiveEvent(event) {
    if (!event) return;

    if (event.setupComplete !== undefined) {
      this.isConnected = true;
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.isConnecting = false;
      this.sessionId = generateEventId('sess_google');
      console.log(`[CloudVoiceEngine] Google Live setupComplete (${this.googleActiveModel}, mode=${this.provider})`);
      this.emit('status', {
        status: 'connected',
        providerId: this.isGoogleTranslateSession ? 'google-translate' : 'google',
        provider: this.isGoogleTranslateSession
          ? '谷歌实时翻译 (Gemini Live Translate)'
          : '谷歌实时对话 (Gemini Live)',
      });
      this.emit('session_ready', { sessionId: this.sessionId, provider: 'Google' });
      if (this.isGoogleTranslateSession) {
        this.startGoogleTranslateMonitor();
      }
      return;
    }

    if (event.error) {
      const errObj = event.error;
      const errMsg = typeof errObj === 'object' ? (errObj.message || JSON.stringify(errObj)) : String(errObj);
      console.warn('[CloudVoiceEngine] Google Live error event:', errMsg);
      this.emit('status', { status: 'error', error: errMsg, provider: '谷歌 Gemini Live' });
      return;
    }

    const serverContent = event.serverContent;
    if (!serverContent) return;

    // Native barge-in: the server has CUT the current model turn, so no
    // suppression window is needed — anything arriving after this frame is
    // the next reply. Clear local accumulators so the dying reply's partial
    // text/audio can't glue onto it. (A client-initiated interrupt() DOES
    // arm googleSuppress, since the server keeps streaming in that case.)
    if (serverContent.interrupted && !this.isGoogleTranslateSession) {
      this.googleAiAcc = '';
      this.googleAudioStarted = false;
      this.ttsActive = false;
      this.emit('interrupted', { interrupted: true });
    }

    // ---- Model audio (PCM 24 kHz inline chunks). ----
    // Processed BEFORE the transcription blocks: a finished marker in the
    // SAME frame finalizes the translate turn immediately, and finalize must
    // see this frame's audio in googleAudioStarted or hadAudio would be
    // reported false on an audible turn.
    if (!this.googleSuppress) {
      const parts = serverContent.modelTurn?.parts || [];
      for (const part of parts) {
        const inline = part?.inlineData || part?.inline_data;
        const b64 = String(inline?.data || '');
        if (!b64) continue;
        const mime = String(inline?.mimeType || inline?.mime_type || 'audio/pcm;rate=24000');
        const rateMatch = mime.match(/rate=(\d+)/);
        if (!this.googleAudioStarted) {
          this.googleAudioStarted = true;
          this.ttsActive = true;
          this.activeTurnId = generateEventId('gturn');
          this.emit('agent_audio_start', { responseId: this.activeTurnId });
        }
        const buffer = Buffer.from(b64, 'base64');
        this.emit('agent_audio_chunk', {
          buffer,
          audioBase64: b64,
          sampleRate: rateMatch ? parseInt(rateMatch[1], 10) : 24000,
          turnId: this.activeTurnId,
        });
      }
    }

    // ---- Input transcription (user speech). Cumulative-with-overlap. ----
    const inputTrans = serverContent.inputTranscription || serverContent.input_audio_transcription;
    const inputText = String(inputTrans?.text || '');
    if (inputText) {
      this.markGoogleActivity();
      const { merged, novel } = streamingNovelty(this.googleUserAcc, inputText);
      this.googleUserAcc = merged;
      this.googleUserAccHasContent = Boolean(merged.trim());
      if (merged.trim()) {
        this.emit('speech_interim', merged);
      }
      if (inputTrans?.finished === true) {
        if (this.isGoogleTranslateSession) {
          this.googleTranslateInputFinished = true;
          this.finalizeGoogleLiveTranslateTurn(false);
        } else {
          this.finalizeGoogleUserTranscript();
        }
      }
    }

    // ---- Output transcription (model speech / translated speech). ----
    const outputTrans = serverContent.outputTranscription || serverContent.output_audio_transcription;
    const outputText = String(outputTrans?.text || '');
    if (outputText && !this.googleSuppress) {
      this.markGoogleActivity();
      const { merged, novel } = streamingNovelty(this.googleAiAcc, outputText);
      this.googleAiAcc = merged;
      if (novel) {
        this.emit('agent_text_delta', { delta: novel, fullText: merged, turnId: this.activeTurnId });
      }
      if (outputTrans?.finished === true && this.isGoogleTranslateSession) {
        this.googleTranslateOutputFinished = true;
        this.finalizeGoogleLiveTranslateTurn(false);
      }
    } else if (outputText) {
      // Suppressed residue still advances the translate-turn activity clock
      // and honours its finished markers, it just never reaches the player.
      this.markGoogleActivity();
      if (outputTrans?.finished === true && this.isGoogleTranslateSession) {
        this.googleTranslateOutputFinished = true;
      }
    }

    if (serverContent.turnComplete) {
      this.googleSuppress = false;
      this.suppressOutput = false;
      if (this.isGoogleTranslateSession) {
        this.finalizeGoogleLiveTranslateTurn(true);
      } else {
        this.finalizeGoogleUserTranscript();
        this.finalizeGoogleAssistantTurn();
      }
    }
  }

  finalizeGoogleUserTranscript() {
    const text = this.googleUserAcc.trim();
    this.googleUserAcc = '';
    this.googleUserAccHasContent = false;
    if (text) {
      this.emit('speech_final', text);
    }
  }

  finalizeGoogleAssistantTurn() {
    this.ttsActive = false;
    // Captured BEFORE the reset: the renderer's local-TTS fallback keys off
    // this flag, and the echo/late user-final emitted right before this
    // complete must not make it re-read audio the model already spoke.
    const hadAudio = this.googleAudioStarted;
    this.googleAudioStarted = false;
    const text = this.googleAiAcc;
    this.googleAiAcc = '';
    this.emit('agent_complete', { text, turnId: this.activeTurnId, hadAudio });
    this.activeTurnId = null;
  }

  /**
   * Live Translate has no VAD/turn model: a turn closes when BOTH the input
   * and output transcription streams carry a finished marker, or — ported
   * from VoiceSpirit's inactivity monitor — when 2s pass without any
   * downstream content while a turn has pending text.
   */
  finalizeGoogleLiveTranslateTurn(force) {
    if (!this.isGoogleTranslateSession || !this.googleTranslateHasContent) return;
    const streamsSettled =
      this.googleTranslateInputFinished && this.googleTranslateOutputFinished;
    if (!force && !streamsSettled) return;

    this.finalizeGoogleUserTranscript();
    const text = this.googleAiAcc;
    this.googleAiAcc = '';
    // Captured BEFORE the reset: the live-translate model is audio-out by
    // design (speaker's own voice), so a normal turn DELIVERS audio. Reporting
    // hadAudio:false unconditionally made the renderer's local-TTS fallback
    // re-read every translation over the cloud audio.
    const hadAudio = this.googleAudioStarted;
    this.googleAudioStarted = false;
    this.ttsActive = false;
    this.googleSuppress = false;
    this.googleTranslateHasContent = false;
    this.googleTranslateInputFinished = false;
    this.googleTranslateOutputFinished = false;
    this.googleLastActivityMs = 0;
    this.emit('agent_complete', { text, turnId: this.activeTurnId, mode: 'live_translate', hadAudio });
    this.activeTurnId = null;
  }

  /**
   * Client VAD: track outgoing PCM and, once trailing silence follows actual
   * speech, flush cached audio with realtimeInput.audioStreamEnd (see
   * GOOGLE_CLIENT_VAD_* constants).
   */
  trackGoogleClientVad(buffer) {
    const samples = Math.floor(buffer.length / 2);
    if (samples <= 0) return;
    const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, samples);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      sum += int16[i] * int16[i];
    }
    const rms = Math.sqrt(sum / samples);
    const durationMs = samples / 16; // 16 kHz → samples/16 == ms
    if (rms >= GOOGLE_CLIENT_VAD_RMS_THRESHOLD) {
      this.googleSawSpeech = true;
      this.googleSilenceMs = 0;
      return;
    }
    if (!this.googleSawSpeech) return;
    this.googleSilenceMs += durationMs;
    if (this.googleSilenceMs >= GOOGLE_CLIENT_VAD_SILENCE_MS) {
      this.commitGoogleUtterance();
    }
  }

  /**
   * Explicitly commit the in-flight utterance (audioStreamEnd). Called by the
   * client-VAD silence timer and by the renderer when the microphone is
   * switched off with speech still pending.
   */
  commitGoogleUtterance() {
    this.googleSawSpeech = false;
    this.googleSilenceMs = 0;
    if (this.provider !== 'google' || !this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      console.log('[CloudVoiceEngine] Google client-VAD: utterance committed (audioStreamEnd)');
    } catch (e) {}
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
mixin(CloudVoiceEngine.prototype, PersonaPrompts, CartesiaProvider, DoubaoProvider, QwenProvider);

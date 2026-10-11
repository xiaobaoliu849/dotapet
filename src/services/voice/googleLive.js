/**
 * Google Gemini Live: 实时对话 (chat) and 实时翻译 (live translate).
 * Ported from VoiceSpirit backend/services/realtime_google_provider.py.
 * One BidiGenerateContent WebSocket carries both modes:
 *   "google"           → gemini-3.8-live, hero persona + server VAD
 *   "google-translate" → gemini-3.5-live-translate-preview, translationConfig only
 * Wire notes: input/output transcription configs and realtimeInputConfig
 * are TOP-LEVEL setup fields; translationConfig, responseModalities and
 * speechConfig live inside generationConfig. Both transcription streams are
 * cumulative-with-overlap → merged through streamingNovelty (same shape as
 * DashScope LiveTranslate).
 */
import WebSocket from 'ws';
import tls from 'tls';
import { streamingNovelty } from '../transcriptStream.js';
import {
  GOOGLE_LIVE_WS_URL, DEFAULT_GOOGLE_REALTIME_MODEL, DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL,
  DEFAULT_GOOGLE_REALTIME_VOICE, GOOGLE_LIVE_TRANSLATE_IDLE_MS, GOOGLE_CLIENT_VAD_SILENCE_MS,
  GOOGLE_CLIENT_VAD_RMS_THRESHOLD, CLOUD_KEYS, loadEnv,
} from './constants.js';
import { resolveGoogleProxyCandidates, establishHttpTunnel } from './googleProxy.js';
import { generateEventId } from './shared.js';

/** Mixed into CloudVoiceEngine; `this` is the engine. */
export class GoogleLiveProvider {
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
}

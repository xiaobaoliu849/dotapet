/** Volcengine Doubao Duplex Realtime: one full-duplex JSON WebSocket. */
import WebSocket from 'ws';
import {
  appendAssistantDelta, isOutputSuppressed, missingTextSuffix, shouldLiftSuppression,
} from '../transcriptStream.js';
import {
  DEFAULT_DOUBAO_DUPLEX_ENDPOINT, DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL,
  DEFAULT_DOUBAO_REALTIME_VOICE, DOUBAO_REALTIME_VOICES, CLOUD_KEYS, loadEnv,
} from './constants.js';
import { detectPrimaryLanguage, generateEventId } from './shared.js';

/** Mixed into CloudVoiceEngine; `this` is the engine. */
export class DoubaoProvider {
  connectDoubaoRealtime() {
    loadEnv();
    const apiKey = this.apiKey || CLOUD_KEYS.doubao_api_key || CLOUD_KEYS.doubao_access_token;

    if (!apiKey) {
      this.emit('status', { status: 'error', providerId: 'doubao', error: '豆包密钥未配置，请打开 AI 设置。', provider: 'Doubao' });
      return;
    }

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.emit('status', { status: 'connecting', providerId: 'doubao', provider: '字节豆包 (Doubao Duplex)' });

    let endpoint = CLOUD_KEYS.doubao_ws_url || DEFAULT_DOUBAO_DUPLEX_ENDPOINT;
    if (endpoint.includes('/api/v3/realtime/dialogue')) {
      endpoint = DEFAULT_DOUBAO_DUPLEX_ENDPOINT;
    }

    try {
      const socket = new WebSocket(endpoint, {
        headers: {
          'X-Api-Key': apiKey,
          'user-agent': 'VoiceSpirit/Dota2Companion-Duplex',
        },
      });
      this.ws = socket;

      socket.on('open', () => {
        if (this.ws !== socket) return;
        this.isConnected = true;
        this.isConnecting = false;
        this.resetTranscriptState();

        console.log('[CloudVoiceEngine] Connected to Doubao Full-Duplex Realtime WebSocket');
        this.emit('status', { status: 'connected', providerId: 'doubao', provider: '字节豆包 (Doubao Duplex)' });

        this.sendDoubaoSessionCreate();
        this.startHeartbeat();
      });

      socket.on('message', (data) => {
        if (this.ws !== socket) return;
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const event = JSON.parse(raw);
          this.handleDoubaoDuplexEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Error parsing Doubao event:', e);
        }
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        console.warn('[CloudVoiceEngine] Doubao Duplex WS error:', err.message);
        this.emit('status', { status: 'error', error: err.message, provider: '字节豆包 (Doubao Duplex)' });
      });

      socket.on('close', (code, reason) => {
        // A stale socket (superseded by reconnect / provider switch / disconnect)
        // must not clobber the live session's state or schedule a duplicate
        // connection behind the current one.
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        const reasonStr = reason ? reason.toString() : '';
        console.log(`[CloudVoiceEngine] Doubao WS closed: code=${code}, reason=${reasonStr}`);

        if (code === 401 || reasonStr.includes('401')) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: '火山引擎豆包实时语音鉴权失败 (HTTP 401)。请确认配置中填写的是火山引擎控制台有效的 Access Token。',
            provider: '字节豆包 (Doubao Duplex)',
          });
          return;
        }

        if (code === 403 || reasonStr.includes('403')) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: '火山引擎豆包实时语音拒绝访问 (HTTP 403)。请检查账户余额/免费资源包。',
            provider: '字节豆包 (Doubao Duplex)',
          });
          return;
        }

        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Doubao WS:', err);
      this.emit('status', { status: 'error', error: '连接失败', provider: 'Doubao' });
    }
  }

  sendDoubaoSessionCreate() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const chosenVoice = DOUBAO_REALTIME_VOICES.includes(this.doubaoVoice)
      ? this.doubaoVoice
      : DEFAULT_DOUBAO_REALTIME_VOICE;

    const sessionPayload = {
      model: this.model || DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL,
      instructions: this.getHeroSystemPrompt(),
      audio: {
        input: { format: { type: 'pcm', rate: 16000 } },
        output: {
          format: { type: 'pcm_s16le', rate: 24000 },
          voice: chosenVoice,
        },
      },
    };

    const extension = {
      asr: { extra: {} },
      tts: { extra: {} },
      dialog: { extra: {} },
    };

    const websearchKey = CLOUD_KEYS.doubao_websearch_key;
    if (websearchKey) {
      extension.dialog.extra = {
        enable_volc_websearch: true,
        volc_websearch_type: 'web',
        volc_websearch_api_key: websearchKey,
      };
    }

    const handshakeMsg = {
      type: 'session.create',
      event_id: generateEventId('sess_create'),
      session: sessionPayload,
      extension: extension,
    };

    try {
      this.ws.send(JSON.stringify(handshakeMsg));
    } catch (e) {
      console.error('[CloudVoiceEngine] Failed to send session.create:', e);
    }
  }

  handleDoubaoDuplexEvent(event) {
    if (!event) return;
    const type = event.type || '';

    switch (type) {
      case 'session.created':
        this.sessionId = event.session?.id || '';
        this.emit('session_ready', { sessionId: this.sessionId, provider: 'Doubao' });
        break;

      case 'conversation.item.input_audio_transcription.started':
        // Barge-in: scope residue suppression to the interrupted reply instead
        // of a blanket window — a new reply's text deltas routinely arrive
        // BEFORE its own output_audio.started, and a blanket window swallowed
        // every reply's opening text (VoiceSpirit 301cd74).
        this.suppressOutput = true;
        this.userAcc = '';
        if (this.ttsActive) {
          this.suppressedResponseId = this.activeResponseId || '';
          this.turnFinalized = false;
          this.ttsActive = false;
          this.activeResponseId = null;
          this.activeTurnId = null;
          this.aiAcc = '';
          this.emit('interrupted', { interrupted: true });
        }
        this.emit('user_speech_start');
        break;

      case 'conversation.item.input_audio_transcription.delta': {
        // Protocol semantics (verified against the official web demo's
        // setQuestion usage): this frame is a full "as of now" SNAPSHOT that
        // revises backwards near the end — it must REPLACE the interim text.
        // Appending here duplicated the interim over and over until completed.
        const snapshot = String(event.delta || '');
        if (snapshot) {
          this.userAcc = snapshot;
          this.emit('speech_interim', this.userAcc);
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event.transcript || event.text || this.userAcc || '').trim();
        if (transcript) {
          this.adaptVoiceForLanguage(detectPrimaryLanguage(transcript));
          this.emit('speech_final', transcript);
        }
        this.emit('user_speech_end');
        break;
      }

      case 'response.output_audio.started': {
        const startedId = String(event.response_id || '');
        // A reply other than the suppressed one starting means the interrupted
        // stream is truly gone → lift the window (blank windows lift on any
        // new start; see shouldLiftSuppression).
        if (shouldLiftSuppression(this.suppressedResponseId, startedId)) {
          this.suppressedResponseId = null;
        }
        this.ttsActive = true;
        if (startedId && startedId !== this.activeResponseId) {
          // Text deltas of THIS reply may have beaten their own started event
          // (301cd74): aiAcc already holds the opening words under that id —
          // announce the reply but keep them.
          const ownsPendingText =
            Boolean(this.aiAcc) && this.aiAccResponseId === startedId;
          if (ownsPendingText || !this.aiAcc || this.turnFinalized) {
            // Fresh announcement. Wipe only text owned by ANOTHER reply.
            if (!ownsPendingText) {
              this.aiAcc = '';
              this.aiAccResponseId = null;
            }
            this.activeTurnId = startedId;
            this.turnHadAudio = false;
            this.emit('agent_audio_start', { responseId: startedId });
          } else {
            // Segment continuation: the server may split one logical reply
            // into several response_ids; aiAcc holds the previous segment's
            // text as the output_text.done reconciliation baseline and the
            // next segment started before it finalized — keep it, no
            // re-announcement.
            this.activeTurnId = startedId;
          }
          this.activeResponseId = startedId;
          this.turnFinalized = false;
        } else if (!startedId && !this.activeResponseId) {
          // No ids on the wire at all: treat as a fresh reply so text still
          // accumulates from zero instead of gluing onto a stale turn.
          this.aiAcc = '';
          this.aiAccResponseId = null;
          this.activeTurnId = generateEventId('resp');
          this.turnHadAudio = false;
          this.emit('agent_audio_start', { responseId: this.activeTurnId });
          this.turnFinalized = false;
        }
        break;
      }

      case 'response.output_audio.delta': {
        if (isOutputSuppressed(this.suppressedResponseId, event.response_id)) return;
        // Same identity-scoped guard as text: no phantom playback of the
        // just-finalized reply, while a genuinely new reply (id not yet seen,
        // possibly pre-started) still gets through.
        if (
          this.turnFinalized &&
          (!event.response_id || String(event.response_id) === this.lastFinalizedResponseId)
        ) {
          return;
        }
        const audioB64 = event.delta || '';
        if (audioB64) {
          this.ttsActive = true;
          this.turnHadAudio = true;
          const buffer = Buffer.from(audioB64, 'base64');
          this.emit('agent_audio_chunk', {
            buffer: buffer,
            audioBase64: audioB64,
            sampleRate: 24000,
            turnId: this.activeTurnId,
          });
        }
        break;
      }

      case 'response.output_audio.done': {
        // A done belonging to the interrupted stream (or any done while a
        // blank post-barge-in window is armed) is residue: drop it silently —
        // but DO lift the window. Synthesis of that reply has ended, so none
        // of it can play afterwards; a lingering (especially blank) window
        // would otherwise swallow the NEXT reply's pre-started opening text.
        // Mirrors VoiceSpirit realtime_doubao_provider.py, which clears the
        // targeted suppression on the suppressed done.
        if (isOutputSuppressed(this.suppressedResponseId, event.response_id)) {
          this.suppressedResponseId = null;
          return;
        }
        // A tail done of an EARLIER segment whose successor is already
        // streaming must not finalize the active segment: record its id so
        // its own stragglers stay blocked and let the live segment finish.
        const staleDoneId = String(event.response_id || '');
        if (
          !this.turnFinalized &&
          staleDoneId &&
          this.activeResponseId &&
          staleDoneId !== this.activeResponseId
        ) {
          this.lastFinalizedResponseId = staleDoneId;
          return;
        }
        if (this.turnFinalized) return;
        this.ttsActive = false;
        this.emit('agent_complete', { text: this.aiAcc, turnId: this.activeTurnId, hadAudio: this.turnHadAudio });
        this.aiAcc = '';
        this.userAcc = '';
        this.turnHadAudio = false;
        this.aiAccResponseId = null;
        // Record the finished reply by ITS OWN id — in segmented replies
        // activeResponseId may already belong to the next segment.
        this.lastFinalizedResponseId =
          String(event.response_id || '') || this.activeResponseId || null;
        this.activeTurnId = null;
        this.activeResponseId = null;
        this.suppressedResponseId = null;
        this.turnFinalized = true;
        break;
      }

      case 'response.output_text.delta': {
        if (isOutputSuppressed(this.suppressedResponseId, event.response_id)) return;
        // Post-finalize residue of the reply that JUST completed must not
        // resurrect — but a NEW reply's leading deltas legitimately arrive
        // before its own output_audio.started, so the drop is scoped by
        // response identity rather than a blanket finalized flag.
        if (
          this.turnFinalized &&
          (!event.response_id || String(event.response_id) === this.lastFinalizedResponseId)
        ) {
          return;
        }
        const delta = String(event.delta || '');
        if (delta) {
          const rid = String(event.response_id || '');
          // Ownership bookkeeping: text arriving under a different id after a
          // finalize belongs to a genuinely new reply — start it clean.
          if (rid && this.aiAccResponseId !== rid && (!this.aiAcc || this.turnFinalized)) {
            this.aiAcc = '';
            this.aiAccResponseId = null;
          }
          if (rid) {
            this.aiAccResponseId = rid;
          }
          // Clean token delta: append verbatim (appendAssistantDelta only
          // lstrips the very first fragment of the turn).
          this.aiAcc = appendAssistantDelta(this.aiAcc, delta);
          this.emit('agent_text_delta', { delta, fullText: this.aiAcc, turnId: this.activeTurnId });
        }
        break;
      }

      case 'response.output_text.done': {
        const responseId = String(event.response_id || '');
        if (isOutputSuppressed(this.suppressedResponseId, responseId)) return;
        // turn_finalized guard: after finalize, only residue of THAT reply
        // (same id / no id) is blocked — a genuinely new reply's done may
        // legitimately beat its own started and must still reconcile.
        if (
          this.turnFinalized &&
          (!responseId || responseId === this.lastFinalizedResponseId)
        ) {
          return;
        }
        // Authoritative text of an ALREADY-SUPERSEDED segment cannot be
        // reconciled against a baseline that now also contains newer segments'
        // text — reconciling would either warn-diverge or double-splice the
        // prefix. Only the segment that owns the current baseline may heal it.
        if (responseId && this.aiAccResponseId && responseId !== this.aiAccResponseId) {
          break;
        }
        // done.text is the server's authoritative whole transcript. Reconcile
        // against what was streamed forward: publish exactly the missing
        // suffix (self-heals any gap) and refuse to splice on divergence
        // instead of double-publishing the prefix.
        const suffix = missingTextSuffix(this.aiAcc, String(event.text || ''), (acc, fin) => {
          console.warn(
            `[CloudVoiceEngine] Doubao output_text.done diverged from streamed deltas: acc=${JSON.stringify(acc.slice(0, 120))} done=${JSON.stringify(fin.slice(0, 120))}`
          );
        });
        if (suffix) {
          if (responseId) {
            this.aiAccResponseId = responseId;
          }
          this.aiAcc = appendAssistantDelta(this.aiAcc, suffix);
          this.emit('agent_text_delta', { delta: suffix, fullText: this.aiAcc, turnId: this.activeTurnId });
        }
        break;
      }

      case 'session.closed':
        this.isConnected = false;
        this.emit('session_closed');
        break;

      case 'error': {
        const errObj = event.error || event;
        const errMsg = typeof errObj === 'object' ? (errObj.message || JSON.stringify(errObj)) : String(errObj);
        console.warn('[CloudVoiceEngine] Doubao error event:', errMsg);
        this.emit('status', { status: 'error', error: errMsg, provider: '字节豆包 (Doubao Duplex)' });
        break;
      }

      default:
        break;
    }
  }

/**
   * Barge-in. Arm the same targeted residue window an ASR-started barge-in uses:
   * the doubao downlink gates on response identity, so a blanket flag alone
   * would let the cancelled reply's remaining chunks through. Only when there is
   * actually something to cancel — arming while idle would blank-suppress the
   * NEXT legitimate reply's opening text until its own started event arrives.
   */
  armDoubaoInterrupt(wasPlaying) {
    if (wasPlaying) {
      this.suppressedResponseId = this.activeResponseId || '';
      this.turnFinalized = false;
    }
  }

  /** Seeduplex SayHello: conversation.item.create only seeds history. */
  sendDoubaoGreeting(greeting) {
    this.ws.send(JSON.stringify({ type: 'speech_text_buffer.commit', event_id: generateEventId('greeting'), text: greeting }));
  }

  /** Typed text goes into the conversation context. */
  sendDoubaoTextContext(text) {
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      event_id: generateEventId('item_create'),
      items: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      }],
    }));
  }

  sendDoubaoSessionClose() {
    try {
      this.ws.send(JSON.stringify({
        type: 'session.close',
        event_id: generateEventId('sess_close'),
      }));
    } catch (e) {}
  }
}

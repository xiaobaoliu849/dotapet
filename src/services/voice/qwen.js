/** DashScope Qwen-Audio / Qwen-Omni Realtime, on the OpenAI Realtime protocol. */
import WebSocket from 'ws';
import { appendAssistantDelta, cleanQwenTranscriptArtifacts, streamingNovelty } from '../transcriptStream.js';
import {
  DEFAULT_DASHSCOPE_REALTIME_MODEL, DEFAULT_DASHSCOPE_REALTIME_VOICE, DEFAULT_QWEN_OMNI_TURN_DETECTION,
  QWEN_AUDIO_BENIGN_ERROR_PATTERNS, CLOUD_KEYS, loadEnv,
} from './constants.js';
import { detectPrimaryLanguage, generateEventId } from './shared.js';

/** Mixed into CloudVoiceEngine; `this` is the engine. */
export class QwenProvider {
  /**
   * Dual-family arbitration for one Qwen realtime transcript delta.
   *
   * With modalities=[text,audio] DashScope streams the SAME sentence through
   * BOTH response.text.delta and response.audio_transcript.delta. Naively
   * appending both duplicates every reply. Faithful port of VoiceSpirit
   * 821a7a8's arbitration:
   *
   *   - a clean text delta claims the response immediately (held audio is
   *     discarded — text is the better transcript);
   *   - the FIRST audio_transcript delta is held for one event so a
   *     near-simultaneous text delta can still win;
   *   - a second audio_transcript delta locks the response to that family,
   *     replaying the held fragment first;
   *   - cross-family continuation after a decision passes a novelty predicate
   *     (streamingNovelty); novel chunks are forwarded VERBATIM and recorded,
   *     and an identical chunk arriving later from the owning family is
   *     consumed against that record instead of being published twice.
   *
   * Every forwarded chunk carries authoritative whitespace (" world" opens a
   * word, "ful" continues one) — nothing here trims mid-turn or re-spaces.
   *
   * @param {string} responseId owning response id
   * @param {'text'|'audio_transcript'} family which delta family arrived
   * @param {string} rawDelta verbatim provider delta
   * @returns {string[]} chunks to publish, in order ('' never included)
   */
  arbitrateQwenTextDelta(responseId, family, rawDelta) {
    if (!this.qwenFamilyState[responseId]) {
      this.qwenFamilyState[responseId] = {
        decided: '',
        heldAudio: '',
        accumulatedText: '',
        // Chunks already published by the NON-owning family while it was
        // silent, awaiting their duplicate from the owning family.
        injected: [],
      };
    }
    const fstate = this.qwenFamilyState[responseId];

    let delta = String(rawDelta ?? '');
    if (!delta) return [];
    if (family === 'audio_transcript') {
      delta = cleanQwenTranscriptArtifacts(delta);
      if (!delta) return [];
    }

    let deltasToEmit;
    let crossFamily = false;
    if (fstate.decided) {
      if (family === fstate.decided) {
        deltasToEmit = [delta];
      } else {
        // The losing family's frames are cumulative-shaped ("the sentence so
        // far"), so publish only the NOVEL suffix — forwarding the raw frame
        // verbatim would re-print the opening it replays ("Hello" + "Hel" ->
        // "HelloHel"). streamingNovelty already refuses rewound snapshots.
        const { novel } = streamingNovelty(fstate.accumulatedText, delta);
        if (!novel) return [];
        deltasToEmit = [novel];
        crossFamily = true;
      }
    } else if (family === 'text') {
      // Clean LLM text claims the response immediately; any held
      // audio_transcript fragment loses.
      fstate.decided = 'text';
      fstate.heldAudio = '';
      deltasToEmit = [delta];
    } else if (!fstate.heldAudio) {
      // First audio_transcript delta: hold one event window.
      fstate.heldAudio = delta;
      return [];
    } else {
      // Second audio_transcript delta, no text in sight: lock the family and
      // replay the held opening fragment ahead of the current one.
      fstate.decided = 'audio_transcript';
      deltasToEmit = [fstate.heldAudio, delta];
      fstate.heldAudio = '';
    }

    const emitted = [];
    for (const chunk of deltasToEmit) {
      if (!chunk) continue;
      const acc = fstate.accumulatedText;
      // Mirrors appendAssistantDelta: only the response's opening fragment
      // may lose a stray leading pad; later fragments' whitespace bounds them
      // against what came before.
      const text = acc ? chunk : chunk.replace(/^\s+/, '');
      if (!text) continue;
      if (!crossFamily && fstate.injected.includes(text)) {
        // The other family already published this exact chunk while silent;
        // publishing again would duplicate the sentence on screen.
        fstate.injected.splice(fstate.injected.indexOf(text), 1);
        continue;
      }
      fstate.accumulatedText = `${acc}${text}`;
      if (crossFamily) {
        fstate.injected.push(text);
      }
      emitted.push(text);
    }

    // Bound the table: responses are sequential; evict the oldest entry.
    const ids = Object.keys(this.qwenFamilyState);
    if (ids.length > 8) {
      delete this.qwenFamilyState[ids[0]];
    }
    return emitted;
  }

  connectQwenRealtime() {
    loadEnv();
    const apiKey = this.apiKey || CLOUD_KEYS.dashscope;
    if (!apiKey) {
      this.emit('status', { status: 'error', providerId: 'qwen', error: '千问密钥未配置，请打开 AI 设置。', provider: 'Qwen' });
      return;
    }

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.emit('status', {
      status: 'connecting',
      providerId: 'qwen',
      provider: '阿里千问 (Qwen-Audio Realtime)',
      ...(this.sessionRestarting && { restarting: true }),
    });

    const modelName = this.model && this.model.startsWith('qwen') ? this.model : (process.env.DASHSCOPE_REALTIME_MODEL || DEFAULT_DASHSCOPE_REALTIME_MODEL);
    let wsUrl = CLOUD_KEYS.dashscope_ws_url || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    if (!wsUrl.includes('model=')) {
      const sep = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${sep}model=${encodeURIComponent(modelName)}`;
    }

    try {
      const socket = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'user-agent': 'VoiceSpirit/Dota2Companion',
        },
      });
      this.ws = socket;

      socket.on('open', () => {
        if (this.ws !== socket) return;
        this.isConnected = false;
        this.resetTranscriptState();
        console.log(`[CloudVoiceEngine] Connected to DashScope Qwen Realtime WS (${modelName})`);

        this.sendSessionUpdate();
        this.startHeartbeat();
      });

      socket.on('message', (data, isBinary) => {
        if (this.ws !== socket) return;
        if (isBinary) {
          if (this.suppressOutput) return;
          this.turnHadAudio = true;
          this.emit('agent_audio_chunk', {
            buffer: data,
            sampleRate: 24000,
          });
          return;
        }

        try {
          const msg = JSON.parse(data.toString());
          this.handleQwenRealtimeEvent(msg);
        } catch (e) {
          console.error('[CloudVoiceEngine] Error parsing Qwen event:', e);
        }
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        console.warn('[CloudVoiceEngine] Qwen WS connection notice:', err.message);
        this.emit('status', { status: 'error', error: err.message, provider: '阿里千问 (Qwen-Audio)' });
      });

      socket.on('close', (code, reason) => {
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        this.isConnected = false;
        this.isConnecting = false;
        if (code === 401 || (reason && reason.toString().includes('401'))) {
          this.emit('status', { status: 'error', error: 'HTTP 401', provider: 'Qwen' });
          return;
        }
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Qwen WS:', err);
      this.emit('status', { status: 'error', error: '连接失败', provider: 'Qwen' });
    }
  }

  handleQwenRealtimeEvent(msg) {
    if (!msg) return;

    // Untyped error envelope (e.g. {"code": "AccessDenied", "message": "Access denied", "request_id": "..."})
    if (!msg.type && (msg.code || msg.message)) {
      const errMsg = msg.message || msg.code || 'DashScope 拒绝访问';
      console.warn(`[CloudVoiceEngine] DashScope untyped error: code=${msg.code}, message=${msg.message}`);
      this.emit('status', {
        status: 'error',
        error: `DashScope 服务端拒绝: ${errMsg} (code: ${msg.code || 'unknown'})`,
        provider: '阿里千问 (DashScope Realtime)',
      });
      return;
    }

    const type = msg.type || '';

    switch (type) {
      case 'session.created':
        this.sessionId = msg.session?.id || '';
        this.emit('session_ready', { sessionId: this.sessionId, provider: 'Qwen' });
        break;

      case 'session.updated':
        this.isConnected = true;
        this.isConnecting = false;
        this.emit('status', { status: 'connected', providerId: 'qwen', provider: `阿里千问 (${this.model || DEFAULT_DASHSCOPE_REALTIME_MODEL})` });
        this.emit('session_configured', { sessionId: this.sessionId, provider: 'Qwen' });
        // Session updated event acknowledged
        break;

      case 'input_audio_buffer.speech_started': {
        this.suppressOutput = true;
        this.ttsActive = false;
        // Targeted interruption: record active response ID into suppression set
        const interruptedId = String(this.activeTurnId || this.activeResponseId || '');
        if (interruptedId) {
          this.qwenSuppressedResponseIds.add(interruptedId);
        }
        // The interrupted reply is cancelled server-side; its still-HELD
        // fragment must die here or response.done would force-settle a ghost
        // opener of a reply that was never allowed to speak.
        this.qwenFamilyState = {};
        this.emit('user_speech_start');
        this.emit('interrupted', { interrupted: true });
        break;
      }

      case 'input_audio_buffer.speech_stopped':
        // Speech ended. Note: do NOT unsuppress this.qwenSuppressedResponseIds here!
        // The interrupted response's late chunks still belong to that response ID.
        this.suppressOutput = false;
        this.emit('user_speech_end');
        break;

      case 'response.created':
      case 'response.output_item.added': {
        // response.created carries response.id; response.output_item.added
        // carries response_id / item.id instead — resolve all shapes before
        // falling back to a synthetic id.
        const newRespId =
          String(msg.response?.id || msg.response_id || msg.item?.id || '') ||
          generateEventId('qwen_resp');

        // If this response is already in the suppressed set, ignore it
        if (this.qwenSuppressedResponseIds.has(newRespId)) {
          return;
        }

        this.suppressOutput = false;
        this.ttsActive = true;
        // A fresh response starts with a clean arbitration record; drop any
        // stale record from an earlier response so held/injected state can
        // never bleed across turns.
        this.qwenFamilyState = {};
        this.activeTurnId = newRespId;
        this.activeResponseId = newRespId;
        this.aiAcc = '';
        this.turnHadAudio = false;
        this.emit('agent_audio_start', { responseId: newRespId });
        break;
      }

      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.text': {
        // Two defensive shapes (mirrors VoiceSpirit qwen provider): `.delta`
        // is an incremental fragment of THIS item's transcript → accumulate
        // per item_id; `.text` (+ optional `stash`) is a cumulative frame →
        // wholesale replace. Emitting raw fragments as full interim text made
        // the recognition box flash only the last syllable.
        const itemId = String(msg.item_id || 'qwen_item');
        let interimText;
        if (msg.delta !== undefined && msg.delta !== null) {
          interimText = (this.qwenInterimByItem[itemId] || '') + String(msg.delta);
        } else {
          interimText = String(msg.text || '') + String(msg.stash || '');
        }
        this.qwenInterimByItem[itemId] = interimText;
        const interimIds = Object.keys(this.qwenInterimByItem);
        if (interimIds.length > 8) {
          delete this.qwenInterimByItem[interimIds[0]];
        }
        if (interimText.trim()) this.emit('speech_interim', interimText);
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        delete this.qwenInterimByItem[String(msg.item_id || '')];
        const transcript = (msg.transcript || '').trim();
        if (transcript) {
          this.adaptVoiceForLanguage(detectPrimaryLanguage(transcript));
          this.emit('speech_final', transcript);
        }
        break;
      }

      case 'response.audio.delta': {
        const rid = String(msg.response_id || this.activeTurnId || '');
        if (this.suppressOutput || (rid && this.qwenSuppressedResponseIds.has(rid))) return;
        const delta = msg.delta || '';
        if (delta) {
          this.ttsActive = true;
          this.turnHadAudio = true;
          const audioBuffer = Buffer.from(delta, 'base64');
          this.emit('agent_audio_chunk', {
            buffer: audioBuffer,
            audioBase64: delta,
            sampleRate: 24000,
            turnId: this.activeTurnId,
          });
        }
        break;
      }

      case 'response.text.delta':
      case 'response.audio_transcript.delta': {
        const responseId = String(msg.response_id || this.activeTurnId || 'qwen_resp');
        if (this.suppressOutput || this.qwenSuppressedResponseIds.has(responseId)) return;
        const family = type.startsWith('response.audio_transcript') ? 'audio_transcript' : 'text';
        const chunks = this.arbitrateQwenTextDelta(responseId, family, String(msg.delta || ''));
        for (const text of chunks) {
          // aiAcc mirrors the arbitrated accumulation so fullText stays the
          // single authoritative transcript for the renderer.
          this.aiAcc = appendAssistantDelta(this.aiAcc, text);
          this.emit('agent_text_delta', { delta: text, fullText: this.aiAcc, turnId: this.activeTurnId });
        }
        break;
      }

      case 'response.audio_transcript.done':
      case 'response.output_text.done': {
        const rid = String(msg.response_id || this.activeTurnId || '');
        if (this.suppressOutput || (rid && this.qwenSuppressedResponseIds.has(rid))) return;
        const finalText = String(msg.transcript || msg.text || '').trim();
        // A done frame is also sent for canceled or incomplete responses.
        // An empty transcript is not a correction to already spoken text! (VoiceSpirit 96aa957)
        if (!finalText) {
          return;
        }
        break;
      }

      case 'response.done': {
        const rid = String(msg.response?.id || this.activeTurnId || '');
        const doneStatus = String(msg.response?.status || '');
        const isInterruptedOrSuppressed =
          this.suppressOutput ||
          (rid && this.qwenSuppressedResponseIds.has(rid)) ||
          doneStatus === 'cancelled' ||
          doneStatus === 'canceled' ||
          doneStatus === 'failed';

        if (isInterruptedOrSuppressed) {
          // A barge-in-cancelled reply still sends its own done (standard
          // behaviour). It must neither settle its held fragment nor fire a
          // completion for speech that was suppressed — and it must not lift
          // the suppression while the barge-in is still active.
          delete this.qwenFamilyState[rid];
          if (rid) this.qwenSuppressedResponseIds.add(rid);
          if (this.qwenSuppressedResponseIds.size > 20) {
            const first = this.qwenSuppressedResponseIds.values().next().value;
            this.qwenSuppressedResponseIds.delete(first);
          }
          return;
        }

        // If exactly one audio_transcript delta arrived it is still HELD
        // awaiting a text claim that never came — force-settle it so the
        // reply does not lose its opening words (VoiceSpirit
        // _emit_held_family_delta).
        const fstate = this.qwenFamilyState[rid];
        if (fstate && !fstate.decided && fstate.heldAudio) {
          const held = fstate.heldAudio.replace(/^\s+/, '');
          fstate.heldAudio = '';
          if (held) {
            fstate.decided = 'audio_transcript';
            fstate.accumulatedText = held;
            this.aiAcc = appendAssistantDelta(this.aiAcc, held);
            this.emit('agent_text_delta', { delta: held, fullText: this.aiAcc, turnId: this.activeTurnId });
          }
        }
        delete this.qwenFamilyState[rid];
        this.suppressOutput = false;
        this.ttsActive = false;
        this.emit('agent_complete', { text: this.aiAcc, response: msg.response, turnId: this.activeTurnId, hadAudio: this.turnHadAudio });
        this.aiAcc = '';
        this.turnHadAudio = false;
        this.activeTurnId = null;
        this.activeResponseId = null;
        break;
      }

      case 'error': {
        const errObj = msg.error || msg;
        const errMsg = typeof errObj === 'object' ? (errObj.message || JSON.stringify(errObj)) : String(errObj);
        const isBenign = QWEN_AUDIO_BENIGN_ERROR_PATTERNS.some((pat) => errMsg.includes(pat));
        if (isBenign) {
          console.log(`[CloudVoiceEngine] Qwen benign server race ignored: ${errMsg}`);
          return;
        }
        console.warn('[CloudVoiceEngine] Qwen event error:', errMsg);
        this.emit('status', { status: 'error', error: errMsg, provider: '阿里千问 (DashScope Realtime)' });
        break;
      }

      default:
        break;
    }
  }

/** Re-sends the persona and voice; Qwen applies a session.update mid-call. */
  sendQwenSessionUpdate() {
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

  /** Barge-in: drops the playing reply's residue and asks the server to cancel it. */
  cancelQwenResponse(wasPlaying) {
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

  /** A user text turn, answered at once. */
  sendQwenUserTurn(text) {
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    }));
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }
}

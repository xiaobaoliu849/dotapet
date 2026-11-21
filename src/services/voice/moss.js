/**
 * MOSS-Live (MOSI) Full-Duplex Realtime Voice Provider.
 * Ported from VoiceSpirit backend/services/realtime_moss_provider.py.
 *
 * Wire protocol (`wss://api.mosi.cn/v1/realtime?model=moss-live-1.0`):
 * - Auth: `Authorization: Bearer <api_key>` on the WebSocket handshake.
 * - Handshake: `attach_session` → `session_attached` → (optional `change_voice`
 *   → `voice_changed`) → `session.update` → `session.updated` → `mic_state`
 *   (`enabled: true`).
 * - Upstream audio: raw binary 16 kHz mono S16LE PCM in 640-byte (20 ms) frames.
 * - Downstream audio: `response.audio.context` JSON paired 1:1 with the next
 *   binary 48 kHz mono S16LE PCM frame.
 * - Playback acks: assistant transcripts are released in step with
 *   `playback.chunk.completed` acks; un-acked turns time out server-side with
 *   `reason: playback_timeout`. `MossPlaybackClock` schedules these acks.
 * - Turn-taking & barge-in run server-side; `response.audio.stop` signals
 *   barge-in and expects `playback.stopped` with `played_audio_ms`.
 */
import WebSocket from 'ws';
import {
  DEFAULT_MOSS_REALTIME_WS_URL,
  DEFAULT_MOSS_REALTIME_MODEL,
  DEFAULT_MOSS_REALTIME_VOICE,
  DEFAULT_MOSS_ENGLISH_VOICE,
  DEFAULT_MOSS_CHINESE_VOICE,
  MOSS_VOICE_CATALOG,
  MOSS_OUTPUT_SAMPLE_RATE,
  MOSS_INPUT_FRAME_BYTES,
  MOSS_PLAYBACK_LEAD_SECONDS,
  CLOUD_KEYS,
  loadEnv,
} from './constants.js';
import { audioBuffer, generateEventId } from './shared.js';

/**
 * Resolves a voice ID or legacy shorthand ('en' / 'zh') into a canonical MOSS
 * voice_name and its language/accent metadata.
 */
export function resolveMossVoice(voiceOrAccent) {
  const raw = String(voiceOrAccent || '').trim() || DEFAULT_MOSS_REALTIME_VOICE;
  if (['en', 'en-us', 'en-gb', 'uk'].includes(raw.toLowerCase())) {
    return { voiceId: DEFAULT_MOSS_ENGLISH_VOICE, ...MOSS_VOICE_CATALOG[DEFAULT_MOSS_ENGLISH_VOICE] };
  }
  if (raw.toLowerCase() === 'zh' || raw.toLowerCase() === 'zh-cn') {
    return { voiceId: DEFAULT_MOSS_CHINESE_VOICE, ...MOSS_VOICE_CATALOG[DEFAULT_MOSS_CHINESE_VOICE] };
  }
  if (MOSS_VOICE_CATALOG[raw]) {
    return { voiceId: raw, ...MOSS_VOICE_CATALOG[raw] };
  }
  // Custom voice UUID supplied by user: default to English unless explicitly marked
  return { voiceId: raw, lang: 'en', accent: 'en-US', label: raw };
}

export function normalizeMossAccent(voiceOrAccent) {
  return resolveMossVoice(voiceOrAccent).lang;
}

/**
 * Schedules `playback.chunk.completed` / `playback.completed` / `playback.stopped`
 * acknowledgements on the timeline a client audio player plays them.
 */
export class MossPlaybackClock {
  constructor(sendJson, { clock = () => Date.now() / 1000, leadSeconds = MOSS_PLAYBACK_LEAD_SECONDS } = {}) {
    this._sendJson = sendJson;
    this._clock = clock;
    this._leadSeconds = leadSeconds;
    this._queue = [];
    this._doneRuns = new Set();
    this._runTurns = new Map();
    this._playedMsByRun = new Map();
    this._timer = null;
    this._disposed = false;
  }

  addChunk(ctx = {}, nbytes = 0) {
    if (this._disposed || nbytes <= 0) return;
    const duration = nbytes / (MOSS_OUTPUT_SAMPLE_RATE * 2);
    const now = this._clock();
    const prevEnd = this._queue.length ? this._queue[this._queue.length - 1].end : 0;
    const start = Math.max(now + this._leadSeconds, prevEnd);
    this._queue.push({
      ctx: { chunk_id: ctx.chunk_id, run_id: ctx.run_id, turn_id: ctx.turn_id },
      start,
      end: start + duration,
    });
    this._schedule();
  }

  noteRunTurn(runId, turnId) {
    if (runId) this._runTurns.set(runId, turnId || '');
  }

  markAudioDone(runId) {
    if (this._disposed || !runId) return;
    this._doneRuns.add(runId);
    this._completeFinishedRuns();
  }

  stop(runId = '', turnId = '') {
    let playedMs = runId ? (this._playedMsByRun.get(runId) || 0) : 0;
    if (this._queue.length) {
      const head = this._queue[0];
      playedMs += Math.round(Math.max(0, Math.min(this._clock(), head.end) - head.start) * 1000);
    }
    this._queue = [];
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (runId) {
      this._doneRuns.delete(runId);
      this._playedMsByRun.delete(runId);
    }
    this._sendJson({
      action: 'playback.stopped',
      run_id: runId,
      turn_id: turnId,
      played_audio_ms: playedMs,
    });
  }

  _completeFinishedRuns() {
    if (this._disposed || this._queue.length) return;
    for (const runId of this._doneRuns) {
      const turnId = this._runTurns.get(runId) || '';
      this._runTurns.delete(runId);
      this._playedMsByRun.delete(runId);
      this._sendJson({
        action: 'playback.completed',
        run_id: runId,
        turn_id: turnId,
      });
    }
    this._doneRuns.clear();
  }

  _schedule() {
    if (this._disposed) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._queue.length) {
      this._completeFinishedRuns();
      return;
    }
    const delayMs = Math.max(0, Math.round((this._queue[0].end - this._clock()) * 1000));
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._disposed) return;
      const head = this._queue.shift();
      if (head) {
        const rId = head.ctx?.run_id;
        if (rId) {
          const chunkMs = Math.round(Math.max(0, head.end - head.start) * 1000);
          this._playedMsByRun.set(rId, (this._playedMsByRun.get(rId) || 0) + chunkMs);
        }
        this._sendJson({ action: 'playback.chunk.completed', ...head.ctx });
      }
      this._schedule();
    }, delayMs);
    this._timer.unref?.();
  }

  dispose() {
    this._disposed = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._queue = [];
    this._doneRuns.clear();
    this._runTurns.clear();
    this._playedMsByRun.clear();
  }
}

/** Mixed into CloudVoiceEngine; `this` is the engine. */
export class MossProvider {
  resetMossState() {
    this.mossPlaybackClock?.dispose();
    this.mossPlaybackClock = null;
    this.mossSessionId = '';
    this.mossHandshakeDone = false;
    this.mossRunId = '';
    this.mossSpeaking = false;
    this.mossAudioStarted = false;
    this.mossAiText = '';
    this.mossUserFinalSent = false;
    this.mossAudioContexts = [];
    this.mossStoppedRuns = new Set();
    this.mossInputPending = Buffer.alloc(0);
  }

  getResolvedMossVoice() {
    return resolveMossVoice(this.mossVoice || this.mossAccent || this.voice || DEFAULT_MOSS_REALTIME_VOICE);
  }

  buildMossSessionConfig() {
    const resolved = this.getResolvedMossVoice();
    const basePrompt = this.getHeroSystemPrompt(resolved.lang);
    let accentRule;
    if (resolved.lang === 'zh') {
      accentRule = '【原生中文口音要求】请全程使用地道、流畅的原生中文（Native Chinese accent）进行实时语音对话，发音自然清晰，贴近母语者日常口语节奏。';
    } else if (resolved.accent === 'en-GB') {
      accentRule = 'Native English Accent Requirement: Speak strictly in natural, idiomatic British English with an authentic native UK English accent, cadence, and phrasing. Never utter Chinese characters, Chinese interjections, or non-English titles — translate any Chinese lore, catchphrases, or user titles into natural English before speaking so every syllable stays in pure native English.';
    } else {
      accentRule = 'Native English Accent Requirement: Speak strictly in natural, idiomatic American English with an authentic native US English accent, cadence, and phrasing. Never utter Chinese characters, Chinese interjections, or non-English titles — translate any Chinese lore, catchphrases, or user titles into natural English before speaking so every syllable stays in pure native English.';
    }
    const instructions = `${basePrompt}\n\n${accentRule}`;
    const personaName = this.currentHero?.nameEn || this.currentHero?.nameZh || 'DotaPet';
    return {
      instructions,
      persona: {
        name: String(personaName).slice(0, 80),
        prompt: instructions.slice(0, 8000),
      },
    };
  }

  connectMossRealtime() {
    loadEnv();
    const apiKey = (this.apiKey || CLOUD_KEYS.moss_api_key || process.env.MOSS_API_KEY || '').trim();
    if (!apiKey) {
      this.emit('status', {
        status: 'error',
        providerId: 'moss',
        provider: 'MOSS-Live 全双工语音',
        error: 'MOSS API Key 未配置，请打开 AI 设置。',
      });
      return;
    }

    const rawModel = String(this.mossModel || this.model || DEFAULT_MOSS_REALTIME_MODEL).trim();
    const model = rawModel.startsWith('moss-live') ? rawModel : DEFAULT_MOSS_REALTIME_MODEL;
    const endpoint = (CLOUD_KEYS.moss_ws_url || process.env.MOSS_WS_URL || DEFAULT_MOSS_REALTIME_WS_URL).trim();
    const wsUrl = `${endpoint}?model=${encodeURIComponent(model)}`;

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.resetMossState();
    this.emit('status', {
      status: 'connecting',
      providerId: 'moss',
      provider: 'MOSS-Live 全双工语音',
      ...(this.sessionRestarting && { restarting: true }),
    });

    const ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'DotaPet/MOSS-Live',
      },
    });
    this.ws = ws;
    const isStale = () => this.ws !== ws;

    const sendJson = (payload) => {
      if (isStale() || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        console.warn('[CloudVoiceEngine] MOSS send error:', err?.message || err);
      }
    };
    this.mossPlaybackClock = new MossPlaybackClock(sendJson);

    ws.on('open', () => {
      if (isStale()) return;
      sendJson({ action: 'attach_session' });
    });

    ws.on('message', (raw, isBinary) => {
      if (isStale()) return;
      this.handleMossMessage(raw, Boolean(isBinary), sendJson);
    });

    ws.on('unexpected-response', (_req, res) => {
      if (isStale()) return;
      const code = res?.statusCode;
      this.isConnecting = false;
      this.isConnected = false;
      const msg = (code === 401 || code === 403)
        ? `MOSS-Live 鉴权失败 (HTTP ${code})：API Key 无效或已过期。`
        : `MOSS-Live WebSocket 连接被拒绝 (HTTP ${code || 'error'})。`;
      this.emit('status', { status: 'error', providerId: 'moss', provider: 'MOSS-Live 全双工语音', error: msg });
      try { ws.close(); } catch {}
    });

    ws.on('error', (err) => {
      if (isStale()) return;
      this.isConnecting = false;
      this.emit('status', {
        status: 'error',
        providerId: 'moss',
        provider: 'MOSS-Live 全双工语音',
        error: err?.message || 'MOSS-Live 连接错误',
      });
    });

    ws.on('close', (code, reason) => {
      if (isStale()) return;
      this.ws = null;
      this.isConnected = false;
      this.isConnecting = false;
      this.stopHeartbeat();
      this.mossPlaybackClock?.dispose();
      this.mossPlaybackClock = null;
      if (code === 1008) {
        this.emit('status', {
          status: 'error',
          providerId: 'moss',
          provider: 'MOSS-Live 全双工语音',
          error: `MOSS-Live 会话参数无效 (${reason || code})`,
        });
      }
      if (this.suppressReconnect) {
        this.emit('status', { status: 'disconnected', providerId: 'moss', provider: '未连接' });
        return;
      }
      this.scheduleReconnect();
    });
  }

  _emitMossTranscript(rawText) {
    const text = String(rawText || '');
    if (!text || text === this.mossAiText) return;
    const novel = text.startsWith(this.mossAiText) ? text.slice(this.mossAiText.length) : text;
    this.mossAiText = text;
    this.aiAcc = text;
    if (novel) {
      this.activeTurnId = this.activeTurnId || generateEventId('mturn');
      this.emit('agent_text_delta', { delta: novel, fullText: text, turnId: this.activeTurnId });
    }
  }

  _mossInterrupt({ preserveText = false } = {}) {
    if (!this.mossSpeaking && !this.ttsActive) return;
    this.mossSpeaking = false;
    this.mossAudioStarted = false;
    this.ttsActive = false;
    if (this.mossRunId) this.mossStoppedRuns.add(this.mossRunId);
    if (!preserveText) {
      this.mossAiText = '';
      this.aiAcc = '';
    }
    this.turnHadAudio = false;
    this.emit('interrupted', { interrupted: true });
  }

  handleMossMessage(raw, isBinary, sendJson) {
    if (isBinary) {
      const buf = audioBuffer(raw);
      if (!buf || !buf.length) return;
      const ctx = this.mossAudioContexts.shift() || {};
      const runId = String(ctx.run_id || '');
      if (runId && this.mossStoppedRuns.has(runId)) {
        return; // tail of a turn the server already cut off
      }
      this.mossPlaybackClock?.addChunk(ctx, buf.length);
      if (!this.mossAudioStarted) {
        this.mossAudioStarted = true;
        this.ttsActive = true;
        this.activeTurnId = this.activeTurnId || generateEventId('mturn');
        this.emit('agent_audio_start', { responseId: this.activeTurnId });
      }
      this.turnHadAudio = true;
      this.emit('agent_audio_chunk', {
        buffer: buf,
        audioBase64: buf.toString('base64'),
        sampleRate: MOSS_OUTPUT_SAMPLE_RATE,
        turnId: this.activeTurnId,
      });
      return;
    }

    let event;
    try {
      const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
      event = JSON.parse(text);
    } catch {
      return;
    }

    const action = String(event?.action || '');
    const data = event?.data || {};
    const runId = String(data.run_id || '');
    const turnId = String(data.turn_id || '');

    // Handshake: attach_session → session_attached → (change_voice → voice_changed) → session.update → session.updated → mic_state
    if (action === 'session_attached' && !this.mossHandshakeDone) {
      this.mossSessionId = String(data.session_id || '');
      this.sessionId = this.mossSessionId;
      const { voiceId } = this.getResolvedMossVoice();
      if (voiceId && voiceId !== 'default') {
        sendJson({ action: 'change_voice', voice_name: voiceId });
      } else {
        sendJson({ action: 'session.update', session: this.buildMossSessionConfig() });
      }
      return;
    }

    if (action === 'voice_changed' && !this.mossHandshakeDone) {
      sendJson({ action: 'session.update', session: this.buildMossSessionConfig() });
      return;
    }

    if (action === 'session.updated' && !this.mossHandshakeDone) {
      if (data.error) {
        this.isConnecting = false;
        this.emit('status', {
          status: 'error',
          providerId: 'moss',
          provider: 'MOSS-Live 全双工语音',
          error: `MOSS-Live 会话配置失败: ${JSON.stringify(data.error)}`,
        });
        try { this.ws?.close(); } catch {}
        return;
      }
      this.mossHandshakeDone = true;
      sendJson({ action: 'mic_state', enabled: true });
      this.isConnected = true;
      this.isConnecting = false;
      this.startHeartbeat();
      this.emit('status', {
        status: 'connected',
        providerId: 'moss',
        provider: 'MOSS-Live 全双工语音',
      });
      this.emit('session_ready', { sessionId: this.sessionId, provider: 'MOSS' });
      return;
    }

    // Live turn events
    if (action === 'input.speech.started') {
      this.mossUserFinalSent = false;
      return;
    }

    if (action === 'input.transcript.updated') {
      const snapshot = String(data.text || '');
      if (snapshot) this.emit('speech_interim', snapshot);
      return;
    }

    if (action === 'input.transcript.done') {
      const transcript = String(data.text || '').trim();
      if (!transcript || this.mossUserFinalSent) return;
      this.mossUserFinalSent = true;
      this.emit('speech_final', transcript);
      return;
    }

    if (action === 'response.audio.started') {
      this.mossRunId = runId;
      this.mossSpeaking = true;
      this.mossAudioStarted = false;
      this.mossAiText = '';
      this.aiAcc = '';
      this.turnHadAudio = false;
      this.suppressOutput = false;
      this.activeTurnId = generateEventId('mturn');
      this.mossPlaybackClock?.noteRunTurn(runId, turnId);
      return;
    }

    if (action === 'response.audio.context') {
      this.mossAudioContexts.push({ ...data });
      return;
    }

    if (action === 'output.transcript.updated' || action === 'output.transcript.done') {
      // Even if `response.audio.stop` arrived first on a barge-in, MOSS-Live sends the
      // final spoken transcript snapshot right after `response.audio.stop`. Emit any
      // novel text so interrupted replies are still visible in the transcript panel.
      this._emitMossTranscript(data.text);
      return;
    }

    if (action === 'response.audio.done') {
      this.mossPlaybackClock?.markAudioDone(runId);
      return;
    }

    if (action === 'response.audio.stop') {
      if (runId) this.mossStoppedRuns.add(runId);
      this.mossPlaybackClock?.stop(runId, turnId);
      if (data.text) this._emitMossTranscript(data.text);
      this._mossInterrupt({ preserveText: true });
      return;
    }

    if (action === 'response.interrupted') {
      if (data.text) this._emitMossTranscript(data.text);
      this._mossInterrupt();
      return;
    }

    if (action === 'response.ended') {
      if (runId && this.mossStoppedRuns.has(runId)) {
        this.mossStoppedRuns.delete(runId);
        return;
      }
      const status = String(data.status || '');
      if (status === 'aborted') {
        this._mossInterrupt();
        return;
      }
      this.mossSpeaking = false;
      this.mossAudioStarted = false;
      this.ttsActive = false;
      const text = this.mossAiText || this.aiAcc;
      const hadAudio = this.turnHadAudio;
      this.mossAiText = '';
      this.aiAcc = '';
      this.turnHadAudio = false;
      this.emit('agent_complete', { text, turnId: this.activeTurnId, hadAudio });
      this.activeTurnId = null;
      return;
    }

    if (action === 'error') {
      const err = data.error || {};
      const message = String(err.message || err.code || JSON.stringify(data || event));
      if (!this.mossHandshakeDone) this.isConnecting = false;
      this.emit('status', {
        status: 'error',
        providerId: 'moss',
        provider: 'MOSS-Live 全双工语音',
        error: `MOSS-Live 服务错误: ${message}`,
      });
    }
  }

  sendMossAudio(chunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = audioBuffer(chunk);
    if (!buf || !buf.length) return;
    this.mossInputPending = Buffer.concat([this.mossInputPending, buf]);
    while (this.mossInputPending.length >= MOSS_INPUT_FRAME_BYTES) {
      const frame = this.mossInputPending.subarray(0, MOSS_INPUT_FRAME_BYTES);
      this.mossInputPending = this.mossInputPending.subarray(MOSS_INPUT_FRAME_BYTES);
      try {
        this.ws.send(frame, { binary: true });
      } catch (err) {
        console.error('[CloudVoiceEngine] MOSS audio chunk error:', err);
        break;
      }
    }
  }

  sendMossSessionUpdate({ includeVoice = false } = {}) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      if (includeVoice) {
        const { voiceId } = this.getResolvedMossVoice();
        if (voiceId && voiceId !== 'default') {
          this.ws.send(JSON.stringify({ action: 'change_voice', voice_name: voiceId }));
        }
      }
      this.ws.send(JSON.stringify({
        action: 'session.update',
        session: this.buildMossSessionConfig(),
      }));
    } catch (err) {
      console.warn('[CloudVoiceEngine] MOSS session.update error:', err);
    }
  }

  closeMoss() {
    this.resetMossState();
  }
}

/** Cartesia Ink-2 STT + DeepSeek-Flash LLM + Sonic TTS: the English practice pipeline. */
import WebSocket from 'ws';
import { stripMarkdownForTts } from '../transcriptStream.js';
import {
  CARTESIA_VERSION, DEFAULT_CARTESIA_VOICE, DEFAULT_CARTESIA_MODEL, CLOUD_KEYS, loadEnv,
} from './constants.js';
import { audioBuffer, generateEventId } from './shared.js';

/** Mixed into CloudVoiceEngine; `this` is the engine. */
export class CartesiaProvider {
  connectCartesiaPipeline() {
    loadEnv();
    const cartesiaKey = this.apiKey || CLOUD_KEYS.cartesia;

    if (!cartesiaKey || !CLOUD_KEYS.cartesia_llm_key) {
      this.emit('status', { status: 'error', providerId: 'cartesia', error: '缺少 Cartesia 或 DeepSeek 密钥，请打开 AI 设置。', provider: 'Cartesia + DeepSeek' });
      return;
    }

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.cartesiaIsSttOpen = false;
    this.cartesiaIsTtsOpen = false;
    this.emit('status', { status: 'connecting', providerId: 'cartesia', provider: 'Cartesia + DeepSeek (English Voice 对局纯英对练)' });

    const sttUrl = `wss://api.cartesia.ai/stt/turns/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&cartesia_version=${CARTESIA_VERSION}&language=en`;
    const ttsUrl = `wss://api.cartesia.ai/tts/websocket?cartesia_version=${CARTESIA_VERSION}`;

    const headers = {
      Authorization: `Bearer ${cartesiaKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
    };

    try {
      // 1. Connect Cartesia Ink-2 STT WebSocket
      const sttSocket = new WebSocket(sttUrl, { headers });
      this.cartesiaSttWs = sttSocket;

      sttSocket.on('open', () => {
        if (this.cartesiaSttWs !== sttSocket) return;
        this.cartesiaIsSttOpen = true;
        this.checkCartesiaReady();
      });

      sttSocket.on('message', (data) => {
        if (this.cartesiaSttWs !== sttSocket) return;
        try {
          const event = JSON.parse(data.toString());
          this.handleCartesiaSttEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Cartesia STT message error:', e);
        }
      });

      sttSocket.on('error', (err) => {
        if (this.cartesiaSttWs !== sttSocket) return;
        console.warn('[CloudVoiceEngine] Cartesia STT WS error:', err.message);
      });

      sttSocket.on('close', (code, reason) => {
        if (this.cartesiaSttWs !== sttSocket) return;
        this.cartesiaIsSttOpen = false;
        console.log(`[CloudVoiceEngine] Cartesia STT WS closed: code=${code}`);
        if (code === 401) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: 'Cartesia 鉴权失败 (HTTP 401)。请检查 Cartesia API Key 是否有效。',
            provider: 'Cartesia + DeepSeek-Flash',
          });
          return;
        }
        // Clear the "both sockets open" flag or the reconnect guard will
        // believe a live session still exists and refuse to schedule.
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });

      // 2. Connect Cartesia Sonic TTS WebSocket
      const ttsSocket = new WebSocket(ttsUrl, { headers });
      this.cartesiaTtsWs = ttsSocket;

      ttsSocket.on('open', () => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        this.cartesiaIsTtsOpen = true;
        this.checkCartesiaReady();
      });

      ttsSocket.on('message', (data) => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        try {
          const event = JSON.parse(data.toString());
          this.handleCartesiaTtsEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Cartesia TTS message error:', e);
        }
      });

      ttsSocket.on('error', (err) => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        console.warn('[CloudVoiceEngine] Cartesia TTS WS error:', err.message);
      });

      ttsSocket.on('close', (code, reason) => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        this.cartesiaIsTtsOpen = false;
        console.log(`[CloudVoiceEngine] Cartesia TTS WS closed: code=${code}`);
        if (code === 401) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: 'Cartesia 鉴权失败 (HTTP 401)。请检查 Cartesia API Key 是否有效。',
            provider: 'Cartesia + DeepSeek-Flash',
          });
          return;
        }
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Cartesia WS:', err);
      this.emit('status', { status: 'error', error: err.message, provider: 'Cartesia + DeepSeek-Flash' });
    }
  }

  checkCartesiaReady() {
    if (this.cartesiaIsSttOpen && this.cartesiaIsTtsOpen) {
      this.isConnected = true;
      this.isConnecting = false;
      this.suppressOutput = false;
      this.sessionId = generateEventId('sess_cartesia');
      console.log('[CloudVoiceEngine] Connected to Cartesia (Ink-2 STT + Sonic TTS) & DeepSeek-Flash Engine');
      this.emit('status', { status: 'connected', providerId: 'cartesia', provider: 'Cartesia + DeepSeek-Flash (极速流)' });
      this.emit('session_ready', { sessionId: this.sessionId, provider: 'Cartesia-DeepSeek' });
    }
  }

  handleCartesiaSttEvent(event) {
    if (!event) return;
    const type = event.type || '';

    switch (type) {
      case 'turn.start':
        // Semantic barge-in: user started speaking
        console.log('[CloudVoiceEngine] Cartesia Ink-2: turn.start (Barge-in)');
        this.interruptCartesia();
        this.emit('user_speech_start');
        break;

      case 'turn.end': {
        const transcript = (event.transcript || '').trim();
        console.log('[CloudVoiceEngine] Cartesia Ink-2: turn.end ->', transcript);
        this.emit('user_speech_end');
        if (transcript) {
          this.emit('speech_final', transcript);
          this.startCartesiaTurn(transcript);
        }
        break;
      }

      case 'error':
        console.warn('[CloudVoiceEngine] Cartesia STT error event:', event.message || event);
        break;

      default:
        break;
    }
  }

  handleCartesiaTtsEvent(event) {
    if (!event) return;
    const type = event.type || '';
    const contextId = event.context_id || '';

    if (type === 'chunk') {
      if (this.suppressOutput || (this.cartesiaContextId && contextId !== this.cartesiaContextId)) {
        return;
      }
      const audioB64 = event.data || event.audio || '';
      if (audioB64) {
        this.ttsActive = true;
        this.turnHadAudio = true;
        const buffer = Buffer.from(audioB64, 'base64');
        this.emit('agent_audio_chunk', {
          buffer: buffer,
          audioBase64: audioB64,
          sampleRate: 24000,
          turnId: contextId,
        });
      }
    } else if (type === 'done') {
      if (this.cartesiaContextId && contextId === this.cartesiaContextId) {
        this.ttsActive = false;
        this.emit('agent_complete', { text: this.aiAcc, turnId: contextId, hadAudio: this.turnHadAudio });
        this.aiAcc = '';
        this.turnHadAudio = false;
        this.cartesiaContextId = null;
      }
    } else if (type === 'error') {
      console.warn('[CloudVoiceEngine] Cartesia TTS error event:', event.message || event.error);
    }
  }

  interruptCartesia() {
    this.suppressOutput = true;
    this.ttsActive = false;
    this.emit('interrupted', { interrupted: true });

    if (this.cartesiaAbortController) {
      try {
        this.cartesiaAbortController.abort();
      } catch (e) {}
      this.cartesiaAbortController = null;
    }

    if (this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN && this.cartesiaContextId) {
      try {
        this.cartesiaTtsWs.send(JSON.stringify({ context_id: this.cartesiaContextId, cancel: true }));
      } catch (e) {}
    }
  }

  async startCartesiaTurn(userText) {
    if (!userText || !userText.trim()) return;
    const trimmed = userText.trim();

    this.interruptCartesia();
    this.suppressOutput = false;
    this.ttsActive = true;

    const contextId = generateEventId('turn_car');
    this.cartesiaContextId = contextId;
    this.activeTurnId = contextId;
    this.aiAcc = '';
    this.turnHadAudio = false;

    this.emit('agent_audio_start', { responseId: contextId });

    const baseTtsMsg = {
      model_id: CLOUD_KEYS.cartesia_model || DEFAULT_CARTESIA_MODEL,
      voice: { mode: 'id', id: CLOUD_KEYS.cartesia_voice_id || DEFAULT_CARTESIA_VOICE },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
      language: 'en',
      context_id: contextId,
      max_buffer_delay_ms: 300,
    };

    this.cartesiaHistory.push({ role: 'user', content: trimmed });
    if (this.cartesiaHistory.length > 20) {
      this.cartesiaHistory = this.cartesiaHistory.slice(-20);
    }

    this.cartesiaAbortController = new AbortController();

    const apiKey = CLOUD_KEYS.cartesia_llm_key;
    const apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    const model = 'deepseek-flash';

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        signal: this.cartesiaAbortController.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: this.getHeroSystemPrompt('en') },
            ...this.cartesiaHistory,
          ],
          temperature: 0.7,
          thinking: { type: 'disabled' },
          max_tokens: 300,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullAssistantText = '';
      // SSE frames are newline-delimited but TCP reads are not: buffer the
      // trailing partial line across reads instead of JSON.parse-ing it and
      // silently swallowing the delta inside the catch below.
      let lineBuf = '';

      const consumeLine = (line) => {
        const l = line.trim();
        if (!l.startsWith('data: ') || l === 'data: [DONE]') return;
        try {
          const parsed = JSON.parse(l.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta && !this.suppressOutput) {
            // Clean BPE token delta: whitespace is authoritative — append
            // verbatim, never trim / re-space / dedup (see docs/
            // realtime-transcript-integrity.md §1.1).
            fullAssistantText += delta;
            this.aiAcc = fullAssistantText;
            this.emit('agent_text_delta', { delta, fullText: fullAssistantText, turnId: contextId });

            // Stream delta chunk to Cartesia Sonic TTS WS
            const cleanDelta = stripMarkdownForTts(delta);
            if (cleanDelta && this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN) {
              this.cartesiaTtsWs.send(JSON.stringify({
                ...baseTtsMsg,
                transcript: cleanDelta,
                continue: true,
              }));
            }
          }
        } catch (e) {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split('\n');
        // The last element is an unfinished line unless the chunk ended on \n.
        lineBuf = lines.pop() ?? '';

        for (const line of lines) {
          consumeLine(line);
        }
      }
      // Flush any final unterminated line still sitting in the buffer.
      if (lineBuf) {
        consumeLine(lineBuf);
      }

      // Finish Sonic TTS context stream
      if (this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN && !this.suppressOutput) {
        this.cartesiaTtsWs.send(JSON.stringify({
          ...baseTtsMsg,
          transcript: '',
          continue: false,
        }));
      }

      if (fullAssistantText) {
        this.cartesiaHistory.push({ role: 'assistant', content: fullAssistantText });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[CloudVoiceEngine] Cartesia turn generation error:', err);
      this.emit('agent_text_delta', { delta: `【${this.currentHero?.nameZh || '英雄'}】: 正在待命！` });
      if (this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN) {
        try {
          this.cartesiaTtsWs.send(JSON.stringify({ ...baseTtsMsg, transcript: '', continue: false }));
        } catch (e) {}
      }
    }
  }

/** Raw PCM to the Ink-2 STT socket. */
  sendCartesiaAudio(chunk) {
    if (!this.cartesiaSttWs || this.cartesiaSttWs.readyState !== WebSocket.OPEN) return;
    const binaryBuffer = audioBuffer(chunk);
    if (!binaryBuffer || binaryBuffer.length === 0) return;
    try {
      this.cartesiaSttWs.send(binaryBuffer);
    } catch (err) {
      console.error('[CloudVoiceEngine] Cartesia STT send error:', err);
    }
  }

  /** Closes the STT/TTS sockets and aborts a DeepSeek turn still streaming. */
  closeCartesia() {
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
  }
}

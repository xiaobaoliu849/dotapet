import EventEmitter from 'events';
import { CloudVoiceEngine, CLOUD_KEYS } from './cloudVoiceEngine.js';

/**
 * VoiceSpirit Real-time Duplex Client
 * Seamlessly connects directly to Cloud Duplex Voice Stream (Doubao / DashScope / DeepSeek)
 *
 * Connection is LAZY: constructing the client opens nothing. A socket exists
 * only after connect() is called — which in the companion happens exclusively
 * from an explicit user provider selection (tray / pet menu / IPC). Never
 * default a provider here: the engine's own default (env override -> cartesia)
 * is the single source of truth, and a hardcoded one made every startup dial
 * Doubao without the user asking for it.
 */
export class VoiceSpiritClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.currentHero = config.currentHero || null;
    this.cloudEngine = new CloudVoiceEngine({
      currentHero: this.currentHero,
      voice: config.voice || 'Tina',
      doubaoVoice: config.doubaoVoice || 'zh_female_xiaohe_jupiter_bigtts',
      model: config.model || '1.2.6.1',
      apiKey: config.apiKey || null,
      provider: config.provider,
      translateTargetLanguage: config.translateTargetLanguage,
      autoReconnect: config.autoReconnect,
    });
    this.isConnected = false;

    // Relay events from cloud engine to client listeners
    this.cloudEngine.on('status', (data) => {
      this.isConnected = (data.status === 'connected');
      this.emit('status', data);
    });

    this.cloudEngine.on('session_ready', (data) => {
      this.emit('session_ready', data);
    });

    this.cloudEngine.on('speech_interim', (text) => {
      this.emit('speech_interim', text);
    });

    this.cloudEngine.on('speech_final', (text) => {
      this.emit('speech_final', text);
    });

    this.cloudEngine.on('agent_audio_start', (data) => {
      this.emit('agent_audio_start', data);
    });

    this.cloudEngine.on('agent_text_delta', (data) => {
      this.emit('agent_text_delta', data);
    });

    this.cloudEngine.on('agent_audio_chunk', (data) => {
      this.emit('agent_audio_chunk', data);
    });

    this.cloudEngine.on('agent_complete', (data) => {
      this.emit('agent_complete', data);
    });

    this.cloudEngine.on('user_speech_start', () => {
      this.emit('user_speech_start');
    });

    this.cloudEngine.on('user_speech_end', () => {
      this.emit('user_speech_end');
    });

    this.cloudEngine.on('interrupted', (data) => {
      this.emit('interrupted', data);
    });
  }

  /**
   * Set & inject active DOTA 2 hero persona dynamically
   * @param {Object} heroConfig
   */
  setHero(heroConfig) {
    this.currentHero = heroConfig;
    if (this.cloudEngine) {
      this.cloudEngine.setHero(heroConfig);
    }
  }

  setProvider(provider) {
    if (!this.cloudEngine) return;
    // No provider selected (tray "断开" / pet menu cycling back to idle):
    // tear the socket down instead of letting the engine fall through to its
    // default-pipeline connect().
    if (!provider) {
      this.disconnect();
      return;
    }
    this.cloudEngine.setProvider(provider);
  }

  /**
   * Change the Live Translate target language (BCP-47, e.g. 'en',
   * 'zh-Hans'). Applies immediately to a running google-translate session
   * (the engine reconnects); a no-op for every other provider.
   */
  setTranslateTargetLanguage(langCode) {
    this.cloudEngine?.setTranslateTargetLanguage(langCode);
  }

  connect() {
    if (this.cloudEngine) {
      this.cloudEngine.connect();
    }
  }

  /**
   * Trigger barge-in / interruption
   */
  interrupt() {
    if (this.cloudEngine) {
      this.cloudEngine.interrupt();
    }
  }

  /**
   * Send microphone PCM audio chunk (16kHz 16-bit mono) to cloud engine
   * @param {Buffer|ArrayBuffer|string} audioData
   */
  sendAudioChunk(audioData) {
    if (this.cloudEngine) {
      this.cloudEngine.sendAudioChunk(audioData);
    }
  }

  /**
   * Send text prompt / query to cloud duplex LLM
   * @param {string} text
   */
  sendUserText(text) {
    if (this.cloudEngine) {
      this.cloudEngine.sendUserText(text);
    }
  }

  /**
   * Force-commit an in-flight Google utterance (mic switched off mid-speech).
   * No-op for every other provider.
   */
  commitUtterance() {
    if (this.cloudEngine?.commitGoogleUtterance) {
      this.cloudEngine.commitGoogleUtterance();
    }
  }

  disconnect() {
    if (this.cloudEngine) {
      this.cloudEngine.disconnect();
    }
    this.isConnected = false;
  }
}

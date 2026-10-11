/**
 * Streaming Audio Player for real-time AI speech output (PCM 24kHz)
 */
export class StreamAudioPlayer {
  constructor() {
    this.audioCtx = null;
    this.nextStartTime = 0;
    this.sampleRate = 24000;
    this.activeSources = [];
    this.masterGain = null;
  }

  ensureContext() {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: this.sampleRate });
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  isPlaying() {
    return this.activeSources.length > 0 || (this.audioCtx && this.nextStartTime > this.audioCtx.currentTime);
  }

  playPcmChunk(pcmData, sampleRate = 24000) {
    try {
      this.sampleRate = sampleRate;
      this.ensureContext();

      let int16Array;
      if (pcmData instanceof ArrayBuffer) {
        int16Array = new Int16Array(pcmData);
      } else if (pcmData?.buffer && pcmData.buffer instanceof ArrayBuffer) {
        int16Array = new Int16Array(pcmData.buffer, pcmData.byteOffset || 0, (pcmData.byteLength || pcmData.length) / 2);
      } else if (typeof pcmData === 'string') {
        const binary = atob(pcmData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        int16Array = new Int16Array(bytes.buffer);
      }

      if (!int16Array || int16Array.length === 0) return;

      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      const audioBuffer = this.audioCtx.createBuffer(1, float32Array.length, this.sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.masterGain || this.audioCtx.destination);

      const currentTime = this.audioCtx.currentTime;
      // Seamless jitter cushion: if buffer underran or starting fresh, add 60ms head start (VoiceSpirit pattern)
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.06;
      }

      const startAt = Math.max(currentTime + 0.02, this.nextStartTime);
      source.start(startAt);
      this.nextStartTime = startAt + audioBuffer.duration;
      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
      };
    } catch (e) {
      console.warn('[StreamAudioPlayer] Play chunk error:', e);
    }
  }

  reset() {
    this.nextStartTime = 0;
    // Anti-click: smooth linear ramp-down on barge-in interruption before stopping sources
    if (this.masterGain && this.audioCtx && this.audioCtx.state === 'running') {
      try {
        const now = this.audioCtx.currentTime;
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.02);
      } catch (e) {}
    }
    const sourcesToStop = [...this.activeSources];
    this.activeSources = [];
    setTimeout(() => {
      for (const src of sourcesToStop) {
        try {
          src.stop();
          src.disconnect();
        } catch (e) {}
      }
      if (this.masterGain && this.audioCtx) {
        try {
          this.masterGain.gain.setValueAtTime(1, this.audioCtx.currentTime);
        } catch (e) {}
      }
    }, 25);
  }
}

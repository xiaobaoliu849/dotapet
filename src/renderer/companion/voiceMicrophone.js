/**
 * Alt+Q voice capture. One press connects the saved provider, opens the microphone
 * and streams 16kHz PCM to main; the next press closes it, and the paid session is
 * released once any reply has finished speaking. Everything it touches arrives as
 * an argument, so tests can drive it without a page.
 */
export function createVoiceMicrophone({
  state, elements, api, mediaDevices, AudioContextClass, isReplyPlaying,
  setAppState, showToast, showTranscriptPanel,
}) {
  /**
   * Microphone Capture & Web Audio Downsampling
   */
  async function startMicrophone() {
    if (state.isMicStarting || state.isMicActive) return;
    const generation = ++state.microphoneGeneration;
    state.isMicStarting = true;
    const requestId = `${Date.now()}-${generation}`;
    const disconnectGeneration = state.voiceDisconnectGeneration;
    state.voiceConnectionRequest = requestId;
    try {
      // Alt+Q is explicit permission to connect using the saved credentials.
      // The main process waits for provider setup, including Qwen's config ACK.
      state.isVoiceConnecting = true;
      updateTranscriptEmptyHint();
      elements.pttLabel.textContent = '取消连接';
      showToast('正在连接语音，再按 Alt+Q 可取消…', 20000);
      const result = await api.ensureVoiceConnected(requestId);
      if (generation !== state.microphoneGeneration) return;
      state.isVoiceConnecting = false;
      state.voiceConnectionRequest = null;
      if (!result.ok) {
        if (result.cancelled) showToast('语音连接已取消，按 Alt+Q 重试。');
        else {
          showToast(result.error || '连接失败，请按 Alt+Q 重试。', 5000);
          if (result.needsSettings) api?.openAISettings?.('voice');
        }
        return;
      }
      // A ready IPC reply can arrive after a subsequent socket-close event.
      // Never turn that stale success into a microphone start.
      if (disconnectGeneration !== state.voiceDisconnectGeneration) return;
      state.voiceConnected = true;
      elements.pttLabel.textContent = '取消开麦';
      showToast('正在打开麦克风…');
      const stream = await mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (generation !== state.microphoneGeneration || !state.voiceConnected) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      state.mediaStream = stream;
      state.audioContext = new AudioContextClass({ sampleRate: 16000 });
      const source = state.audioContext.createMediaStreamSource(stream);

      const bufferSize = 4096;
      state.scriptProcessor = state.audioContext.createScriptProcessor(bufferSize, 1, 1);

      state.scriptProcessor.onaudioprocess = (e) => {
        if (!state.isMicActive) return;
        const inputData = e.inputBuffer.getChannelData(0);
        
        const pcm16 = new Int16Array(inputData.length);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          sum += s * s;
        }

        const rms = Math.sqrt(sum / inputData.length);
        // Dynamic speech thresholding: raise threshold when companion is speaking to resist speaker bleed
        const isAssistantActive = isReplyPlaying();
        const speechThreshold = isAssistantActive ? 0.06 : 0.025;
        if (rms > speechThreshold) {
          setAppState('listening', '正在说话...');
        }

        if (api) {
          api.sendAudioChunk(pcm16.buffer);
        }
      };

      // Avoid acoustic feedback loop: ScriptProcessorNode requires a downstream connection to keep
      // firing onaudioprocess in Chromium, but connecting directly to destination loops mic into speakers!
      // Route through a zero-gain node instead.
      const muteGain = state.audioContext.createGain();
      muteGain.gain.value = 0;
      source.connect(state.scriptProcessor);
      state.scriptProcessor.connect(muteGain);
      muteGain.connect(state.audioContext.destination);

      state.isMicActive = true;
      updateTranscriptEmptyHint();
      showTranscriptPanel({ force: true });
      elements.btnPttMic.classList.add('active');
      elements.pttLabel.textContent = '停止语音';
      setAppState('listening', '正在聆听...');
      showToast('🎙️ 已开麦，直接说话吧 · 再按 Alt+Q 结束');
    } catch (err) {
      if (generation !== state.microphoneGeneration) return;
      state.mediaStream?.getTracks().forEach(track => track.stop()); state.mediaStream = null;
      state.audioContext?.close().catch(() => {}); state.audioContext = null;
      console.error('Error starting voice:', err);
      showToast(state.isVoiceConnecting ? '连接失败，请按 Alt+Q 重试。' : '麦克风没有打开。请在语音设置里点击「麦克风检查」，查看设备和权限。', 5000);
    } finally {
      if (generation === state.microphoneGeneration) {
        state.isMicStarting = false;
        state.isVoiceConnecting = false;
        state.voiceConnectionRequest = null;
        if (!state.isMicActive) elements.pttLabel.textContent = '语音';
        updateTranscriptEmptyHint();
      }
    }
  }

  /**
   * Per-press billing: once the mic closes, the paid realtime session it dialed
   * is torn down — but only after any in-flight reply has finished speaking, and
   * only if the user has not pressed Alt+Q again in the meantime.
   */
  async function releaseVoiceSessionWhenQuiet(generation) {
    const bridge = api?.releaseVoiceConnection;
    if (typeof bridge !== 'function') { showToast('🎙️ 语音对讲已结束'); return; }
    const started = Date.now();
    const replyPending = () => state.appState === 'thinking' || state.appState === 'speaking' || isReplyPlaying();
    // A just-committed utterance usually starts its reply within a few seconds.
    while (generation === state.microphoneGeneration && !replyPending() && Date.now() - started < 5000) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    while (generation === state.microphoneGeneration && replyPending() && Date.now() - started < 90000) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    // A fresh Alt+Q press owns the mic now; its own stop will release instead.
    if (generation !== state.microphoneGeneration || state.isMicActive || state.isVoiceConnecting) return;
    let released = false;
    try { released = Boolean((await bridge())?.released); } catch { /* toast stays generic */ }
    if (generation !== state.microphoneGeneration) return;
    showToast(released ? '🎙️ 语音已断开，本次计费结束' : '🎙️ 语音对讲已结束');
  }

  function stopMicrophone() {
    const wasConnecting = state.isVoiceConnecting;
    if (state.voiceConnectionRequest) api?.cancelVoiceConnect?.(state.voiceConnectionRequest);
    state.microphoneGeneration++;
    state.isMicStarting = false;
    state.isVoiceConnecting = false;
    state.voiceConnectionRequest = null;
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((t) => t.stop());
      state.mediaStream = null;
    }
    if (state.audioContext) {
      state.audioContext.close().catch(() => {});
      state.audioContext = null;
    }
    state.isMicActive = false;
    updateTranscriptEmptyHint();
    // Flush cached speech when the mic stops; keep the transcript open so the
    // final reply and history remain readable after capture has ended.
    api?.commitVoiceUtterance?.();
    elements.btnPttMic.classList.remove('active');
    elements.pttLabel.textContent = '语音';
    setAppState('idle', '待命中');
    if (wasConnecting) showToast('已取消语音连接');
    else releaseVoiceSessionWhenQuiet(state.microphoneGeneration);
  }

  function toggleMicrophone() {
    if (state.isMicActive || state.isMicStarting) {
      stopMicrophone();
    } else {
      startMicrophone();
    }
  }

  /**
   * The empty transcript tells the user what the voice session is doing right now:
   * Alt+Q already opens the mic, so it must never ask them to start it again.
   */
  function updateTranscriptEmptyHint() {
    if (!elements.transcriptEmpty) return;
    elements.transcriptEmpty.textContent = state.isMicActive ? '正在聆听，直接开口说话吧'
      : state.isMicStarting ? '正在连接语音…'
        : '还没有对话，按 Alt+Q 开始语音吧';
  }

  /**
   * Mirrors the engine's real session liveness: the mic gate trusts this instead
   * of guessing from UI state.
   */
  function handleVoiceStatus(statusData) {
    const wasConnected = state.voiceConnected;
    if (['error', 'disconnected'].includes(statusData?.status)) state.voiceDisconnectGeneration++;
    // A session restarting for a new persona (Google Live) is the same call:
    // the mic stays open, and the engine ends the call if it never returns.
    const restarting = statusData?.status === 'connecting' && statusData.restarting;
    if (!restarting) state.voiceConnected = statusData?.status === 'connected';
    if (state.voiceConnected && !wasConnected) showTranscriptPanel({ force: true });
    if (!state.voiceConnected && (state.isMicActive || (state.isMicStarting && !state.isVoiceConnecting))) stopMicrophone();
  }

  return { start: startMicrophone, stop: stopMicrophone, toggle: toggleMicrophone, handleVoiceStatus };
}

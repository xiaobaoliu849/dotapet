// Shared by welcome and settings. No recorder, IPC audio or network connection.
(() => {
  const get = id => document.getElementById(id);
  let stream, context, timer, frame, generation = 0, checking = false;
  const message = text => { get('mic-status').textContent = text; };
  function release() {
    clearTimeout(timer); cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    if (context) { context.close().catch(() => {}); context = null; }
    get('mic-level').style.width = '0%';
    get('mic-level').parentElement.setAttribute('aria-valuenow', '0');
  }
  function stop(text) {
    if (!checking) return;
    generation++; checking = false; release();
    get('mic-start').disabled = false; get('mic-stop').hidden = true;
    message(text || '检查已停止，麦克风已关闭。');
  }
  window.stopMicrophoneCheck = () => stop();
  get('mic-stop').addEventListener('click', () => stop());
  get('mic-privacy').addEventListener('click', async () => {
    const response = window.welcomeAPI ? await window.welcomeAPI.action('mic-privacy') : await window.electronAPI?.openMicrophonePrivacy?.();
    if (!response?.ok) message(response?.error || '请打开 Windows 设置 → 隐私和安全性 → 麦克风，允许桌面应用访问。');
  });
  get('mic-start').addEventListener('click', async () => {
    if (checking) return;
    const current = ++generation;
    checking = true;
    get('mic-start').disabled = true; get('mic-stop').hidden = false; get('mic-privacy').hidden = true;
    message('正在打开麦克风…');
    let peak = 0;
    // This timer also invalidates a delayed permissions/device response.
    timer = setTimeout(() => stop('等待麦克风超时。请检查设备和 Windows 麦克风权限后重试。'), 12000);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (current !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      context = new (window.AudioContext || window.webkitAudioContext)();
      const audioContext = context;
      const analyser = context.createAnalyser(); analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      await context.resume();
      if (current !== generation) return;
      const values = new Float32Array(analyser.fftSize);
      const device = stream.getAudioTracks()[0]?.label || '默认麦克风';
      message(`正在检查：${device}。说句话，看看音量条有没有变化。`);
      clearTimeout(timer);
      timer = setTimeout(() => stop(peak > 0.008
        ? '听到声音了！麦克风检查通过，麦克风已关闭。'
        : '设备已打开，但没有检测到明显声音。请检查系统输入音量、静音开关或换一个默认输入设备。麦克风已关闭。'), 10000);
      const sample = () => {
        if (current !== generation || audioContext.state === 'closed') return;
        analyser.getFloatTimeDomainData(values);
        const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
        peak = Math.max(peak, rms);
        const level = Math.min(100, Math.round(rms * 600));
        get('mic-level').style.width = `${level}%`;
        get('mic-level').parentElement.setAttribute('aria-valuenow', String(level));
        frame = requestAnimationFrame(sample);
      };
      sample();
    } catch (error) {
      if (current !== generation) return;
      const denied = ['NotAllowedError', 'SecurityError'].includes(error.name);
      const text = denied ? '麦克风访问被关闭了。请在 Windows 麦克风设置中允许桌面应用访问，再重试。'
        : error.name === 'NotFoundError' ? '没有找到麦克风。请接入耳机或麦克风，再重试。'
        : '暂时无法打开麦克风。请检查默认输入设备，关闭可能占用设备的应用，再重试。';
      stop(text); get('mic-privacy').hidden = !denied;
    }
  });
  window.addEventListener('pagehide', () => stop());
  get('microphone')?.addEventListener('toggle', () => { if (!get('microphone').open) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();

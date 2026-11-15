/** A single local MP3 player; stale play promises cannot restart audio after navigation. */
export function createLearningAudio({ createAudio = () => new Audio(), onChange = () => {} } = {}) {
  let current = null;
  function stop() {
    if (!current) return;
    const old = current; current = null;
    old.audio.onended = old.audio.onerror = null;
    old.audio.pause(); old.audio.removeAttribute('src'); old.audio.load();
    onChange({ id: old.id, status: 'stopped' });
  }
  async function toggle(id, url) {
    const same = current?.id === id;
    stop(); if (same) return;
    const audio = createAudio();
    const playback = { id, audio }; current = playback;
    const fail = () => {
      if (current !== playback) return;
      stop(); onChange({ id, status: 'error' });
    };
    audio.preload = 'none'; audio.playbackRate = 1; audio.src = url;
    audio.onended = () => { if (current === playback) stop(); };
    audio.onerror = fail;
    onChange({ id, status: 'loading' });
    try {
      await audio.play();
      if (current !== playback) { audio.pause(); return; }
      onChange({ id, status: 'playing' });
    } catch { fail(); }
  }
  return { toggle, stop };
}

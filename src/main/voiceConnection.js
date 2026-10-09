import { connectionError } from '../services/connectionCheck.js';

/** One user-requested session, shared by settings and the microphone shortcut. */
export function createVoiceConnection({ engine, start, onFailure, timeoutMs = 20000 }) {
  let pending = null;
  let readyProvider = null;
  const finish = result => {
    if (!pending) return;
    const attempt = pending;
    pending = null;
    clearTimeout(attempt.timer);
    attempt.resolve(result);
  };
  const status = event => {
    if (event.status !== 'connected') readyProvider = null;
    if (event.status === 'error') finish({ ok: false, error: connectionError(event.error) });
    if (event.status === 'disconnected') finish({ ok: false, cancelled: true });
  };
  const ready = () => {
    if (!engine.isConnected) return;
    readyProvider = engine.provider;
    if (pending?.provider === readyProvider) finish({ ok: true });
  };
  // Qwen's session.created does not acknowledge the requested model/voice.
  const sessionReady = () => { if (engine.provider !== 'qwen') ready(); };
  engine.on('status', status);
  engine.on('session_ready', sessionReady);
  engine.on('session_configured', ready);
  const cancel = () => {
    readyProvider = null;
    finish({ ok: false, cancelled: true });
  };
  return {
    get pending() { return Boolean(pending); },
    isPending(attempt) { return Boolean(pending && pending.promise === attempt); },
    isReady(provider) { return engine.isConnected && readyProvider === provider; },
    ensure(provider) {
      if (pending?.provider === provider) return pending.promise;
      if (this.isReady(provider)) return Promise.resolve({ ok: true });
      cancel();
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending = { provider, promise, resolve };
      pending.timer = setTimeout(() => {
        const result = { ok: false, error: connectionError('timeout') };
        finish(result);
        onFailure(result);
      }, timeoutMs);
      try { start(provider); }
      catch (error) {
        const result = { ok: false, error: connectionError(error.message), needsSettings: Boolean(error.needsSettings) };
        finish(result);
        onFailure(result);
      }
      return promise;
    },
    cancel,
    dispose() {
      cancel();
      engine.off('status', status);
      engine.off('session_ready', sessionReady);
      engine.off('session_configured', ready);
    },
  };
}

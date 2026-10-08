/** Register OS hotkeys only while Dota owns the foreground window. Checking
 * inside the callback alone would still swallow other apps' Ctrl/Alt+digits.
 * Polling shares the existing hidden input helper; it never injects keys.
 */
export function createGamePhraseShortcuts({ shortcuts, foregroundProcessName, onSendPhrase,
  onShortcutFailures = () => {}, intervalMs = 125, scopeTimeoutMs = 500, schedule = setTimeout, cancel = clearTimeout }) {
  const registered = new Set();
  let running = false;
  let active = false;
  let generation = 0;
  let timer;
  let lease;
  let scope = 0;
  let pending;
  let queryFailed = false;
  const isDota = name => /^dota2(?:\.exe)?$/i.test(String(name || ''));
  const release = () => {
    cancel(lease);
    scope++;
    for (const key of registered) shortcuts.unregister(key);
    registered.clear();
    active = false;
  };
  function renewLease() {
    cancel(lease);
    if (!registered.size) return;
    // Release independently of a hung query instead of waiting for its RPC
    // timeout. An expired observation cannot reactivate the shortcuts.
    lease = schedule(release, scopeTimeoutMs);
    lease?.unref?.();
  }
  async function send(key, digit, type, session, registeredScope) {
    if (!running || session !== generation || registeredScope !== scope || !registered.has(key)) return;
    try {
      // Recheck before touching the clipboard if focus changed since the poll.
      const name = await foregroundProcessName();
      if (!running || session !== generation || registeredScope !== scope || !registered.has(key)) return;
      if (!isDota(name)) { release(); return; }
      onSendPhrase(digit, type);
    } catch { if (session === generation && registeredScope === scope) release(); }
  }
  async function refresh() {
    if (!running) return;
    if (pending) return pending;
    const session = generation;
    const observedScope = scope;
    pending = (async () => {
      let name;
      try { name = await foregroundProcessName(); }
      catch {
        if (session === generation) { queryFailed = true; release(); }
        return;
      }
      if (!running || session !== generation || observedScope !== scope) return;
      queryFailed = false;
      if (!isDota(name)) { release(); return; }
      if (active) { renewLease(); return; }
      active = true;
      const registeredScope = ++scope;
      const failures = [];
      for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
        for (const [modifier, type] of [['Ctrl', 'cn'], ['Alt', 'en']]) {
          const key = `${modifier}+${digit}`;
          try {
            if (shortcuts.register(key, () => { void send(key, digit, type, session, registeredScope); })) registered.add(key);
            else failures.push({ key, label: `Send ${type.toUpperCase()} Phrase ${digit}` });
          } catch { failures.push({ key, label: `Send ${type.toUpperCase()} Phrase ${digit}` }); }
        }
      }
      renewLease();
      if (failures.length) onShortcutFailures(failures);
    })();
    try { await pending; } finally { pending = null; }
  }
  async function poll(session) {
    await refresh();
    if (!running || session !== generation) return;
    // If Windows blocks or kills the helper, avoid repeatedly spawning it.
    timer = schedule(() => { void poll(session); }, queryFailed ? 2000 : intervalMs);
    timer?.unref?.();
  }
  return {
    refresh,
    start() {
      if (running) return pending;
      running = true;
      return poll(++generation);
    },
    stop() {
      running = false;
      generation++;
      cancel(timer);
      release();
    },
  };
}

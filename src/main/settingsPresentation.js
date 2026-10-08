/** Present the captured window, even when Electron misses ready-to-show. */
export function presentSettingsWhenReady(window, { smokeTest = false, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let presented = false;
  const present = () => {
    if (smokeTest || presented || window.isDestroyed()) return;
    presented = true;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.moveTop();
  };
  window.once('ready-to-show', present);
  const fallback = schedule(present, 1200);
  window.once('closed', () => cancel(fallback));
  return present;
}

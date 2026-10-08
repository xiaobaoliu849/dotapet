/** Fit utility windows inside the usable desktop, including scaled displays. */
export function settingsWindowBounds(workArea, { width = 940, height = 820, minWidth = 620, minHeight = 640 } = {}) {
  const fittedWidth = Math.min(width, workArea.width);
  const fittedHeight = Math.min(height, workArea.height);
  return { width: fittedWidth, height: fittedHeight,
    minWidth: Math.min(minWidth, fittedWidth), minHeight: Math.min(minHeight, fittedHeight),
    x: Math.round(workArea.x + (workArea.width - fittedWidth) / 2),
    y: Math.round(workArea.y + (workArea.height - fittedHeight) / 2) };
}

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

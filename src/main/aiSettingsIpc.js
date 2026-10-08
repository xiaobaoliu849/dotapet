/** Trust only the top-level frame of the exact local settings document. */
export function isTrustedSettingsSender(event, window, expectedURL) {
  return Boolean(window && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame?.url === expectedURL);
}

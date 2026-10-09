# Alt+Q saved-credential reconnect — adversarial review

## Root cause

The microphone shortcut only inspected the renderer's `voiceConnected` flag.
Startup deliberately leaves cloud voice offline, and any socket failure clears
that flag. The shortcut opened AI settings in both cases, even when an encrypted
key was already saved. Saving and connecting in settings happened to restore the
runtime session. The generic failure HUD also incorrectly called network errors
an unconfigured service. No missing or deleted credential is required to trigger
this bug.

## Result

- Alt+Q and the voice button request the saved voice provider in the main process,
  wait for its session acknowledgement, then request microphone access.
- A ready session is reused; simultaneous connection requests share one attempt.
  Runtime errors preserve the retry provider; settings changes use the newly
  saved selection. Startup remains offline.
- Missing or unreadable local configuration opens settings. Network, quota,
  model and authentication failures retain their specific sanitized message.
  A disconnect explicitly tells the user to retry with Alt+Q without resaving.
- Connecting has a 20-second timeout. A second press cancels the microphone
  request and its owned pending connection. It cannot cancel a newer attempt or
  a connection that settings started independently.

## Self adversarial review

Reviewed the shortcut, preload boundary, main-process provider selection, session
readiness, cancellation, failure cleanup and asynchronous microphone acquisition.
No independent agent review was used.

| Adversarial case | Protection / verification |
| --- | --- |
| Saved key but offline at startup | Electron smoke starts with an encrypted saved Gemini profile and opens the fake microphone through the real shortcut/IPC. |
| Dropped socket followed by Alt+Q | Smoke reconnects without rewriting the vault or opening settings. |
| Renderer misses an earlier connected status | Smoke reuses the existing ready session without another dial. |
| Multiple starts / alternate provider | Unit tests verify shared promises and cancellation of superseded waiters. Cancellation checks both request ID and owned attempt. |
| Socket open before session configuration | Unit tests wait for Doubao session readiness and Qwen `session.updated`, rather than socket-open/`session.created`. |
| Connection hangs or is cancelled | Unit tests cover timeout; smoke verifies cancellation stops the pending dial without requesting microphone access. |
| Success reply arrives after a disconnect | Found during review; a disconnect generation check now rejects stale success. Regression test verifies no microphone request. |
| Permission resolves after microphone cancellation | Regression test verifies all returned tracks stop. |
| Invalid API key / raw secret in provider error | Smoke injects an authentication failure containing a fake secret; the UI retains the authentication explanation and never displays the secret. Avoided sanitizing an already-sanitized result twice. |
| No key / credential cannot decrypt | Missing-key smoke opens settings without dialing. Unit tests cover the unreadable-key result. |
| Other renderer or subframe requests a dial | New IPC endpoints accept only the pet's exact local top-level document, using the existing tested sender validator; the renderer supplies no provider key or URL. |
| Transcript/character layout regression | Existing conversation smoke runs against a ready fixture and checks geometry, scrolling, manual collapse and stopped-mic history. |

## Validation

- `npm test`: **181 passed**, including `tests/test_voice_connection.js`
  (10 new regressions).
- `npm run smoke`: **passed**; isolated Electron, Windows encrypted storage,
  fake Chromium microphone, actual renderer/IPC, simulated cloud handshake.
- `git diff --check` and JavaScript syntax checks: **passed**.

Cloud availability and the user's real account credentials are not exercised by
these offline checks. This fix removes the settings/resave dependency; an actual
provider authentication, quota or network failure still needs its stated cause
resolved before a retry can succeed.

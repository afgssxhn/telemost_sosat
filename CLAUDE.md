# CLAUDE.md

Chrome extension (Manifest V3) for real-time Russian speech transcription from browser tab audio using Deepgram Nova-3.

## Architecture

- `background.js` — Service worker. State persisted in `chrome.storage.session` via `getState()`/`setState()` helpers. Coordinates offscreen doc and side panel.
- `offscreen.js` — Captures tab audio (AudioWorklet + WebSocket to Deepgram). Sends `offscreen-ready` on load. All outgoing messages include `target: 'background'`.
- `sidepanel.js` — UI. Filters messages by `target: 'sidepanel'`.
- `audio-processor.js` — AudioWorklet for Float32 -> PCM Int16 conversion.

## Key Patterns

- **State persistence:** Runtime state (`isCapturing`, `pendingStreamId`, `pendingTabId`, `pendingTabTitle`) lives in `chrome.storage.session`, survives service worker restarts.
- **Offscreen ready-pattern:** Background waits for `offscreen-ready` message (5s timeout) before sending `offscreen-start`. Concurrency latch prevents duplicate creation.
- **No offscreenCreated flag:** Always check `chrome.runtime.getContexts()` for real presence.
- **Message targeting:** All inter-context messages carry a `target` field (`'sidepanel'`, `'offscreen'`, `'background'`). Each listener filters by target.
- **Tab navigation handling:** `chrome.tabs.onUpdated` invalidates stale `streamId` and stops capture on navigation.

## Bug Fixes Applied (2026-04-13)

1. State migrated to `chrome.storage.session` (was in-memory `let` vars)
2. Offscreen ready-pattern eliminates race condition on creation
3. `offscreenCreated` flag removed, always use `getContexts()`
4. `audioPlayback.play()` promise handled with try/catch
5. `tabs.onUpdated` listener invalidates streamId on navigation
6. Clear button resets placeholder via `while/removeChild` + `PLACEHOLDER_TEXT` constant
7. Message targeting prevents cross-context delivery + fixes hidden transcript duplication
8. Interim element cleaned up on recording stop
9. Transcript copy trims whitespace to prevent double spaces

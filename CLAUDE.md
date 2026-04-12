# CLAUDE.md

Chrome extension (Manifest V3) for real-time Russian speech transcription from browser tab audio using Deepgram Nova-3.

## Architecture

- `background.js` — Service worker. State persisted in `chrome.storage.session` via `getState()`/`setState()` helpers. Coordinates offscreen doc, side panel, and native messaging host.
- `offscreen.js` — Captures tab audio (AudioWorklet + WebSocket to Deepgram). Sends `offscreen-ready` on load. All outgoing messages include `target: 'background'`.
- `sidepanel.js` — UI with two tabs: Transcript and Assistant. Filters messages by `target: 'sidepanel'`.
- `audio-processor.js` — AudioWorklet: ring buffer on Float32Array with read/write pointers for Float32 -> PCM Int16 conversion.
- `utils.js` — Shared utilities (`DEBUG` flag, `getApiKey()`). Loaded via `importScripts` in background.js, `<script>` in HTML pages.
- `common.css` — Shared CSS reset, body theme, `.btn` base styles. Linked before page-specific CSS.
- `native-host/host.py` — Python Native Messaging host. Receives questions via Chrome NM protocol, runs `claude -p` with optional context from `context.md`, returns answers.
- `native-host/context.md` — User-editable meeting context file. AI assistant uses this as context for answers.
- `native-host/com.telemost.transcriber.json` — NM manifest template (placeholders for path and extension ID).
- `native-host/install.sh` — Install script for Linux/macOS. Generates manifest, copies to Chrome NM directory.
- `native-host/install.bat` — Install script for Windows. Generates manifest + host.bat wrapper, registers in registry.

## Key Patterns

- **State persistence:** Runtime state (`isCapturing`, `pendingStreamId`, `pendingTabId`, `pendingTabTitle`) lives in `chrome.storage.session`, survives service worker restarts.
- **Offscreen ready-pattern:** Background waits for `offscreen-ready` message (5s timeout) before sending `offscreen-start`. Concurrency latch prevents duplicate creation.
- **No offscreenCreated flag:** Always check `chrome.runtime.getContexts()` for real presence.
- **Message targeting:** All inter-context messages carry a `target` field (`'sidepanel'`, `'offscreen'`, `'background'`). Each listener filters by target.
- **Tab navigation handling:** `chrome.tabs.onUpdated` invalidates stale `streamId` and stops capture on navigation.
- **Message dispatch map:** `background.js` uses `MESSAGE_HANDLERS` object for type→handler lookup instead of if-chain. Always returns `true` for async sendResponse.
- **Named constants:** Magic numbers extracted to `UPPER_SNAKE_CASE` constants at top of each file.
- **Native Messaging (one-shot):** `chrome.runtime.sendNativeMessage()` for ask-ai and ping-native. Each call starts/stops the host process. No long-lived port.
- **Side panel tabs:** Two tabs (Transcript | Assistant) via `display: none/flex` toggle on `.tab-content` wrappers. Start/Stop is a shared control above tabs.
- **AI Assistant flow:** sidepanel → `ask-ai` → background → `sendNativeMessage` → host.py → `claude -p` → response → `ai-response` broadcast → sidepanel chat bubble.
- **Auto-mode:** When enabled, each final transcript in assistant tab auto-sends to Claude. Skips if already processing (flood protection).

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

## Refactoring Applied (2026-04-13)

1. `audio-processor.js`: Ring buffer (Float32Array + read/write pointers) replaces Array+push+splice — eliminates GC pressure in real-time audio thread
2. Magic numbers extracted to named constants across all JS files
3. `background.js`: Message handler if-chain replaced with `MESSAGE_HANDLERS` dispatch map
4. `utils.js` created: shared `DEBUG` flag and `getApiKey()` extracted from background.js, sidepanel.js, offscreen.js, options.js
5. `common.css` created: shared reset, body theme, `.btn` base styles extracted from sidepanel.css and options.css

## AI Assistant Feature (2026-04-13)

- Native Messaging host (`native-host/host.py`): Python 3.8+, stdlib only, Chrome NM binary protocol, `REQUEST_HANDLERS` dispatch map
- New permission: `nativeMessaging`
- New message types: `ask-ai`, `ping-native` (background handlers), `ai-response`, `ai-error`, `native-pong`, `native-error` (sidepanel)
- Side panel restructured: two tabs (Transcript / Assistant), shared Start/Stop control
- Assistant UI: chat bubbles (user/transcript/ai/error), thinking indicator, auto-mode toggle, manual input, native host status indicator
- Install scripts: `install.sh` (Linux/macOS), `install.bat` (Windows) — register NM host with Chrome
- Logging prefix: `[TT:AI]` for AI operations, `[TT:HOST]` for native host

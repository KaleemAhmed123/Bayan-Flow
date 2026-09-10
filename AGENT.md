# BayanFlow Agent Notes

This file is the project briefing for future coding, audit, design, security, and product reviews. Keep it current when behavior changes. Prefer this document over memory from previous sessions.

## Product Goal
- Build a Windows-first personal dictation MVP similar to Wispr Flow.
- The app should let a user quickly capture speech, transcribe it with Groq Whisper, optionally clean it with a Groq chat model, and insert or copy the final text into the active desktop app.
- Optimize for internal Windows beta quality: safer IPC, stricter renderer security, usable diagnostics, production packaging, and reliable local behavior before broader abstractions.

## Current Behavior
- Electron tray app starts on launch. The tray menu shows status, both hotkeys, the paste toggle, settings, diagnostics export, logs, and quit.
- A single overlay window, the dock, is the only in-app surface besides Settings. It sits bottom centre of the display the cursor is on and is always centre-anchored, so it grows and shrinks symmetrically instead of sliding.
- When idle the dock shows a small permanent pill. Hovering it reveals Dictate, Rewrite, Settings, and Hide for 1 hour; clicking it starts dictation. It is controlled by the `showDock` setting and a one-hour snooze.
- Dictation gesture: hold the dictation hotkey and speak, release to finish. A quick tap (under 400ms) latches recording on; tap again to finish. Esc cancels.
- Finishing transcribes, optionally polishes, then pastes straight into the app the user was in. There is no confirmation step.
- After insertion the dock shows Pasted with Redo and Polish buttons, then hides itself after 8s of inactivity.
- Redo sends Ctrl+Z to the target, re-polishes the original transcript with a variation prompt, and pastes the new version.
- The rewrite hotkey opens the rewrite menu in the dock: all eight actions in one four-column grid, plus a custom instruction field. There is no More button and no layering.
- A rewrite reads the focused input through the clipboard, rewrites it, and replaces it in place; the whole-input path re-verifies the text before overwriting.
- Every failure renders in the dock with its own recovery button and clears after 8s. No status is ever shown on a surface the user is not looking at.
- On startup with no Groq API key, Settings opens automatically and the dock shows a setup error with an Open Settings button.
- A second launch while the app is already running opens the app window and shows an "already running" notice.
- The app window has four pages behind a left sidebar: Home, History, Stats, and Settings. It is still one window and still the only surface besides the dock.
- Every successful dictation is appended to a local history file when `historyEnabled` is on. History and Stats both read that one file.

## Intended V1 Flow
- User holds the dictation hotkey, or taps it to latch.
- App records microphone audio and shows the listening dock.
- User releases (hold mode) or taps again (latched mode). Esc cancels and deletes the temp audio.
- App transcribes audio with Groq Whisper.
- If cleanup is enabled, app sends the transcript to a cleanup model.
- App pastes the final text into the captured target window, or copies it when autoPaste is off.
- If paste is blocked, the text stays on the clipboard and the dock says so with a Copy again button.
- Temp audio is deleted after success, cancellation, empty audio, or handled failure.
- If transcription confidence is weak or empty, STT retries once with a stronger prompt before continuing.

## Scope
- In scope: Windows tray app, global hotkey, microphone capture, Groq transcription, cleanup provider abstraction, clipboard paste insertion, settings UI, status overlay, local logs, diagnostics export, NSIS packaging.
- Deferred: macOS support, Linux support, streaming transcription, local/offline models, plugin system, analytics, sync, enterprise policy controls, custom vocabulary UI, command mode, code signing, auto-update.

## Stack
- Electron + Node.js + TypeScript.
- TypeScript compiles from `src` to `dist`.
- Renderer HTML/CSS/JS/preload files are copied from `src/renderer` to `dist/renderer` by `scripts/copy-renderer.mjs`.
- Tray assets are copied from `src/assets` to `dist/assets`.
- Hidden recorder renderer captures microphone audio through `navigator.mediaDevices.getUserMedia` and `MediaRecorder`.
- `uiohook-napi` listens to global keydown/keyup events.
- `groq-sdk` handles audio transcription and chat cleanup requests.
- `@nut-tree-fork/nut-js` sends `Ctrl+V` after Electron clipboard writes.
- Node's built-in test runner is used for tests.
- `electron-builder` builds `win-unpacked` artifacts and NSIS installers.

## Commands
- `npm install`: install dependencies.
- `npm run build`: type-check TypeScript and copy renderer/assets.
- `npm run dev`: build, then start Electron through `scripts/start-electron.mjs`.
- `npm start`: start Electron from existing `dist`.
- `npm test`: run Node unit tests from `tests/*.test.mjs`.
- `npm run local:smoke`: build and verify a local Electron startup log using isolated user data.
- `npm run pack`: build the unpacked Windows app into `release/win-unpacked`.
- `npm run dist`: build the NSIS installer into `release/`.
- `npm run packaged:smoke`: launch `release/win-unpacked/BayanFlow.exe` and verify startup logging.

Important test note:
- `npm test` may fail in a sandbox with `spawn EPERM` because Node's test runner spawns worker processes. Run it unsandboxed when needed.
- Tests import from `dist`, so run `npm run build` before `npm test` after source changes.

## Runtime Configuration
- Config is stored as JSON under Electron `app.getPath("userData")`.
- `ConfigStore` falls back to defaults if the config file is missing or invalid.
- Config load/save normalizes renderer-provided values before use.
- `GROQ_API_KEY` is used as a fallback when the saved config does not contain `groqApiKey`.
- Default hotkey: `Ctrl+Shift+Space`.
- Default transcription model: `whisper-large-v3`.
- Default cleanup model: `openai/gpt-oss-120b`. Groq retired `llama-3.3-70b-versatile` on 2026-08-16.
- `config-store.ts` keeps a `RETIRED_MODELS` map. `modelOr()` applies it on every load and save, so existing installs migrate off decommissioned model ids automatically. Add to it whenever Groq deprecates a model.
- Default `cleanupEnabled`: `true`.
- Default `autoPaste`: `true`. Paste-into-app is the primary flow; copy-only remains available in Settings.
- Default `historyEnabled`: `true`. Turning it off stops all dictation recording; existing entries stay until cleared.
- Default `openAtLogin`: `false`.
- Default `showDock`: `true`. The idle pill is permanent unless the user turns it off or snoozes it for an hour.
- There is no `inputAssistEnabledOnStartup` setting. It was removed with the floating icon; old config files simply ignore the leftover key.
- Saved Groq API keys are encrypted with Electron `safeStorage` when available; plaintext fallback is only used for legacy config reads or when encryption is unavailable.

## Architecture Decisions
- Keep the dictation path linear and observable: hotkey -> record -> transcribe -> clean -> insert/copy -> status.
- Use clipboard paste for insertion because it is the most reliable Windows MVP path.
- Keep the cleanup provider layer narrow. It abstracts cleanup only, not every AI capability.
- Store user config in a small JSON file for now.
- Use `src/electron.ts` as the central Electron import adapter because direct ESM imports from `electron` failed at runtime in Electron 42 in this environment.
- Use `scripts/start-electron.mjs` to clear `ELECTRON_RUN_AS_NODE` before launching Electron.
- Use JSON-line local logging with redaction instead of console logs.
- Keep one overlay surface with one anchor and one width. The renderer measures its own height; the main process only positions.
- Keep Groq as the primary STT and cleanup provider for now.
- Favor accuracy-first STT defaults for English dictation: `whisper-large-v3`, `language: "en"`, deterministic Whisper-style prompt, `verbose_json`, and one bounded retry on weak transcripts.
- Keep cleanup deterministic and tightly constrained rather than creative.

## Module Responsibilities
- `src/main.ts`: Electron lifecycle, service composition, tray, dictation and rewrite flows, dock messaging, temp audio deletion, diagnostics.
- `src/electron.ts`: Central Electron adapter using `createRequire`.
- `src/config-store.ts`: Read/write config JSON, encrypt API key storage, and apply defaults/env fallback.
- `src/settings-window.ts`: The app window. Owns the window lifecycle, the settings IPC, and the read-only history IPC. Named for history; it stopped being settings-only when the sidebar landed.
- `src/history/history-store.ts`: The dictation history file, its 500-entry cap, and the pure `summarize()` that every Stats number is derived from. The one deliberate exception to the no-stored-speech rule; read the header before changing it.
- `src/overlay/overlay-state.ts`: Pure dock geometry, view types, and error-to-recovery mapping. No Electron imports, so it is unit-testable.
- `src/overlay/overlay-dock.ts`: The single overlay window. Owns placement, visibility, focus rules, and dock IPC.
- `src/hotkey/hotkey-parser.ts`: Pure parsing, normalization, and tap/hold classification (`classifyPress`).
- `src/hotkey/hotkey-listener.ts`: `uiohook-napi` listener; reports held duration on release.
- `src/audio/audio-recorder.ts`: Hidden recorder window lifecycle, recorder IPC, temp `.webm` persistence.
- `src/renderer/tokens.css`: The only place colour, type, radius, and motion values are defined. Palette is "Ink & Iris": near-black base, single violet accent.
- `src/renderer/dock.html`, `dock.css`, `dock.js`: Dock markup, styles, and view logic. Measures its own height and reports it over IPC.
- `src/renderer/settings.html`, `settings.css`, `settings.js`: The app window markup, styles, and page logic. One `.page` visible at a time behind the sidebar.
- `src/renderer/recorder.html`: Browser microphone capture and `MediaRecorder` logic.
- `src/transcription/groq-transcription-service.ts`: Groq Whisper request shaping, weak-transcript retry, telemetry without transcript content.
- `src/transcription/transcription-prompt.ts`: Whisper-style spelling and formatting prompt builder.
- `src/cleanup/cleanup-provider.ts`: Cleanup provider contract and prompt builder.
- `src/cleanup/groq-cleanup-provider.ts`: Groq chat cleanup implementation.
- `src/rewrite/rewrite-actions.ts`: Rewrite prompts, menu layering, and the Redo variation instruction.
- `src/llm/completion-budget.ts`: Output-token budgeting shared by cleanup and rewrite. Reasoning models bill their thinking against `max_completion_tokens`, so budgets must include headroom for it; also owns truncation detection and the `reasoning_effort` fallback.
- `src/insertion/text-inserter.ts`: Clipboard read/write, paste, undo, and window target verification.
- `src/observability/logger.ts`: JSON logger, file sink, rotation, retention, redaction.
- `src/observability/errors.ts`: Normalized user-facing and log-safe errors, retry classification.
- `scripts/after-pack.cjs`: Post-pack EXE metadata/icon stamping via local `rcedit.exe`.
- `tests/*.test.mjs`: Node unit tests against built `dist` modules.

## Provider Contracts
- Cleanup providers expose `clean(input, options, context?)`.
- Cleanup providers must return only final cleaned text.
- V1 implements `CleanupMode = "default"` only.
- Cleanup should preserve meaning, minimally repair obvious ASR artifacts, preserve commands/code terms/URLs/filenames/variables/product names, avoid answering questions, and avoid inventing information.
- Transcription services should return structured results with trimmed text plus confidence metadata, and avoid logging raw transcript content or prompt text.

## Observability And Privacy
- Logs live under the configured Electron user data log directory.
- Dictation history is the ONE place spoken text is persisted, and it exists because the user asked for the History and Stats pages. It lives in `history.jsonl` under the user data directory, never in logs, never in diagnostics export, and never off the machine. `historyEnabled: false` stops it; Clear all deletes it; the newest 500 entries are kept. Do not "fix" it as a privacy leak. See `docs/tasks/history-and-stats.md`.
- Logger redacts likely secrets and fields such as `apiKey`, `authorization`, `secret`, `password`, `token`, `transcript`, `rawText`, `finalText`, and `cleanedText`.
- Current logs include metadata such as request IDs, model names, durations, byte counts, output character counts, token usage, and transcription confidence summaries.
- Do not add logs containing spoken content, cleaned text, full clipboard content, or API keys.
- Temp audio is written to the OS temp directory under `whispr-clone` and is deleted after the main flow finishes.
- Diagnostics export writes sanitized logs plus a diagnostics JSON summary without transcript content or secrets.

## Security Review Checklist
- Validate all renderer-provided IPC payloads before using or saving them.
- Never accept a BayanFlow window as a paste or rewrite target. The dock is always-on-top and can be foreground right after a click; run every capture through `captureTarget()`, which applies `isUsableTarget()` and falls back to the last genuine app window.
- Avoid granting broad session permissions. Microphone permission is currently scoped to the recorder window's web contents.
- Keep `contextIsolation: true` and `nodeIntegration: false` for renderer windows.
- Keep `sandbox: true` for renderer windows.
- Keep CSP free of `unsafe-inline`; renderer JS/CSS should stay in separate local files.
- Block or constrain unexpected navigation and `window.open` in Electron windows.
- Treat saved API keys as sensitive. Prefer Electron `safeStorage`; do not expose API keys to the renderer.
- Do not log transcript text, cleaned text, clipboard content, raw audio paths beyond operational metadata, or secrets.
- Review dependencies with `npm audit --omit=dev`; note that `@nut-tree-fork/nut-js` pulls image tooling transitively even though this app only uses keyboard automation.

## Reliability Review Checklist
- Ensure every async recording stop path has a timeout and resolves or rejects.
- Ensure `isRecording`, `isProcessing`, and `activeSessionId` are reset on every success, cancellation, and failure path.
- Check that temp audio is deleted on success, cancellation, empty audio, and handled errors.
- Avoid creating duplicate IPC handlers when windows are reopened.
- Ensure hotkey listener restart does not leave stale listeners running.
- Add max recording duration and max audio size before transcription.
- Keep retry behavior restricted to transient Groq/network failures.
- Never return a completion whose `finish_reason` is `length`. A truncated answer presented as success is worse than a clear failure.
- Never silently fall back to the input text on an empty completion in the rewrite path; that reports success while nothing changed.
- Size `max_completion_tokens` with `estimateOutputTokens()`. Changing the cleanup model to another reasoning model does not need a code change, but changing to one whose id does not match `usesReasoningTokens()` does.
- Keep STT confidence retry bounded to one extra attempt.
- Ensure clipboard paste failure leaves final text copied and gives a useful user message.
- Never write into a user input without first re-reading it and confirming it still holds the text being replaced. Refocusing a window restores the window, not the caret or the selection, so a plain paste inserts rather than replaces and silently appends the rewrite to the original.
- Never treat a successful Ctrl+C as proof that a selection exists. VS Code copies the caret's line when nothing is selected, so a paste can still insert. Write through `replaceWholeTextByClipboard()`, where Ctrl+A guarantees a replace, and splice a scoped rewrite back into the surrounding text instead of pasting over a selection.
- Redo must not rely on Ctrl+Z. An unverified undo that quietly fails causes every retry to stack another copy in the document.

## Product And UX Review Checklist
- There is exactly one overlay window. Never add a second surface that can show status at the same time.
- The dock has one anchor (bottom centre). Size always comes from the renderer's own measurement, never from a value the main process computed.
- The main process must never set a dock size it computed itself. That is the defect class this design exists to remove.
- `.dock` must stay in normal flow. Never give it `position: absolute` and never give `body` `position: relative`: body carries `overflow: hidden`, so an out-of-flow dock leaves body zero-height and the whole card is clipped away, rendering a completely blank window that still reports `visible: true` with correct bounds.
- Verify overlay rendering with `npm run local:smoke`. It sets `BAYANFLOW_DOCK_CAPTURE=1`, which makes the dock call `capturePage()` after each view and log `dock.capture` with an opaque-pixel count, and it fails on any blank frame. Bounding-box measurements cannot catch clipping, so this is the only check that proves the dock is actually visible.
- Placement must never depend on an async value, or on bounds supplied by Windows UI Automation.
- Every error must render in the dock, carry a recovery button, and clear after 8s.
- Distinct states: idle, listening, working, done, menu, error. Recording and idle never auto-clear; done and error fall back to idle after 8s.
- The menu is the only view that takes focus. Everything else uses `showInactive` so typing focus stays in the user's app.
- Every dock control is at least 32px tall and carries a text label, not an icon alone. The rewrite grid shrinks padding and font to fit four columns, never the height. Secondary in-row buttons inside the app window (Copy, Delete) may be 26px, because that window is mouse-driven and not a floating target.
- Settings and the dock must both import `tokens.css`. Do not introduce a second palette.
- Settings should validate hotkey/model/API key input and show save errors.
- Startup should be discoverable: tray state, first-run setup, and second-launch behavior should not appear silent.

## Test Review Checklist
- Build before testing because tests import `dist`.
- Add focused unit tests for pure logic first: hotkey parsing, config validation, prompt building, error normalization, logger redaction.
- Add service tests with fakes for Groq transcription/cleanup, recorder stop timeout, and text insertion fallback.
- Keep tests for transcription request shaping and weak-transcript retry behavior.
- Add integration smoke tests only where they can be reliable in CI/local Windows environments.
- Avoid tests that require real microphone, real Groq calls, or actual global keyboard hooks unless explicitly marked/manual.

## Current Known Gaps
- Windows code signing and SmartScreen trust are still missing.
- No auto-update story yet.
- Installed-mode manual QA is still more important than local smoke alone.
- `@nut-tree-fork/nut-js` still carries transitive dependency/audit surface that is larger than the direct app behavior.
- The first-launch settings UI and installer branding still need manual visual QA in packaged mode after UI changes.

## Implementation History
- Initialized project metadata, TypeScript config, and renderer copy script.
- Added services for config, hotkey parsing/listening, audio recording, Groq transcription, Groq cleanup, insertion, tray lifecycle, settings, status overlay, and observability.
- Added minimal renderer assets for hidden microphone recording, settings, and status display.
- Bumped Electron to a newer major after audit findings in the initial range.
- Added guard for empty/very small recordings so quick taps do not call transcription.
- Fixed recorder renderer path so compiled `dist/audio` code loads files from `dist/renderer`.
- Replaced `node-global-key-listener` with `uiohook-napi`; the former package was missing `bin/WinKeyServer.exe` in this install.
- Split pure hotkey parsing away from Electron/runtime registration so Node tests do not import Electron modules.
- Added visible tray icon assets under `src/assets`; Windows tray and window icons use `tray-icon.ico`.
- Restored the compact confirmation overlay with X/check controls; hotkey release is intentionally ignored.
- Honored `autoPaste`: enabled pastes and copies; disabled pastes means copy only.
- Added recorder stop timeout handling so renderer IPC failure does not leave the app stuck processing.
- Added config normalization for load/save and settings IPC.
- Scoped microphone permission to the recorder web contents.
- Added strict recorder IPC validation, max audio guard, renderer asset externalization, startup-at-login restoration, auto-paste warning flow, diagnostics export, production packaging scripts, packaged smoke test, and NSIS installer generation.
- Added startup visibility UX: first-run Settings opening, tray running notice, second-instance notice, and tray left-click Settings behavior.
- Added NSIS header/sidebar artwork and post-pack EXE metadata/icon stamping.
- Added English-first accuracy hardening: `whisper-large-v3`, `language: "en"`, `verbose_json`, Whisper-style prompt, deterministic cleanup, and one weak-transcript retry.
- Replaced `StatusOverlay` and `InputAssistWindow` with a single bottom-centre `OverlayDock`.
- Moved dock sizing to a renderer `ResizeObserver` that reports height over IPC, removing the TypeScript-vs-CSS size mismatch.
- Removed the floating magic icon and its 500ms UI Automation poll; the rewrite hotkey now opens the dock menu directly.
- Added hold-to-talk with tap-to-latch on one key, plus a global Esc cancel listener.
- Removed the rewrite preview/confirm step. Dictation and rewrites paste straight through, with Redo (Ctrl+Z, re-polish, paste) as the undo path.
- Added `src/renderer/tokens.css` and rebuilt Settings on it, so the dock and Settings share one palette.
- Flipped the `autoPaste` default to `true` and dropped the separate warning acknowledgement checkbox.
- Fixed `npm test` for Node 24 by passing an explicit glob to `node --test`.
- Fixed first-run-test failures found in `app.log`: migrated off the decommissioned Groq cleanup model, made the dock non-focusable outside the menu view so clicking it no longer breaks the paste target check, and stopped `runRewrite` reporting a replacement failure (and copying stale text) when the API call was what failed.
- Added the permanent idle pill with hover-to-expand actions, a `showDock` setting, and a one-hour snooze.
- Replaced the palette with "Ink & Iris" and moved the Settings window onto the same near-black base.
- Extended the sizing contract so the renderer reports width as well as height, and rewrote the regression test to assert that overlay-dock.ts has exactly one setBounds call fed only by the measured size.
- Fixed a completely blank dock caused by `position: absolute` on `.dock` plus `position: relative` on `body` combining with `overflow: hidden` to clip the card to a zero-height box.
- Promoted `dock.view` logging to info with real window bounds and visibility, and added an env-gated `dock.capture` pixel diagnostic.
- Added a blank-frame guard to `npm run local:smoke`, verified to fail when the defect is reintroduced.
- Animated dock resizes over 150ms in `applyBounds()`, since Electron's own animate flag is macOS-only, with `body` centring the card and `.dock` set to `flex: 0 0 auto` so the card cannot shrink into a feedback loop with the animation.
- Recoloured `--bf-busy` from amber to sky, which reads as attention without going brown next to the violet accent.
- Deleted the dead `src/input-assist/` tree, the PowerShell helper, `magic-wand.png`, the `inputAssistEnabledOnStartup` setting, two duplicated timing constants, and `RecorderLike`. No unused exports remain.
- Fixed polish and rewrite truncating their output: the reasoning model's thinking tokens were consuming a budget sized for a non-reasoning model, and an empty completion was silently returned as the original text.
- Fixed "no text found in that input" caused by the rewrite capturing the dock itself as the target window.
- Fixed rewrites appending instead of replacing: the selection path pasted without checking the selection survived, and Redo trusted an unverified Ctrl+Z. Both now re-read the destination and refuse to write on a mismatch.
- Fixed rewrites still appending when nothing was selected: Ctrl+C returns the caret's line in VS Code, so selection-based replacement was never safe. All rewrites now go through the whole-input path.
- Redo now repeats the action that produced the text (Shorten stays a Shorten) with an attempt-numbered variation note, instead of running a generic rewrite.
- Removed the rewrite menu layering. All eight actions render in one four-column grid of compact buttons; the More button is gone.
- Added dictation history: `history.jsonl` under user data, capped at 500 entries, with the `historyEnabled` setting and read-only history IPC.
- Rebuilt the Settings window into the app window: a left sidebar with Home, History, Stats, and Settings, one page visible at a time.

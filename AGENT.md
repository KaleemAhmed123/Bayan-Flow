# BayanFlow Agent Notes

This file is the project briefing for future coding, audit, design, security, and product reviews. Keep it current when behavior changes. Prefer this document over memory from previous sessions.

## Product Goal
- Build a Windows-first personal dictation MVP similar to Wispr Flow.
- The app should let a user quickly capture speech, transcribe it with Groq Whisper, optionally clean it with a Groq chat model, and insert or copy the final text into the active desktop app.
- Optimize for internal Windows beta quality: safer IPC, stricter renderer security, usable diagnostics, production packaging, and reliable local behavior before broader abstractions.

## Current Behavior
- Electron tray app starts on launch and shows a tray menu with hotkey, auto-paste toggle, settings, diagnostics export, logs, and quit.
- Pressing the configured global hotkey starts recording if the app is idle and a Groq API key is configured.
- Releasing the hotkey does not stop recording.
- A compact confirmation overlay appears while listening.
- Clicking the check button stops recording, processes audio, then inserts or copies the final text.
- Clicking the X button cancels recording and deletes any captured temp audio.
- If `autoPaste` is enabled, the app pastes final text and leaves it on the clipboard.
- If `autoPaste` is disabled, the app only copies final text.
- Copy-only is the default. Auto-paste is opt-in and requires an explicit warning acknowledgment in Settings.
- On startup with no Groq API key, Settings opens automatically and the app shows a setup notice.
- On startup with a configured API key, the tray app shows a running notice.
- A second launch while the app is already running opens Settings and shows an "already running" notice.

## Intended V1 Flow
- User presses or holds the configured hotkey.
- App records microphone audio.
- User clicks check to finish recording or X to cancel.
- App transcribes audio with Groq Whisper.
- If cleanup is enabled, app sends the transcript to a cleanup model.
- If `autoPaste` is enabled, app pastes final text into the active app and leaves it on the clipboard.
- If `autoPaste` is disabled, app copies final text only.
- Temp audio is deleted after success, cancellation, empty audio, or handled failure.
- If transcription confidence is weak or empty, STT retries once with a stronger prompt before continuing.

## Scope
- In scope: Windows tray app, global hotkey, microphone capture, Groq transcription, cleanup provider abstraction, clipboard paste insertion, settings UI, status overlay, local logs, diagnostics export, NSIS packaging.
- Deferred: macOS support, Linux support, streaming transcription, local/offline models, plugin system, analytics, sync, enterprise policy controls, custom vocabulary UI, command mode, code signing, auto-update.

## Stack
- Electron + Node.js + TypeScript.
- TypeScript compiles from `src` to `dist`.
- Renderer HTML/preload files are copied from `src/renderer` to `dist/renderer` by `scripts/copy-renderer.mjs`.
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
- Default cleanup model: `llama-3.3-70b-versatile`.
- Default `cleanupEnabled`: `true`.
- Default `autoPaste`: `false`.
- Default `openAtLogin`: `false`.
- Saved Groq API keys are encrypted with Electron `safeStorage` when available; plaintext fallback is only used for legacy config reads or when encryption is unavailable.

## Architecture Decisions
- Keep the dictation path linear and observable: hotkey -> record -> transcribe -> clean -> insert/copy -> status.
- Use clipboard paste for insertion because it is the most reliable Windows MVP path.
- Keep the cleanup provider layer narrow. It abstracts cleanup only, not every AI capability.
- Store user config in a small JSON file for now.
- Use `src/electron.ts` as the central Electron import adapter because direct ESM imports from `electron` failed at runtime in Electron 42 in this environment.
- Use `scripts/start-electron.mjs` to clear `ELECTRON_RUN_AS_NODE` before launching Electron.
- Use JSON-line local logging with redaction instead of console logs.
- Keep the overlay interaction simple: X cancels recording, check accepts and processes it.
- Keep Groq as the primary STT and cleanup provider for now.
- Favor accuracy-first STT defaults for English dictation: `whisper-large-v3`, `language: "en"`, deterministic Whisper-style prompt, `verbose_json`, and one bounded retry on weak transcripts.
- Keep cleanup deterministic and tightly constrained rather than creative.

## Module Responsibilities
- `src/main.ts`: Electron lifecycle, service composition, tray, global flow, status updates, temp audio deletion, log folder opening.
- `src/electron.ts`: Central Electron adapter using `createRequire`.
- `src/config-store.ts`: Read/write config JSON, encrypt API key storage, and apply defaults/env fallback.
- `src/hotkey/hotkey-parser.ts`: Pure parsing and normalization for hotkey strings.
- `src/hotkey/hotkey-listener.ts`: `uiohook-napi` listener and modifier/key matching.
- `src/audio/audio-recorder.ts`: Hidden recorder window lifecycle, recorder IPC, temp `.webm` persistence.
- `src/renderer/recorder.html`: Browser microphone capture and `MediaRecorder` logic.
- `src/transcription/groq-transcription-service.ts`: Groq Whisper request shaping, weak-transcript retry, and telemetry without transcript content.
- `src/transcription/transcription-prompt.ts`: Whisper-style spelling and formatting prompt builder.
- `src/cleanup/cleanup-provider.ts`: Cleanup provider contract and prompt builder.
- `src/cleanup/groq-cleanup-provider.ts`: Groq chat cleanup implementation.
- `src/insertion/text-inserter.ts`: Clipboard write and `Ctrl+V` paste automation.
- `src/status-overlay.ts`: Always-on-top status and confirmation overlay window.
- `src/settings-window.ts`: Settings window and settings IPC handlers.
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
- Logger redacts likely secrets and fields such as `apiKey`, `authorization`, `secret`, `password`, `token`, `transcript`, `rawText`, `finalText`, and `cleanedText`.
- Current logs include metadata such as request IDs, model names, durations, byte counts, output character counts, token usage, and transcription confidence summaries.
- Do not add logs containing spoken content, cleaned text, full clipboard content, or API keys.
- Temp audio is written to the OS temp directory under `whispr-clone` and is deleted after the main flow finishes.
- Diagnostics export writes sanitized logs plus a diagnostics JSON summary without transcript content or secrets.

## Security Review Checklist
- Validate all renderer-provided IPC payloads before using or saving them.
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
- Keep STT confidence retry bounded to one extra attempt.
- Ensure clipboard paste failure leaves final text copied and gives a useful user message.

## Product And UX Review Checklist
- Current primary UX is hotkey-to-start with overlay check/X to finish or cancel.
- Show distinct statuses for listening, processing, copied, pasted, canceled, and error.
- Keep overlay compact and non-disruptive, but make controls understandable.
- Settings should validate hotkey/model/API key input and show save errors.
- Settings should clearly present copy-only as the default and gate auto-paste behind a warning.
- Startup should be discoverable: tray state, first-run setup, and second-launch behavior should not appear silent.
- Tray menu should reflect current settings accurately after changes.

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

# BayanFlow UX and Edge-Case Audit

Date: 2026-06-03

## Scope

This audit focuses on issues real Windows users may hit when installing, starting, configuring, recording, seeing the overlay, recovering from failures, and getting support. The codebase is a Windows-first Electron tray dictation app that records microphone audio, sends it to Groq for transcription, optionally cleans the transcript, then copies or pastes the result.

## Current Strengths

- First-run setup is not silent: missing Groq API key opens Settings and shows a setup notice.
- Copy-only is the safer default, and auto-paste is gated behind a warning.
- Recorder IPC is session-scoped and tested against stale or invalid payloads.
- Auto-paste verifies the original target when possible and falls back to copying text if paste fails.
- Local diagnostics export exists and sanitizes logs.
- Build and unit tests pass after dependencies are installed.

## Highest-Priority UX Risks

### 1. Recording Overlay Can Be Invisible Or Hidden

Evidence:
- `StatusOverlay` creates a small always-on-top, non-focusable window and calls `showInactive()`, but it does not explicitly position the overlay on a visible display or reassert top-most state after showing.
- The overlay resizes dynamically but has no screen-aware placement logic.

User impact:
- A user can press the hotkey and not know whether recording started.
- If the overlay appears behind another full-screen or elevated app, users may keep talking with no confidence, then think the product is unreliable.

Recommended fix:
- Add deterministic overlay placement using Electron `screen.getDisplayNearestPoint()` or primary display work area.
- Put the overlay near the top center or bottom center of the active display with margins.
- On every `show()`, call `setAlwaysOnTop(true, "screen-saver")`, `moveTop()`, and then `showInactive()`.
- Add a tray icon recording state or tooltip update while recording as a secondary signal.
- Consider a small audible start/stop cue, configurable and off by default if privacy-sensitive.

Acceptance criteria:
- Overlay appears on the current display, never off-screen.
- Overlay remains visible above normal app windows.
- Tray tooltip/menu clearly says `Recording...` while active.

### 2. First-Time Setup Lacks A Full Guided Checklist

Evidence:
- Missing API key opens Settings and shows a short setup callout.
- Settings has a microphone test button and readiness list, but no step-by-step completion flow.
- There is no README or user-facing quick-start file in the repo.

User impact:
- Non-technical users may not know where to get a Groq key, why the hotkey matters, whether the microphone permission was accepted, or what copy-only means.
- A first launch may feel like a settings panel instead of a guided product setup.

Recommended fix:
- Add a first-run checklist in Settings:
  1. Add Groq API key.
  2. Test microphone.
  3. Confirm hotkey works.
  4. Try a short test dictation.
  5. Choose copy-only or auto-paste.
- Add a small `README.md` or `docs/user-quick-start.md` with install, first launch, recording, troubleshooting, and diagnostics export.
- Add a `Reset setup / Run setup again` action in Settings.

Acceptance criteria:
- A new user can complete setup without guessing.
- The app clearly distinguishes "not configured", "ready", "recording", "processing", and "failed".

### 3. Recording Stop Model Is Easy To Misunderstand

Evidence:
- Requirements say hotkey release intentionally does not stop recording.
- Current flow starts recording on hotkey press and requires clicking the overlay check button or pressing the hotkey again to finish.
- The visible overlay message is only `Listening...`.

User impact:
- Users coming from push-to-talk tools may release the hotkey and assume recording stopped.
- If the overlay is not visible, they may not know how to stop.

Recommended fix:
- Make the listening overlay communicate the stop action, for example `Recording - press hotkey again or check to finish`.
- Add a Settings option for recording mode:
  - Toggle mode: press once to start, press again to stop.
  - Hold mode: hold to record, release to stop.
- Keep toggle mode as default if it matches product direction, but make it explicit.

Acceptance criteria:
- Users can infer how to stop recording without documentation.
- Hotkey behavior is visible in Settings and onboarding.

### 4. Silence Auto-Stop May Cut Off Real Users

Evidence:
- The recorder auto-stops after 5 seconds of silence using a fixed RMS threshold.
- There is no setting, no status message explaining silence stop, and no calibration.

User impact:
- Slow speakers, pauses while thinking, quiet microphones, headset noise suppression, or non-native dictation patterns can stop recordings unexpectedly.
- The user may see "No speech captured" or get a partial transcript without understanding why.

Recommended fix:
- Make silence auto-stop configurable or disable it for the first beta.
- If kept, show `Stopped after silence` instead of generic idle status.
- Consider a longer default, such as 10-15 seconds, and add telemetry for silence stops.

Acceptance criteria:
- Users are not surprised when recording stops.
- Silence-based stop events are distinguishable from manual stop, max duration, and recorder failure.

### 5. Hotkey Availability Is Reported But Not Solved

Evidence:
- Tray and Settings show hotkey status as active/unavailable.
- Invalid hotkey input is normalized back to default by config normalization, but the UI does not explain what happened.

User impact:
- If another app conflicts with the hotkey or uiohook fails, users see "Unavailable" but do not get a clear recovery path.
- If they type an unsupported hotkey, the app may silently fall back.

Recommended fix:
- Validate hotkey on save and show a specific message before saving.
- Add a "Try another hotkey" recommendation when unavailable.
- Add a hotkey test action in Settings separate from microphone test.

Acceptance criteria:
- Unsupported hotkeys produce immediate UI feedback.
- Hotkey conflicts have an obvious next action.

## Medium-Priority Product Risks

### 6. Processing Can Feel Hung During Groq Calls

Evidence:
- Transcription and cleanup each use 45-second client timeouts with retries for transient failures.
- Status changes to `Converting speech to text...` and `Polishing transcript...`, but there is no elapsed time, cancel, or retry UI.

User impact:
- A slow network or rate limit can look like the app is stuck.
- Users may press the hotkey repeatedly while processing, but `startRecording()` silently returns during processing.

Recommended fix:
- Show elapsed processing time after a few seconds.
- Add a cancel processing action if technically safe, or at least show "Still working...".
- If hotkey is pressed during processing, show `Still processing previous recording`.

Acceptance criteria:
- Long requests have visible progress state.
- Repeated user input during processing produces feedback.

### 7. Auto-Paste Is Safer Than Usual, But Still Needs Stronger Recovery UX

Evidence:
- The app captures the active target before recording and checks the window handle/title before pasting.
- If paste fails, text is copied and an error is shown.

User impact:
- "Paste failed; text copied" is technically accurate but may not be enough. Users need to know they can manually paste with Ctrl+V.
- Some apps run elevated; non-elevated automation may fail.

Recommended fix:
- Change paste failure status to `Paste blocked; text copied. Press Ctrl+V manually.`
- In diagnostics, include whether paste target capture succeeded and whether handle verification was available.
- Add Settings copy explaining elevated app limitation if observed during manual QA.

Acceptance criteria:
- Paste failures never feel like lost work.
- User gets an immediate recovery action.

### 8. Microphone Permission UX Is Reactive

Evidence:
- Settings has "Test microphone".
- Recorder uses hidden browser `getUserMedia`.
- Errors are normalized for permission denied.

User impact:
- Windows and Chromium permission prompts can be confusing from a hidden recorder window.
- A user may deny permission once and not know how to recover.

Recommended fix:
- Require microphone test in first-run checklist.
- If permission fails, show a Windows-specific recovery hint: Settings -> Privacy & security -> Microphone.
- Add a troubleshooting doc with screenshots later if this ships to non-technical users.

Acceptance criteria:
- First recording is not the first time users discover microphone permission issues.

### 9. Startup And Tray Behavior Need Manual QA Across Windows Modes

Evidence:
- The app runs as a tray app, displays tray balloons, supports second-instance notice, and can start at login in packaged mode.
- Windows notification/tray behavior varies by user settings and hidden tray icon state.

User impact:
- Some users may launch the app and think nothing happened if tray icons are hidden or balloons are disabled.
- Start-at-login can make the app active without users realizing it.

Recommended fix:
- On first installed launch, open Settings even if an API key is present only when first-run has not been completed.
- Add a "Show startup notification" setting.
- Ensure tray tooltip includes current state: Ready, Recording, Processing, Setup needed, Hotkey unavailable.

Acceptance criteria:
- Launching the app always creates a visible cue.
- Users can find Settings without knowing tray conventions.

## Developer And Release Risks

### 10. Local Setup Needs Node Version Clarity

Evidence:
- `npm install` reported Electron 42 packages require Node >= 22.12.0, while this machine is Node 20.19.6.
- Build and tests still passed after install, but this is fragile for future contributors.

Recommended fix:
- Add `.nvmrc` or `.node-version` with Node 22.12+.
- Add `engines.node` to `package.json`.
- Document setup: install Node 22 LTS, run `npm install`, `npm run build`, `npm test`.

### 11. Audit Still Reports A Dependency Vulnerability Chain

Evidence:
- `npm audit --omit=dev` reports moderate vulnerabilities via `@nut-tree-fork/nut-js` -> `jimp` -> `file-type`, with no fix available from audit.

Recommended fix:
- Evaluate whether `@nut-tree-fork/nut-js` is necessary for both active-window detection and paste automation.
- If it remains, document the accepted risk for beta and monitor dependency updates.
- Consider replacing active-window/paste pieces with a smaller Windows-specific dependency if the vulnerability chain remains stale.

### 12. Missing User-Facing Documentation

Evidence:
- `AGENT.md` is strong engineering guidance, but it is not a user guide.
- No README exists in the current repo root.

Recommended fix:
- Add `README.md` for developers and `docs/user-quick-start.md` for users/testers.
- Include "What to do when recording did not start", "What to do when overlay is missing", "Where logs are", and "How to export diagnostics".

## Suggested Fix Order

1. Overlay visibility and tray recording state.
2. First-run checklist plus user quick-start docs.
3. Clearer recording stop instructions and processing feedback.
4. Hotkey validation/test UX.
5. Silence auto-stop hardening.
6. Paste failure recovery message and diagnostics detail.
7. Node version documentation and dependency risk decision.

## Verification Performed

- `npm install` completed successfully, with Node 20 vs Electron 42 engine warnings.
- `npm run build` passed.
- `npm test` passed: 43 tests, 43 pass.
- `npm audit --omit=dev` reported 7 moderate production vulnerabilities through `@nut-tree-fork/nut-js` transitive dependencies.


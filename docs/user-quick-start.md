# BayanFlow User Quick Start

## What BayanFlow Does

BayanFlow lets you dictate text into Windows apps. It records your voice, transcribes it, optionally cleans the text, and then copies or pastes it.

## First-Time Setup

1. Open BayanFlow.
2. Add your Groq API key in Settings.
3. Click `Test microphone`.
4. Confirm the hotkey is active.
5. Confirm the Input Assist hotkey if you want the floating magic icon.
6. Save settings.

Default hotkey: `Ctrl+Shift+Space`.
Default Input Assist hotkey: `Ctrl+Shift+Enter`.

## How To Record

1. Click into the app where you want the text.
2. Press the BayanFlow hotkey once.
3. Confirm the overlay says recording is active.
4. Speak.
5. Press the hotkey again or click the check button on the overlay.
6. Wait for processing.

If copy-only mode is enabled, press `Ctrl+V` where you want the text.

## How To Use Input Assist

1. Click into a text input.
2. Press `Ctrl+Shift+Enter` to turn Input Assist on.
3. If Windows can detect the input, a small BayanFlow icon appears near the right side of the input.
4. Click the icon.
5. Choose `Speak here` or a rewrite action.

Rewrite uses selected text first. If no text is selected, BayanFlow tries to use the whole focused input. You will see a preview before replacement.

## Overlay And Tray State

The overlay appears near the top of the active display. If you cannot see it, check the BayanFlow tray icon tooltip. The tray status shows whether the app is ready, recording, processing, needs setup, or has a hotkey issue.

The Input Assist icon only appears when Windows exposes a focused editable input. Some custom-rendered, elevated, or full-screen apps may not expose enough information; in those cases, use normal dictation or copy/paste fallback.

## Copy-Only Vs Auto-Paste

Copy-only is the safer default. BayanFlow copies the transcript and lets you paste it manually.

Auto-paste tries to paste into the original app window after recording. If Windows blocks this, BayanFlow keeps the result copied and shows a recovery message.

## Common Problems

### Microphone Permission Was Denied

Open Windows Settings -> Privacy & security -> Microphone. Make sure microphone access is enabled, then return to BayanFlow Settings and click `Test microphone`.

### Hotkey Is Unavailable

Another app may already use that shortcut. Try `Ctrl+Alt+Space`, save, and test again.

### Input Assist Icon Does Not Appear

Focus a normal text input and confirm Input Assist is enabled from the tray menu. Some apps do not expose editable input bounds to Windows, so BayanFlow hides the icon instead of guessing the wrong position.

### Recording Stops Early

BayanFlow may stop after silence or when the max duration is reached. Try speaking closer to the microphone and avoid long pauses.

### Paste Failed

Your transcript should still be copied. Press `Ctrl+V` manually in the target app.

### Support Needs Logs

Open the tray menu and choose `Export Diagnostics`. The export contains sanitized logs and local app state, not transcript text or API keys.

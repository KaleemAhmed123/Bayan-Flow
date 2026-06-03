# BayanFlow

BayanFlow is a Windows-first AI writing assistant that lets you speak, rewrite, polish, and paste text into the apps you already use.

It is built for people who write all day across chat apps, browsers, editors, tickets, emails, documents, and internal tools. Instead of switching between separate AI tabs, BayanFlow brings dictation and rewrite actions directly beside the focused input.

## The Problem

Writing on a computer is fragmented:

- You think faster than you type.
- Voice dictation often produces raw, messy text.
- AI writing tools usually live in a separate browser tab.
- Copying text between apps breaks focus.
- Long prompts, messages, notes, and replies need different tones depending on context.

BayanFlow solves this by combining speech-to-text, AI cleanup, and focused input rewriting in one small tray app.

## What BayanFlow Does

- Records your voice with a global hotkey.
- Transcribes speech with Groq Whisper.
- Optionally cleans the transcript with an AI model.
- Copies or pastes the final text back into your active app.
- Shows a compact recording/status overlay.
- Adds Input Assist mode with a floating magic icon beside detected text inputs.
- Rewrites selected text or the whole focused input with preview-before-replace.
- Falls back safely to clipboard copy if Windows blocks direct replacement.

## Core Workflows

### 1. Speak Anywhere

Click into any app, press the dictation hotkey, speak, then finish recording. BayanFlow converts your voice into text and either copies it or pastes it back.

Default dictation hotkey:

```txt
Ctrl+Shift+Space
```

### 2. Rewrite In Place

Turn on Input Assist, click the floating magic icon near an input, then choose a rewrite action:

- Fix grammar
- Polish
- Professional
- Friendly/Casual
- Shorten
- Expand
- Simplify
- Custom instruction

Default Input Assist hotkey:

```txt
Ctrl+Shift+Enter
```

### 3. Speak Here

Input Assist also includes `Speak here`. It refocuses the detected input and starts a dictation session for that exact place.

If another speech-to-text session is already recording, BayanFlow stops it cleanly before starting the new one. If speech-to-text is still processing, BayanFlow shows a clear message and waits for the current job to finish.

## Who This Is For

BayanFlow is useful for:

- Founders and operators writing fast across many apps.
- Developers writing issues, PR comments, docs, and chat replies.
- Support and sales teams responding with different tones.
- Students and researchers turning rough thoughts into clean notes.
- Anyone who wants voice input without losing control of the final text.

## Requirements

For normal use:

- Windows x64.
- A working microphone.
- A Groq API key.
- Internet access for transcription and AI cleanup/rewrite.

For development:

- Node.js `22.12.0` or newer.
- npm.
- Windows is recommended because the overlay, hotkeys, paste automation, and UI Automation helper are Windows-first.

## Groq API Key Setup

BayanFlow does not ship with an API key. Each user needs their own Groq API key.

1. Create or open a GroqCloud account.
2. Create an API key from the Groq console.
3. Launch BayanFlow.
4. Open Settings from the tray icon.
5. Paste the API key.
6. Save settings.
7. Use `Test microphone` before the first real recording.

Keep your API key private. Do not share screenshots, logs, or builds that include private keys.

## First Launch Guide

On first launch, BayanFlow opens Settings if no Groq API key is saved.

Recommended setup:

1. Add your Groq API key.
2. Click `Test microphone`.
3. Confirm the dictation hotkey.
4. Confirm the Input Assist hotkey.
5. Keep auto-paste off at first.
6. Save settings.
7. Try one short recording in Notepad or another simple text input.

Copy-only mode is the safer default. Once you trust the workflow, you can enable auto-paste.

## How To Use Dictation

1. Click into the app where you want text.
2. Press `Ctrl+Shift+Space`.
3. Speak normally.
4. Press the hotkey again or use the overlay check button.
5. Wait for transcription and cleanup.
6. Paste manually if copy-only mode is enabled.

If auto-paste is enabled, BayanFlow tries to paste into the original active window. If Windows blocks paste automation or the target changes, BayanFlow keeps the text copied so you can press `Ctrl+V`.

## How To Use Input Assist

1. Click into a text input.
2. Press `Ctrl+Shift+Enter`.
3. If Windows can detect the input, a small magic icon appears near it.
4. Click the icon.
5. Choose `Speak here` or a rewrite action.

Rewrite behavior:

- Selected text is used first.
- If nothing is selected, BayanFlow tries the whole focused input.
- A preview is always shown before replacement.
- If safe replacement is not possible, the rewritten text is copied.

Input Assist uses Windows UI Automation and clipboard verification. Some apps expose excellent input information. Some custom-rendered, elevated, or full-screen apps do not. In unsupported cases, BayanFlow hides the icon or falls back to clipboard-safe behavior instead of guessing.

## Custom Rewrite Examples

Use `Custom` for one-off instructions such as:

```txt
Explain this in a simple and detailed way
Make this sound confident but not aggressive
Turn this into a short customer support reply
Rewrite this as a technical release note
Make this suitable for LinkedIn
Convert these rough notes into clean bullet points
```

Custom instructions can transform, explain, expand, or rewrite the focused text. They are not limited to tone changes.

## Privacy And Safety

BayanFlow is designed to avoid unnecessary text retention.

- It does not intentionally log transcript text, selected text, rewritten text, or API keys.
- Logs use character counts and metadata for debugging.
- Clipboard fallback is used when direct replacement is unsafe.
- Replacement verifies the target when possible before changing text.
- Diagnostics are intended to help debug app state without exposing private content.

Important: transcription and rewrite requests are sent to Groq because BayanFlow uses Groq-hosted models. Users should review Groq terms and policies for their own usage requirements.

## Known Limitations

- Windows-only for the packaged app.
- Requires a Groq API key and internet access.
- Unsigned Windows installers may show a SmartScreen warning.
- Input Assist cannot appear in every app because some apps hide input bounds from Windows UI Automation.
- Elevated apps may block normal paste automation from a non-elevated tray app.
- Full-screen apps can obscure overlays.
- Very long rewrite inputs are limited for performance and reliability.

## Troubleshooting

### No Groq API Key

Open Settings from the tray icon, add your key, then save.

### Microphone Fails

Open Windows Settings -> Privacy & security -> Microphone and confirm microphone access is enabled. Then run `Test microphone` inside BayanFlow Settings.

### Hotkey Does Not Work

Another app may already use the shortcut. Try a different shortcut such as:

```txt
Ctrl+Alt+Space
```

### Input Assist Icon Does Not Appear

Make sure Input Assist is on and the focused app exposes an editable input to Windows. Try Notepad first. If the icon appears there but not in another app, that app likely does not expose enough UI Automation information.

### Replacement Fails

BayanFlow copies the generated text when replacement is unsafe. Press `Ctrl+V` manually.

### Overlay Is Behind Another Window

Use the tray tooltip to confirm app state. Input Assist windows are compact overlays and can be dragged when visible.

### Need Logs

Open the tray menu and choose `Export Diagnostics`.

## Build A Shareable Windows Installer

Install dependencies:

```powershell
npm install
```

Validate the app:

```powershell
npm run build
npm test
```

Create the Windows installer:

```powershell
npm run dist
```

The installer is written to:

```txt
release/
```

Typical output is an NSIS installer such as:

```txt
release/BayanFlow Setup 0.1.0.exe
```

Before sharing a build, test it on a clean Windows user profile if possible.

## Development Commands

```powershell
npm install
npm run dev
npm run build
npm test
npm run dist
```

Additional checks:

```powershell
npm run local:smoke
npm run packaged:smoke
npm run audit:prod
```

## Distribution Notes

For early sharing, you can send the generated installer from `release/`.

For public distribution, plan for:

- Code signing to reduce SmartScreen friction.
- A versioned changelog.
- A simple landing page with a short demo video.
- Clear pricing or usage expectations around the user's Groq API key.
- A support path for logs, microphone setup, hotkey conflicts, and paste failures.

## Product Positioning

BayanFlow is not just another dictation tool. It is a writing layer for Windows: speak your rough thought, reshape it for the situation, preview the output, and place it back where you were already working.

The goal is simple:

```txt
Think out loud. Ship clean text.
```

## License

Private project. Add a license before public release.

## Download

Download the latest Windows installer from:

https://github.com/KaleemAhmed123/Bayan-Flow/releases/latest
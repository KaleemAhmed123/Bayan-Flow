# BayanFlow

BayanFlow is a Windows-first AI writing assistant that lets you speak, rewrite, polish, and paste text into the apps you already use.

It is built for people who write all day across chat apps, browsers, editors, tickets, emails, documents, and internal tools. Instead of switching between separate AI tabs, BayanFlow puts dictation and rewrite one hotkey away from wherever you are typing.

## The Problem

Writing on a computer is fragmented:

- You think faster than you type.
- Voice dictation often produces raw, messy text.
- AI writing tools usually live in a separate browser tab.
- Copying text between apps breaks focus.
- Long prompts, messages, notes, and replies need different tones depending on context.

BayanFlow solves this by combining speech-to-text, AI cleanup, and focused input rewriting in one small tray app.

## What BayanFlow Does

- Records your voice while you hold one hotkey.
- Transcribes speech with Groq Whisper.
- Polishes the transcript with an AI model.
- Pastes the finished text straight back into the app you were using.
- Shows one small dock at the bottom of your screen, in the same place every time.
- Rewrites the text already in your focused input from a layered menu.
- Lets you Redo any result if you do not like it, instead of asking you to approve one first.
- Falls back to the clipboard, and says so, whenever Windows blocks a paste.

## Core Workflows

### 1. Speak Anywhere

Click into any app. **Hold** the dictation hotkey, speak, then release. BayanFlow transcribes, polishes,
and pastes the text where your cursor was. No confirmation step.

For longer dictation, **tap** the hotkey instead of holding it. Recording latches on and stays on until
you tap again, so you do not have to keep a key held down. Press `Esc` at any time to cancel.

Default dictation hotkey:

```txt
Ctrl+Shift+Space
```

### 2. Redo Instead Of Approving

When the text lands, the dock offers `Redo`. It undoes what it just pasted, rewrites your original
speech with different phrasing, and pastes the new version. Press it as many times as you like.

This is why there is no preview screen. You get the result immediately, and changing it costs one click.

### 3. Rewrite What You Already Typed

Click into a text box, press the rewrite hotkey, and pick an action from the dock:

**Always visible:** Polish, Professional, Shorten
**Behind "More":** Fix grammar, Friendly, Expand, Simplify, Custom

`Custom` takes any one-off instruction, such as "turn this into a short support reply".

Default rewrite hotkey:

```txt
Ctrl+Shift+Enter
```

BayanFlow reads the input through the clipboard, rewrites it, verifies the text has not changed, then
replaces it. If replacement is not safe, the rewrite is copied and the dock tells you to press Ctrl+V.

### The Pill

When nothing is happening, BayanFlow sits at the bottom centre of your screen as a small pill.

- **Click it** to start dictating.
- **Hover it** to reveal Dictate, Rewrite, Settings, and Hide for 1 hour.
- The dot is green when BayanFlow is ready and grey when it needs setup.

Everything happens in that one spot. The pill expands outward from its own centre, so the control under
your cursor never moves. It never follows your mouse and never covers the input you are typing into.

Don't want it on screen? Turn off `Keep the pill on screen` in Settings, or use the tray menu. The minus
button on the pill hides it for an hour.

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
- Windows is required in practice because the dock, global hotkeys, and paste automation are Windows-first.

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
4. Confirm the rewrite hotkey.
5. Save settings.
6. Hold the dictation hotkey in Notepad, say one sentence, and release.

BayanFlow pastes into your active app by default. If you would rather it only copy, turn off
`Paste straight into the app` in Settings.

## How To Use Dictation

1. Click into the app where you want text.
2. Hold `Ctrl+Shift+Space`.
3. Speak normally.
4. Release. (Or tap once at the start to latch, then tap again to finish.)
5. The text is transcribed, polished, and pasted.

Press `Esc` while recording to cancel and discard the audio.

If Windows blocks the paste or the target window changed, BayanFlow keeps the text on your clipboard and
the dock shows a `Copy again` button, so nothing is ever lost.

## How To Use Rewrite

1. Click into a text input and type something rough.
2. Press `Ctrl+Shift+Enter`.
3. The dock opens at the bottom of your screen with the rewrite menu.
4. Pick an action, or press `More` for the full set, or use `Custom` for a one-off instruction.

Select the text you want changed, or leave the caret in a line and BayanFlow will rewrite that line.
The result replaces what it rewrote. If you do not like it, press `Redo` and it runs the same action
again with different wording.

BayanFlow reads and replaces text through the clipboard, which works in Chromium and Electron apps
where Windows UI Automation cannot reliably write text. Where replacement is not safe, it copies the
result instead of guessing, and says so in the dock.

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
- `Redo` relies on the target app supporting Ctrl+Z. That covers VS Code, Brave, WhatsApp, and Notion.
  In a terminal, which has no undo, the new version is appended instead of replacing the old one.
- Elevated apps may block paste automation from a non-elevated tray app.
- Full-screen exclusive apps can cover the dock.
- Very long rewrite inputs are capped for performance and reliability.

## Troubleshooting

### No Groq API Key

Open Settings from the tray icon, add your key, then save. The dock also shows an `Open Settings`
button whenever the key is missing.

### Microphone Fails

Open Windows Settings, then Privacy & security, then Microphone, and confirm microphone access is
enabled for desktop apps. Then run `Test microphone` inside BayanFlow Settings.

### Hotkey Does Not Work

Another app may already use the shortcut. Try a different one such as:

```txt
Ctrl+Alt+Space
```

### Recording Stops When I Release The Key

That is hold-to-talk, and it is the default. If you want hands-free recording, **tap** the hotkey
instead of holding it, then tap again to finish.

### The Rewrite Menu Says No Text Found

BayanFlow reads your input through the clipboard, so the input must be focused and contain text.
Click into the field first, then press the rewrite hotkey.

### Replacement Failed

BayanFlow copies the generated text whenever replacement is unsafe. Press `Ctrl+V` manually. The dock
shows a `Copy again` button if you need it back on the clipboard.

### I Cannot See The Dock

It appears at the bottom centre of the screen your mouse is on. A full-screen exclusive app can cover
it; the tray tooltip always shows the current state as a fallback.

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

BayanFlow is not just another dictation tool. It is a writing layer for Windows: speak your rough thought, have it land already polished in the app you were using, and reshape it in one click if it is not right.

The goal is simple:

```txt
Think out loud. Ship clean text.
```

## License

Private project. Add a license before public release.

## Download

Download the latest Windows installer from:

https://github.com/KaleemAhmed123/Bayan-Flow/releases/latest
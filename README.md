# BayanFlow

BayanFlow is a Windows-first Electron tray app for AI dictation. It records microphone audio, transcribes it with Groq Whisper, optionally cleans the transcript with a Groq chat model, then copies or pastes the final text.

## Requirements

- Windows x64 for packaged app usage.
- Node.js 22.12.0 or newer for development.
- A Groq API key.
- A working microphone.

## Developer Setup

```powershell
npm install
npm run build
npm test
```

Useful commands:

```powershell
npm run dev
npm run local:smoke
npm run pack
npm run packaged:smoke
npm run audit:prod
```

## First Launch

If no Groq API key is saved, BayanFlow opens Settings automatically. Complete the setup checklist:

1. Add your Groq API key.
2. Test the microphone.
3. Confirm the hotkey is active.
4. Confirm the Input Assist hotkey if you want the floating rewrite icon.
5. Keep copy-only mode unless you explicitly want auto-paste.

Default hotkey: `Ctrl+Shift+Space`.
Default Input Assist hotkey: `Ctrl+Shift+Enter`.

## Recording

Press the configured hotkey once to start recording. Use the overlay check button or press the hotkey again to finish. Use the X button to cancel.

If auto-paste is off, BayanFlow copies the result to the clipboard. If auto-paste is on and Windows blocks paste automation, BayanFlow keeps the text copied so you can press `Ctrl+V` manually.

## Input Assist

Press `Ctrl+Shift+Enter` to toggle Input Assist. When Windows exposes a focused editable input through UI Automation, BayanFlow shows a small floating icon on the right side of that input.

Click the icon to open writing actions:

- Speak here
- Fix grammar
- Polish
- Professional
- Friendly/Casual
- Shorten
- Expand
- Simplify
- Custom

Rewrite uses selected text first. If nothing is selected, BayanFlow tries the whole focused input. Replacement is preview-first. If the target changed or direct replacement is unsafe, the rewritten text is copied so you can paste manually.

## Troubleshooting

- Overlay is missing: check the tray tooltip. It now shows whether BayanFlow is recording or processing.
- Microphone fails: open Settings and run `Test microphone`, then check Windows microphone privacy settings.
- Hotkey unavailable: choose another shortcut such as `Ctrl+Alt+Space`.
- Input Assist icon missing: make sure Input Assist is on and the focused app exposes an editable input to Windows UI Automation.
- Paste blocked: the text should still be copied; press `Ctrl+V` manually.
- Need support data: tray menu -> `Export Diagnostics`.

See [docs/user-quick-start.md](docs/user-quick-start.md) for the tester-facing guide.

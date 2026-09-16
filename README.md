# BayanFlow

**Speak into any Windows app. Or rewrite what you already typed. Two hotkeys, no browser tab.**

https://github.com/user-attachments/assets/526895ab-c99f-4b48-bd0b-12ed32cb23c0

**[Download BayanFlow 0.2.1 for Windows](https://github.com/KaleemAhmed123/Bayan-Flow/releases/download/v0.2.1/BayanFlow-Setup-0.2.1.exe)** &middot; 82 MB &middot; [all releases](https://github.com/KaleemAhmed123/Bayan-Flow/releases)

A tray app that sits as a small pill at the bottom of the screen. Hold one hotkey and talk — the
text lands where your cursor was, cleaned up. Press the other and it rewrites what is already in
the box. Runs on **your own free Groq key**: no account, no subscription, no BayanFlow server.

> **Windows only.** It depends on Windows-specific keyboard hooking and paste simulation.

## The two hotkeys

| Hotkey | What it does |
|---|---|
| `Ctrl` + `Shift` + `Space` | **Dictate.** Hold and talk, or tap to latch hands-free. Stops on its own after 5s of silence. `Esc` throws the audio away. |
| `Ctrl` + `Shift` + `Enter` | **Rewrite.** Polish, Professional, Shorten, Fix grammar, Friendly, Expand, Simplify, or your own instruction. |

Both are changeable in **Settings → Shortcuts**. If a paste is ever blocked, the text goes to your
clipboard and the dock tells you — a dictation is never silently lost.

## Install

1. Download [`BayanFlow-Setup-0.2.1.exe`](https://github.com/KaleemAhmed123/Bayan-Flow/releases/download/v0.2.1/BayanFlow-Setup-0.2.1.exe)
   (or any newer build from the [Releases page](https://github.com/KaleemAhmed123/Bayan-Flow/releases)).
   Installs per-user; no admin password.
2. **Windows SmartScreen will warn you.** The builds are **not code-signed** yet. Click
   **More info → Run anyway**. Signing is on the list before any wider release.
3. Launch it. The first-run screen asks for a Groq key: **Settings → General → Get a free Groq key**
   opens [console.groq.com/keys](https://console.groq.com/keys). Accounts are free; the free tier is
   what the app is tuned for.

Updates are automatic — checked against GitHub Releases over HTTPS and verified by SHA-512.

## Bring your own key

- **Your key, your usage, your rate limits.** Your machine talks straight to Groq. There is nothing
  in the middle because there is nothing we run.
- **One key for everything** — transcription, rewrite, screen context.
- **Not tied to Groq.** **Settings → Advanced** exposes the base URLs and model IDs, so any
  OpenAI-compatible endpoint, including a local one, works instead.

## Privacy — precisely

**BayanFlow is not local-only.** Speech recognition and rewriting happen on Groq's servers. Your
audio leaves your machine. Exactly what leaves, and what stays:

### Sent to Groq

| Sent | When |
|---|---|
| **The recorded audio** | Every dictation. This is how transcription works. |
| **The transcript text** | Every dictation, for the cleanup pass. |
| **Active app name and window title** | On by default; helps spell names on your screen. Off in **Settings → Privacy**. |
| **A JPEG of the active window** | **Off by default, opt-in only.** One window, never the full screen. Held in memory, sent, discarded — never written to disk or logs. |

Both context options obey a **blocklist** you control: if the foreground window title matches, the
app collects nothing from it — not even the title. Put your password manager and your bank in it.

### Stays on your machine

| Data | Where | How long |
|---|---|---|
| Your Groq key | `config.json`, encrypted via Windows secure storage | Until you change it |
| Dictation history | `history.jsonl`, plain text, local only | Newest 500 entries |
| Temporary audio | Windows temp folder | Deleted on every exit path |
| Logs | App log folder, **transcript text redacted** | Rolling |

None of this is uploaded to us. History only feeds the local History and Stats pages; turn it off in
**Settings → Privacy** and each dictation is forgotten the moment it is pasted.

Two things worth knowing: dictated text **does** appear in Windows clipboard-history tools, on
purpose — if a paste is blocked, that is the only remaining copy. And once a request leaves your
machine, [Groq's own policy](https://groq.com) governs it, not this README.

## Build from source

Requires **Node 22.12.0** (pinned in `.node-version`) and Windows.

```bash
git clone https://github.com/KaleemAhmed123/Bayan-Flow.git && cd Bayan-Flow && npm install
npm run build && npm test && npm run local:smoke   # build, test, smoke the unpackaged app
npm run dist && npm run packaged:smoke             # NSIS installer into release/, then smoke it
```

Design and audit specs — the reasoning behind most decisions — live in [`docs/specs/`](docs/specs/).

## Licence

Proprietary. See [LICENSE](LICENSE). The source is readable here; it is not open source.

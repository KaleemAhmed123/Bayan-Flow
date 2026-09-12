# BayanFlow Quick Start

BayanFlow lets you speak into any Windows app. Hold one key, talk, let go — the text lands where your
cursor was, already tidied up.

It also rewrites text you have already typed.

---

## Installing

1. Run `BayanFlow Setup.exe`.
2. **Windows will show a blue "Windows protected your PC" screen.** This is expected. BayanFlow is not
   code-signed yet, so Windows does not recognise it.
   - Click **More info** (the small text).
   - Click **Run anyway**.
3. Finish the installer. BayanFlow starts and lives in your **system tray** — the icons near the clock.

There is no main window. The tray icon and a small pill at the bottom of your screen are the whole app.

---

## First-time setup

BayanFlow needs a **Groq API key**. Groq is the service that turns your speech into text. Accounts are
free and BayanFlow does not ship with a key, so everyone uses their own.

1. BayanFlow opens its window automatically on first launch. If it did not, **left-click the tray icon**.
2. Go to **Settings → General**.
3. Click **Get a free Groq key**. Your browser opens `console.groq.com/keys`.
4. Sign up (free), create a key, and copy it.
5. Paste it into the **Groq API key** box.
6. Click **Save**.
7. Click **Test microphone**, right below the microphone picker. Do this before your first real recording.

The **Home** page has a checklist that ticks off each step as you genuinely complete it.

---

## Dictating

1. Click into any text box — email, chat, browser, editor, anything.
2. **Hold** `Ctrl+Shift+Space`.
3. Speak.
4. **Let go.**

The text is transcribed, polished, and pasted where your cursor was. There is no confirmation step.

**For longer dictation, tap instead of holding.** A quick tap latches recording on, so you can take your
hands off the keyboard. Tap again to finish.

**Press `Esc` at any time to cancel** and throw the audio away.

**If you go quiet for about five seconds, recording stops on its own.** That is deliberate, so a
forgotten latched recording does not run forever.

---

## If you do not like the result

The dock shows a **Redo** button after every result.

Redo removes what it just pasted, rewrites your original speech differently, and pastes the new version.
Press it as many times as you like. Each Redo works from what you actually said, not from the last
attempt, so repeated presses never drift.

This is why there is no preview screen. You get the result straight away, and changing it costs one click.

---

## Rewriting text you already typed

1. Click into a text box that already has text in it.
2. Press `Ctrl+Shift+Enter`.
3. The dock opens at the bottom of your screen with a menu.

**Always visible:** Polish, Professional, Shorten
**Behind "More":** Fix grammar, Friendly, Expand, Simplify, Custom

**Custom** takes any one-off instruction, for example:

```txt
Turn this into a short customer support reply
Make this sound confident but not aggressive
Convert these rough notes into clean bullet points
```

Select the text you want changed, or just leave your cursor in a line and BayanFlow rewrites that line.
If replacing the text is not safe, BayanFlow copies the result instead and tells you to press `Ctrl+V` —
it never guesses.

---

## The pill

When nothing is happening, BayanFlow sits at the **bottom centre** of your screen as a small pill.

- **Click it** to start dictating.
- **Hover it** to reveal Dictate, Rewrite, Settings, and Hide for 1 hour.
- **The dot is green** when BayanFlow is ready, **grey** when it still needs setup.

Everything happens in that one spot. It never follows your mouse and never covers what you are typing into.

Don't want it? Turn off **Keep the pill on screen** in Settings, or use the tray menu. The minus button
on the pill hides it for an hour.

---

## The tray menu

Right-click the tray icon:

- **Show the pill** / **Paste automatically** — quick toggles.
- **Add clipboard word to vocabulary** — copy a name BayanFlow keeps misspelling, then click this. It
  will get it right from then on.
- **Settings** — the main window.
- **Open Logs Folder** / **Export Diagnostics** — for when you need to send me something.

Left-click the tray icon opens Settings directly.

---

## What is stored, and what leaves your PC

Worth knowing up front:

| Thing | Where it goes |
|---|---|
| Your speech | Sent to Groq to be transcribed, then discarded. The audio file is deleted right after. |
| Your API key | Encrypted and stored on this PC only. Never sent anywhere except Groq. |
| **Your dictation history** | **Saved on this PC**, in plain text, so the History and Stats pages can exist. **On by default.** Turn it off, or clear it, in **Settings → Privacy**. |
| **The title of the window you are typing in** | **Sent to Groq with each dictation**, so it spells names on your screen correctly. **On by default.** Turn it off in **Settings → Privacy**. |
| A screenshot of your active window | **Off by default.** Opt-in only, in Settings → Privacy, with a blocklist for windows it must never look at. |
| Logs | Stay on this PC. Your dictated text is stripped out of them. |

**Export Diagnostics** contains sanitised logs and app state — never your transcripts and never your key.

---

## Common problems

### Nothing happens when I double-click BayanFlow

Your antivirus has probably quarantined part of it. BayanFlow watches for your hotkey using a Windows
keyboard hook, and security software sometimes blocks that in unsigned apps. Allow BayanFlow in your
antivirus and reinstall. BayanFlow will show an error box explaining this if it can.

### The hotkey does nothing

Another app may already own that shortcut. Change it in **Settings → Shortcuts** — try `Ctrl+Alt+Space`.
The Home page shows whether the hotkey registered.

### "Microphone permission was denied"

Windows Settings → Privacy & security → Microphone. Make sure microphone access is on, and that desktop
apps are allowed. Then come back and click **Test microphone**.

### My first recording came back empty

Opening the microphone takes a moment on a cold start. If you released the key very quickly, BayanFlow
tells you the microphone was still starting — just press again.

### Recording stopped while I was still thinking

BayanFlow stops after about five seconds of silence. Speak again sooner, or dictate in shorter pieces.

### "Paste blocked" / the text did not appear

Your text is on the clipboard. Press `Ctrl+V`. Some apps refuse a synthetic paste; BayanFlow always
leaves the result on the clipboard so nothing is ever lost.

### It keeps misspelling a name

Add it to your vocabulary — **Settings → Dictation → Custom vocabulary**, one per line. Or copy the word
and use **Add clipboard word to vocabulary** in the tray menu. Vocabulary always beats what BayanFlow
guesses from your screen.

### Something else is wrong

Tray menu → **Export Diagnostics**, then send me the folder. It has no transcripts and no API key in it.

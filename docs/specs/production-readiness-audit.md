# Production Readiness Audit

## 1. Task

| | |
|---|---|
| **Name** | Production readiness audit — private beta |
| **Status** | All findings closed except P1 (deferred, reasoned in section 12). B9 withdrawn and replaced by the real defect underneath it, now fixed. |
| **Started** | 2026-09-12 |
| **Last updated** | 2026-09-12 |

Report only. Nothing in `src/` was touched. The fix list is yours to choose.

---

## 2. What you asked for

Your words, kept so they do not get lost to chat scrollback:

- Audit **every parameter** for production readiness. You want to share this with people.
- **UX matters in all aspects.**
- Check **error handling**.
- Check **issues, bugs, errors, etc.**
- Run a **ponytail (over-engineering) audit side by side**.
- Read the code as a **desktop app expert, Electron expert, and tech lead**. A light review is a rejected review.

From the interview:

| Question | Your answer |
|---|---|
| Who are "people"? | **Friends / small private beta**, 5–20 people |
| Report or fixed code? | **Report only**, ranked, you decide |
| How deep to verify? | **Static read + build + tests + smoke**, no live dictation |
| Ponytail placement | **Side by side in one doc, per-finding** |
| Groq API key | **Each friend brings their own free key**, guided in-app and in the README |
| Code signing | **Explain SmartScreen in plain English first** |
| Unverified context `NAMES` fix | **Flag as unverified, do not chase** |
| Ponytail scope | **Nothing is sacred** |
| Anyone else installed it? | **No. Never run on another machine.** |
| Deadline | **None. Fix everything, whatever it takes.** |

---

## 3. Verification performed

Every claim below is either **CONFIRMED** (I ran something and watched it fail or pass) or **BY READING** (traced in the source, not executed). Nothing is guessed.

Real output, this machine, 2026-09-12:

```txt
npm run build          -> exit 0, bundled dist/main.bundle.js (587 KB)
npm test               -> tests 269 | pass 269 | fail 0 | duration 8,928 ms
npm run local:smoke    -> PASS: Electron alive 8s, wrote startup log, painted 3 non-blank dock frames
npm run audit:prod     -> found 0 vulnerabilities
npm run pack           -> exit 0, afterPack removed 32.0 MB of unused GPU files
npm run packaged:smoke -> PASS: startup success log found
```

Two extra probes I wrote for this audit and then deleted:

1. **Electron duplicate-IPC probe** — a 12-line Electron app proving what `ipcMain.handle` does when a channel is registered twice.
2. **Settings reopen reproduction** — the real compiled `dist/settings-window.js` driven against a fake Electron, opening and closing the window three times.

Both outputs are quoted in finding **B1**.

**Not verified:** anything needing a live Groq call or a real dictation. Those findings say so.

---

## 4. The one-page summary

Read this if you read nothing else.

BayanFlow is a **well-built app with an unusually high standard of engineering** — the error taxonomy, the IPC hardening, the clipboard-restore discipline, and the comments explaining *why* each decision was made are better than most shipped commercial desktop software. The test suite is real and it passes. The packaged build starts.

It is **not ready to hand to a friend**, for three reasons, none of which is about code quality:

1. **Settings opens exactly once per app run, then dies silently.** Confirmed by running it. Anyone who closes Settings and later wants to change their hotkey has a dead menu item until they restart.
2. **The only user-facing document describes an app that no longer exists.** `docs/user-quick-start.md` teaches a floating magic icon, a preview screen, a top-of-screen overlay, and press-once-to-record. None of those are real any more.
3. **A new user cannot find out where to get a Groq API key.** There is not one clickable link in the entire app. Not one `<a>` tag, no `shell.openExternal`, and `console.groq.com` is never written on screen. Since your plan is "each friend brings their own key", this is the front door and it has no handle.

Ranked list:

| # | Finding | Severity | Blocks beta? | Effort |
|---|---|---|---|---|
| B1 | Settings window opens once per app run, then fails silently | **Critical** | **Yes** | S |
| B2 | Only user doc describes a UI that no longer exists | **Critical** | **Yes** | M |
| B3 | No way to reach the Groq console from inside the app | **Critical** | **Yes** | S |
| B4 | App dies silently and invisibly if antivirus blocks `uiohook-napi` | High | **Yes** | M |
| B5 | First-run setup checklist pre-ticks 3 of 4 steps the user never did | High | **Yes** | S |
| B6 | "Recording is too large" is replaced by "Transcription failed" | High | No | S |
| B7 | `exportDiagnostics` has no error handling — silent failure | High | No | S |
| B8 | Privacy defaults are on with no first-run disclosure | High | **Yes** | M |
| B9 | Default context model id is unverified; may 404 on every dictation | High | No | S |
| B10 | Rewrite pays for the model call, then refuses the result as too long | Medium | No | S |
| B11 | Dock appears on the monitor with the mouse, not the one you type on | Medium | No | S |
| B12 | Silence auto-stop is hardcoded at 5s and cuts off thinking pauses | Medium | No | S |
| B13 | Three hotkey listeners share one process-wide keyboard hook | Medium | No | M |
| B14 | `recorder:devices` handler never removed — same defect as B1, latent | Medium | No | S |
| B15 | Legacy `whispr-clone` folder name shipping in a released product | Medium | No | S |
| B16 | `rcedit.exe` is taken from a 4-deep transitive dependency | Medium | No | S |
| B17 | Installer in `release/` is 5 days stale | Medium | **Yes** | S |
| B18 | Second-instance `app.quit()` does not stop the rest of startup | Low | No | S |
| B19 | Context metadata can bleed between two fast back-to-back dictations | Low | No | S |
| B20 | Mic-test failure reason is thrown away by a wrong field name | Low | No | S |
| B21 | No LICENSE file | Low | No | S |
| B22 | Plaintext API-key fallback never warns the user | Low | No | S |

Ponytail, ranked by lines you get back:

| # | Over-engineering | Lines saved | Risk of fixing |
|---|---|---|---|
| P1 | `GroqCleanupProvider` and `GroqRewriteProvider` are the same class twice | ~120 | Medium |
| P2 | Manual 45-line tween to animate a 150 ms window resize | ~50 | Low |
| P3 | `hardenWindow` copy-pasted into three files | ~10 | None |
| P4 | `createId` duplicated seven times, byte-identical in five | ~15 | None |
| P5 | `app-logger.ts` is a 10-line module holding one singleton | ~10 | None |

**Total: 22 correctness/UX findings, 5 over-engineering findings. 8 block the beta.**

---

## 5. Findings

Each finding carries: what is wrong, the evidence, the concrete failure a friend will hit, how sure I am, and — where it applies — a **Ponytail** note on whether the fix should shrink the code rather than grow it.

### B1 — Settings opens exactly once per app run, then fails silently

**Severity: Critical. Blocks the beta. CONFIRMED by running it.**

`SettingsWindow.show()` registers nine IPC channels. The `closed` handler removes **eight**. The one it forgets is `debug:last-case`.

Electron throws when a channel is registered twice. I proved that first:

```txt
PROBE RESULT: second handle() THREW -> Attempted to register a second handler for 'debug:last-case'
```

Then I drove the real compiled class through open → close → open → open:

```txt
OPEN #1: ok. handlers registered: 9
AFTER CLOSE: handlers still registered: [ 'debug:last-case' ]
OPEN #2 FAILED -> Attempted to register a second handler for 'debug:last-case'
OPEN #3 FAILED -> Attempted to register a second handler for 'settings:list-microphones'
```

Evidence: [settings-window.ts:87](src/settings-window.ts#L87) registers it, [settings-window.ts:144-153](src/settings-window.ts#L144-L153) forgets to remove it.

**What your friend experiences.** They open Settings, paste their key, close the window. An hour later the hotkey clashes with something, so they click the tray icon. Nothing happens. They click again. Nothing. There is no error, no balloon, no log line — the caller is `void settingsWindow.show()` at [main.ts:497](src/main.ts#L497), so the rejected promise is swallowed whole. The app looks frozen but keeps dictating fine, which makes it *more* confusing, not less. The only escape is quitting and relaunching, and nothing on screen suggests that.

It also gets worse each time. Attempt 3 fails one channel earlier than attempt 2, because attempt 2 leaked three more handlers before it threw. Every failed attempt leaves more orphaned handlers pointing at a window that is `null`.

> **Ponytail.** Do not fix this by adding one `removeHandler("debug:last-case")` line. That patches the symptom and leaves the mechanism — two hand-maintained lists that must be kept in sync by memory — fully intact. B14 is the same defect already sitting in a second file, which is the proof the mechanism is what is broken. The lazy fix is also the root-cause fix: one small helper that remembers the channels it registered and removes exactly that set. Roughly ten lines, both classes use it, and no future handler can drift. That is a **smaller** diff than auditing every channel by hand, and it is the only version that cannot regress.

---

### B2 — The only user-facing document describes an app that does not exist

**Severity: Critical. Blocks the beta. CONFIRMED by reading both files.**

`docs/user-quick-start.md` is the one document written for a user rather than a developer. Almost everything in it is now wrong:

| The doc says | The app actually does |
|---|---|
| "a small BayanFlow icon appears near the right side of the input" | No such icon. `InputAssistWindow` was deleted and replaced by the dock — see the class comment at [overlay-dock.ts:38](src/overlay/overlay-dock.ts#L38) |
| "The overlay appears near the **top** of the active display" | Bottom centre. `dockBounds` anchors bottom-centre |
| "Press the hotkey **once**… press the hotkey again" | Hold to talk, tap to latch — [main.ts:684](src/main.ts#L684) |
| "You will see a **preview** before replacement" | There is no preview. The README says so explicitly: "This is why there is no preview screen" |
| "**Copy-only is the safer default**" | `autoPaste: true` is the default — [config-store.ts:20](src/config-store.ts#L20) |
| "Choose `Speak here` or a rewrite action" | No such menu item exists |
| Nothing about where to get an API key | — |

**What your friend experiences.** They read the guide, then hunt for a floating magic icon that was deleted, wait for a preview screen that will never appear, and conclude the app is broken. A stale guide is worse than no guide: no guide makes them ask you, a wrong guide makes them give up quietly.

The README, by contrast, is **accurate and good**. The fastest honest fix is to delete `user-quick-start.md` and regenerate it from the README's user sections, or delete it outright and ship the README.

> **Ponytail.** Two documents describing the same product, one of them rotting, is duplication with the same failure mode as duplicated code. One document. Delete the other.

---

### B3 — A new user cannot get to the Groq console from inside the app

**Severity: Critical. Blocks the beta. CONFIRMED by grep.**

You chose "each friend brings their own free Groq key, guided properly on the app screen and in the README". The in-app half is not there.

There is **not one clickable link anywhere in the application**. `grep` for `<a `, `href=`, and `openExternal` across `settings.html`, `settings.js`, `settings-window.ts` and `main.ts` returns only the two `<link rel="stylesheet">` tags. The string `console.groq.com` appears exactly twice in the whole repo — once in a code comment about deprecations, once inside the audit file. It is never shown to a user.

What the user actually sees:

- Settings field help: *"Nothing works until this is set. Create one in the Groq console."*
- Home checklist: *"Create one in the Groq console, paste it into Settings, then save."*

Neither says what Groq is, that the account is free, or where the console lives.

**What your friend experiences.** They install it, Settings opens automatically with an empty password box, and the app tells them to visit a console they have never heard of, with no address. Most people will message you. Some will just close it.

This is also the *only* blocking step: [main.ts:551](src/main.ts#L551) refuses to start recording without a key, and correctly so.

The fix is small and has one Electron-specific trap worth naming: `hardenWindow` denies `window.open` and blocks navigation — which is right — so a plain `<a href>` will do nothing. The link has to go through `shell.openExternal` over IPC. That is deliberate hardening working as intended, not a bug, but it means the fix is "add an IPC channel and a button", not "add an anchor tag".

> **Ponytail.** One new IPC channel, one allowlisted URL, one button. Do not build a general "open any URL" bridge — that hands a compromised renderer an outbound channel. Hard-code the one address.

---

### B4 — The app dies silently and invisibly if antivirus blocks the keyboard hook

**Severity: High. Blocks the beta. BY READING — needs a live test on a machine with aggressive AV.**

[hotkey-listener.ts:1](src/hotkey/hotkey-listener.ts#L1) imports `uiohook-napi` at module top level. That native addon installs a low-level Windows keyboard hook (`WH_KEYBOARD_LL`) — the same Windows API a keylogger uses. Consumer antivirus and corporate EDR flag and quarantine exactly this shape of binary, especially in an **unsigned** executable (see the SmartScreen section — unsigned raises every heuristic score).

If that `.node` file cannot load, the import throws while `main.bundle.js` is still being evaluated — before `app.whenReady()`, before the tray exists, before any window. The only thing that catches it is [main.cjs:33](src/main.cjs#L33), which appends `import.main.failed` to `%APPDATA%/BayanFlow/logs/early-startup.log` and sets a non-zero exit code.

`restartHotkeyListeners()` *does* have a try/catch — [main.ts:663](src/main.ts#L663) — but it wraps `.start()`, which is far too late. The module never loaded.

**What your friend experiences.** They double-click BayanFlow. Nothing happens. No window, no tray icon, no error dialog, nothing in Task Manager a few seconds later. They double-click again. Same. There is a log file explaining it perfectly, in a folder they have no reason to know exists, that they cannot reach because the tray menu that opens it never appeared.

With 5–20 friends on 5–20 different Windows configurations, the chance that at least one hits this is not small, and it is the single worst first impression the app can make.

**The fix is not to make the hook optional** — it is the product. The fix is to fail *loudly*: catch the load failure and show a native `dialog.showErrorBox` naming the likely cause and the log path. `dialog.showErrorBox` works on Windows even before `app.whenReady()`, so it functions in exactly this early window.

> **Ponytail.** This is the "never be lazy about error handling that prevents data loss" carve-out — except what is lost here is the whole app. One `try`/`catch` around a dynamic import plus one `showErrorBox`. No retry logic, no fallback hotkey system, no graceful-degradation mode. Tell the user the truth and exit.

---

### B5 — The first-run setup checklist ticks off three steps the user has never done

**Severity: High. Blocks the beta. CONFIRMED by reading the logic.**

[settings.js:587-608](src/renderer/settings.js#L587-L608) builds the Home checklist. Two of the four items compute "done" from a value that is always truthy on a fresh install:

```js
{ done: !localHealth.lastMicError,         title: "Test the microphone" }
{ done: Boolean(config.inputAssistHotkey), title: "Try the rewrite hotkey" }
```

`lastMicError` is `""` on first launch because no test has ever run — so "Test the microphone" renders with a tick. `inputAssistHotkey` always has a default of `Ctrl+Shift+Enter` from [config-store.ts:15](src/config-store.ts#L15), so "Try the rewrite hotkey" is **permanently** ticked and can never be unticked.

"Try the dictation hotkey" uses `hotkeyAvailable`, which is true as soon as the listener registers — so it too is ticked before the user has dictated once.

**What your friend experiences.** On the very first launch they see a four-item checklist with three green ticks and one warning. The obvious reading is "almost done, just add the key". They add the key, all four go green, and they have still never tested their microphone or tried a rewrite. When the first dictation returns silence because their headset is on a different input device, the app has already told them the microphone was fine.

This is the exact failure the checklist exists to prevent, and it is worse than having no checklist, because a checklist is a promise.

The correct signal is "has the user done this", not "is there no evidence they failed". That needs a small amount of persisted first-run state — three booleans in config, or one `completedSteps` array.

> **Ponytail.** Do not build an onboarding state machine. Three booleans in `AppConfig`, set at the point the action actually succeeds (`recorder.mic_test.success`, `dictation.success`, `rewrite.success`). The config store already normalises booleans with `booleanOr`, so each one is a one-line addition.

---

### B6 — "Recording is too large" is silently replaced by "Transcription failed"

**Severity: High. CONFIRMED by tracing both files.**

In `stopRecording`, [main.ts:874](src/main.ts#L874) sets `failureCategory = "transcription"` and *then* calls `assertAudioWithinLimits(audioPath)` at [main.ts:878](src/main.ts#L878). That helper throws a plain `Error("Recording is too large. Try a shorter dictation.")` — [main.ts:1624](src/main.ts#L1624).

The catch normalises it with `normalizeError("transcription", error)`. Inside `getUserMessage` — [errors.ts:93](src/observability/errors.ts#L93) — the "too large" text check only runs for `category === "recorder"`:

```ts
if (category === "recorder" && source?.message.toLowerCase().includes("too large")) {
  return "Recording is too large";
}
```

The error is not a `recorder` error, has no HTTP status, and has no code, so it falls all the way through to the generic `USER_MESSAGES.transcription`.

**What your friend experiences.** They record a long dictation. The dock says **"Transcription failed (transcription-m1x8k2-a9f3d1)"**. It did not fail — it was never sent. They try again, identically, and get the same message. The one piece of information that would let them fix it ("say less") is computed, formatted into a sentence, and thrown away one function later.

Everything else in this file is precise about telling the user what to do next, which is what makes this one stand out.

> **Ponytail.** Do not add a `size` category or thread a new error type through. The smallest correct fix is to set `failureCategory` **after** the size check rather than before it — a one-line move — or attach `code: "audio_too_large"` to the thrown error and add it to the existing code branch, matching how `output_truncated` is already handled two lines above.

---

### B7 — Export Diagnostics has no error handling and fails silently

**Severity: High. CONFIRMED by reading.**

`exportDiagnostics()` — [main.ts:1526](src/main.ts#L1526) — does four `mkdir`/`writeFile` calls and a `shell.showItemInFolder` with **no try/catch anywhere**. It is invoked as `void exportDiagnostics()` from the tray menu at [main.ts:544](src/main.ts#L544).

Compare `exportDebugCase()` fifty lines above, which wraps its write in a try/catch, logs, and calls `showFailure`. The two neighbouring functions doing the same job disagree about whether failure matters.

**What your friend experiences.** Something has gone wrong, so you tell them "open the tray menu and click Export Diagnostics, then send me the folder". They click it. Nothing happens — no folder opens, no message. The write failed because their disk is full, or the log directory is read-only, or their AV locked the folder. The rejection lands in `process.on("unhandledRejection")`, which writes it to the very log file they are trying to send you.

This is the one action in the app whose entire purpose is to work when other things are broken.

> **Ponytail.** Copy the shape of `exportDebugCase` — it is three lines away and already correct. This is ladder rung 2: the pattern is already in this codebase, reuse it rather than inventing another.

---

### B8 — Privacy defaults are on, and nothing tells the user at first run

**Severity: High. Blocks the beta. CONFIRMED by reading.**

Two defaults in [config-store.ts](src/config-store.ts):

- `historyEnabled: true` — every dictation's **raw and polished text** is appended to `%APPDATA%/BayanFlow/history.jsonl` in plain text. Up to 500 entries by 20,000 characters, so roughly 20 MB of everything the user has ever said, unencrypted, readable by any process running as them.
- `contextCaptureEnabled: true` — the **active window title** is sent to Groq on every single dictation, before the user has said a word.

Both are deliberate, both are documented in the source, and the file header in [history-store.ts:1-22](src/history/history-store.ts#L1-L22) is a model of how to document a deliberate exception. The Privacy tab in Settings describes both honestly. Neither is a leak.

The problem is purely **when** the user learns. First launch opens Settings on the General tab with the API key field focused. Nothing surfaces the Privacy tab. A user who never clicks it never discovers that their window titles — *"Re: Q3 layoffs - Outlook"*, *"patient_records.xlsx - Excel"* — leave the machine on every dictation, or that a transcript of everything they dictate sits in AppData.

**What your friend experiences.** Nothing, until the day they notice. Then it is a trust conversation, and you are having it after the fact instead of before. Among friends that is recoverable; it is still the wrong order.

Note the screenshot setting is handled correctly — `contextScreenshotEnabled: false`, opt-in, with a blocklist. The reasoning in the comment ("a window title is a small exposure and a large quality win; the screenshot is the opposite trade") is sound. This finding is about disclosure, not about changing the defaults.

**Cheapest honest fix:** on first run only, show the Privacy tab once, or add two lines to the Home page stating what is on. You do not need a consent modal for five friends. You need them to have been told.

> **Ponytail.** No consent flow, no legal copy, no versioned privacy acceptance. One extra checklist row on Home reading "History and window-title context are on — review Privacy" with a button that switches tabs. The tab-switching code already exists.

---

### B9 — The default context model id is unverified and may be failing on every dictation

**Severity: High. NEEDS A LIVE RUN — I could not verify this without a key.**

The default is `contextModel: "qwen/qwen3.6-27b"` — [config-store.ts:35](src/config-store.ts#L35).

Three things make me want it checked before anyone else installs this:

1. The nearby `qwen/qwen3-32b` is in `RETIRED_MODELS` and remapped to `openai/gpt-oss-120b`. The Qwen family on this provider has already churned once.
2. `RETIRED_MODELS` exists precisely because a dead model id "surfaces to the user as polish and rewrite silently failing" — the file says so. The context default is not in that table and is not covered by it.
3. Your own `CONTINUE-HERE.md` says the context `NAMES` fix "has **never been run**", and the audit log records four consecutive rounds lost to context returning nothing.

If the id is wrong, the failure is invisible by design. `inferActivity` catches everything and returns empty — [context-service.ts:330](src/context/context-service.ts#L330) — so a 404 on every dictation shows up only as a `context.infer.failed` line in the log. Meanwhile every dictation still pays a full network round trip and up to 8 seconds of timeout budget for a call that can never succeed.

**How to check in one minute:** dictate once, then `grep context.infer %APPDATA%/BayanFlow/logs/app.log`. A `status: 404` on `context.infer.failed` settles it.

Per your instruction I am **not** chasing the `NAMES` fix. I am flagging that the model id underneath it was never validated, which is a different and cheaper question.

> **Ponytail.** If it is dead, the fix is one string. Resist adding a model-availability probe at startup — that spends a request on every launch to guard against a problem that a correct default and the existing `RETIRED_MODELS` table already cover.

---

### B10 — Rewrite pays for the model call, then refuses the answer as too long

**Severity: Medium. CONFIRMED by reading.**

In `runRewrite` — [main.ts:1327](src/main.ts#L1327) — the order is:

1. Read the whole input off the clipboard.
2. Send it to the model and wait.
3. **Then** check `if (whole.length > MAX_REWRITE_INPUT_CHARS)` and bail out.

The ceiling is known before step 2 and consulted after it.

**What your friend experiences.** They press the rewrite hotkey in a long document. The dock says "Reading your text", then "Polish...", and spins for several seconds. Then: *"That input is too long to edit safely."* They waited for a call whose result was discarded, and it cost real tokens against their free-tier quota. Doing it twice is entirely rational — nothing suggests the length was the problem until after the wait.

The equivalent check in `replaceInsertedText` — [main.ts:1250](src/main.ts#L1250) — is correctly placed *before* its work. So the codebase already knows the right order in one place and not the other.

> **Ponytail.** Move the existing `if` above the `rewrite(...)` call. No new code, strictly fewer wasted API calls. The block is already written; it is standing in the wrong place.

---

### B11 — The dock appears on the monitor with your mouse, not the one you are typing on

**Severity: Medium. BY READING — needs a two-monitor test to confirm the feel.**

`workAreaForSession()` — [overlay-dock.ts:407](src/overlay/overlay-dock.ts#L407) — picks the display like this:

```ts
const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
```

The comment justifies it: the cursor "is synchronous and reflects the screen the user is working on". For one monitor that is exactly right. For two it is often wrong, because a keyboard-driven app is used with the hands, not the mouse.

**What your friend experiences.** Two screens. They are writing in Slack on the right monitor; the mouse is parked over a browser on the left from ten minutes ago. They hold the hotkey. The listening dock appears on the **left** monitor, in their peripheral vision or entirely outside it. They cannot see whether it heard them, and the Cancel and Finish buttons are on the wrong screen. Text still lands correctly — the paste target is captured separately and properly — so the app works while appearing broken.

The better signal is already captured and thrown away. `captureActiveTarget` reads the **window bounds** of the focused app — [text-inserter.ts:151](src/insertion/text-inserter.ts#L151) — stores them on `PasteTarget.bounds`, and `activePasteTarget` is set at [main.ts:756](src/main.ts#L756) *before* `showListening()` runs. The right monitor is known one line before the wrong one is chosen.

> **Ponytail.** Not a new subsystem. `screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })` when bounds exist, cursor position when they do not. About four lines, and it deletes a wrong assumption rather than adding a feature. Multi-monitor is also the single most likely difference between your machine and your friends'.

---

### B12 — Silence auto-stop is hardcoded at five seconds and cuts people off mid-thought

**Severity: Medium. CONFIRMED by reading; the threshold value itself needs a live test.**

[recorder.js:13-14](src/renderer/recorder.js#L13-L14):

```js
const SILENCE_AUTO_STOP_MS = 5_000;
const VOICE_RMS_THRESHOLD = 0.025;
```

Neither is in `AppConfig`. There is no Settings control for either.

**What your friend experiences.** They tap to latch for a long email, get three sentences out, and pause to think about how to phrase the next bit. Five seconds later recording stops on its own. The dock reports the result of a truncated dictation, and they have to work out what happened — the message says "Stopped after silence", which is honest, but the behaviour is not adjustable.

Five seconds is short for composing prose. It is also the wrong trade for the *latched* mode specifically: the whole point of tapping to latch is a long dictation where pauses are expected. Push-to-talk barely needs the timer, because the user's finger is the timer.

A fixed RMS threshold of 0.025 is a second, quieter version of the same problem — it is a calibration constant tuned on one microphone in one room. A quiet speaker on a far-field laptop mic may sit below it and be treated as silence throughout.

Your own `ux-edge-case-audit.md` already lists this as risk #4. It is still hardcoded.

> **Ponytail.** The honest fix here is *not* the smallest diff. This is the hardware-calibration carve-out: a real microphone in a real room needs a tuning knob a minimal model cannot see. Add the setting. But add **one** — the silence timeout, in seconds, in the Dictation tab — and leave the RMS threshold alone until someone actually reports it. Do not build an adaptive noise-floor estimator.

---

### B13 — Three hotkey listeners share one process-wide keyboard hook

**Severity: Medium. BY READING.**

`uIOhook` from `uiohook-napi` is a **process-wide singleton**. `restartHotkeyListeners()` — [main.ts:637](src/main.ts#L637) — constructs three `HotkeyListener` objects (dictation, rewrite, Esc), and each one defaults its `hook` parameter to that same singleton and tracks its own private `isStarted` flag.

Two consequences:

1. **Every keystroke on the machine fans out to three reducers.** Each listener calls `hook.on("keydown", …)` and `hook.on("keyup", …)`, so a global hook that fires on every key press in Windows now runs three reducer passes per event. Small, but it is on the hottest path in the app and it is paid whether or not the user is dictating.
2. **A settings save briefly tears down the shared hook.** `restartHotkeyListeners()` calls `stop()` on all three old listeners first. The first `stop()` calls the global `hook.stop()`, which stops the hook for the two listeners that have not been rebuilt yet. Three `start()` calls then follow, each guarded only by that instance's own flag. The lifecycle of one shared OS resource is being managed by three objects that cannot see each other.

**What your friend experiences.** Most likely nothing. Possibly: they save Settings and the hotkey does not respond until they save again or restart. This is the kind of defect that shows up once in twenty saves and is nearly impossible to report usefully, which is exactly why it is worth fixing before twenty people are saving settings.

> **Ponytail.** This is genuine over-engineering causing a real risk: three objects for one hook. The lazy version is one listener that owns the singleton and dispatches to the three hotkey definitions — fewer objects, fewer lifecycles, one `start`/`stop` pair, and the fan-out disappears for free. `hotkey-reducer.ts` is already pure and tested, so the logic moves unchanged. Bigger than a one-line fix; still a net deletion.

---

### B14 — `recorder:devices` is never removed either

**Severity: Medium (latent). CONFIRMED by diffing the two lists.**

Comparing every registered channel against every removed one across the whole of `src/`:

```txt
registered but never removed:  debug:last-case, recorder:devices
```

`AudioRecorder.destroy()` — [audio-recorder.ts:325](src/audio/audio-recorder.ts#L325) — removes four of its five channels and forgets `recorder:devices`.

This one is harmless **today**, because `AudioRecorder.init()` is called exactly once at startup and `destroy()` only at `will-quit`. It becomes B1 the moment anyone adds a recorder restart — which is a natural thing to want when a microphone is unplugged.

I am listing it separately because it is the evidence that B1 is not a typo. Two independent files, same omission, same cause: a register list and a remove list kept in sync by hand.

> **Ponytail.** Fixed for free by the B1 helper. If you fix B1 by hand-adding one line, fix this one by hand too — and accept that the third occurrence is already scheduled.

---

### B15 — A legacy `whispr-clone` folder ships in the released product

**Severity: Medium. CONFIRMED.**

The temp audio directory is `path.join(os.tmpdir(), "whispr-clone")` in three places: [audio-recorder.ts:346](src/audio/audio-recorder.ts#L346), [main.ts:1631](src/main.ts#L1631) (`cleanupStaleTempAudio`), and [main.ts:1512](src/main.ts#L1512), where it is written into the exported `diagnostics.json` as `paths.tempAudio`.

**What your friend experiences.** They look in `%TEMP%` — as people do when checking what an unsigned app is writing to disk — and find a folder named after a different product with the word "clone" in it. For a tool they granted microphone access to, on a machine where the installer already showed an "unknown publisher" warning, that reads badly. It is also the first thing in the diagnostics file they might send you.

Nothing is functionally broken. This is a trust detail, and trust is most of what a private beta is testing.

Note the rename needs care: the cleanup sweep at startup only looks in the new folder, so any existing `whispr-clone` files on your machine become permanent orphans. One-line mitigation is to sweep both names for a version.

> **Ponytail.** A single constant, currently written out three times. Fix by extracting it once, not by editing three string literals.

---

### B16 — `rcedit.exe` is pulled from a dependency four levels deep that you do not use

**Severity: Medium. CONFIRMED.**

[after-pack.cjs:34](scripts/after-pack.cjs#L34) resolves:

```js
path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe")
```

`electron-winstaller` is not in your `package.json`. It arrives here:

```txt
bayanflow@0.1.0
`-- electron-builder@26.15.3
  `-- app-builder-lib@26.15.3
    `-- electron-builder-squirrel-windows@26.15.3
      `-- electron-winstaller@5.4.0
```

It is a transitive dependency of the **Squirrel** installer target — which this project does not use; it builds NSIS. It is reachable only because npm flattens `node_modules`, and `package.json` pins `"electron-builder": "^26.0.12"` with a caret, so any future minor is free to restructure that chain.

**What happens when it breaks.** `npm run dist` runs the full build, packages 281 MB, and then fails at `afterPack` with `ENOENT` on a path inside a package nobody declared. The error names `electron-winstaller`, which appears nowhere in your project, so the trail starts cold. `execFileSync` throws and there is no try/catch, so the build dies after doing all the work.

This is also self-inflicted in a fixable way: `signAndEditExecutable: false` is what disables electron-builder's own rcedit step, which is why the manual call exists. The build log says so plainly:

```txt
executable resource editing and code signing skipped - signAndEditExecutable is false.
To skip only code signing while keeping icon and metadata applied, use signExecutable: false instead.
```

electron-builder is telling you the supported option. `signExecutable: false` keeps the icon and version strings and skips only signing — which deletes the entire `rcedit` block.

> **Ponytail.** Rung 4 of the ladder: the platform already does this. Swapping `signAndEditExecutable: false` for `signExecutable: false` removes ~30 lines of `after-pack.cjs`, drops the undeclared dependency, and is the tool's documented path. The GPU-file deletion in the same hook is genuinely worth keeping — it removed a verified 32.0 MB in the build I ran.

---

### B17 — The installer you would send is five days stale

**Severity: Medium. Blocks the beta. CONFIRMED.**

`release/BayanFlow Setup 0.1.0.exe` is dated **Sep 7**. The last five days of commits — configurable base URLs, per-stage timeouts, token-usage logging, the debug panel, the dock focus fix — are not in it. The version string is still `0.1.0`, so a rebuilt installer is indistinguishable from the old one by name.

**What your friend experiences.** They install a build that predates several fixes, hit a bug you already fixed, and report it. You cannot tell from anything they send you which build they are on, because `0.1.0` covers both.

I rebuilt from current `main` during this audit and it packaged and smoke-tested cleanly, so there is no blocker — it just has not been done.

Bump the version before you send anything. `app.getVersion()` is already written into `diagnostics.json`, so the moment the version is real, every bug report tells you which build it came from.

---

### B18 — The second instance keeps running after `app.quit()`

**Severity: Low. BY READING.**

[main.ts:204](src/main.ts#L204):

```ts
if (!app.requestSingleInstanceLock()) {
  writeEarlyStartupDiagnostic("single_instance.already_running");
  app.quit();
}
```

`app.quit()` requests a quit; it does not halt execution. Because this is top-level module code, there is no `return` to take, so the second instance continues on to start the crash reporter and register the `whenReady` chain. In practice Electron usually tears down before `whenReady` resolves, which is why this has never been seen — it is a race that currently resolves the right way.

The `second-instance` handler and `showAlreadyRunningNotice()` are the correct design and work well. This is only about the losing instance not stopping cleanly.

> **Ponytail.** Wrap the remainder in an `else`, or `process.exit()` after the diagnostic. One line either way.

---

### B19 — Context can bleed between two fast back-to-back dictations

**Severity: Low. BY READING.**

`AppContextService.start()` calls `this.cancel()` (setting `cancelled = true`, clearing `metadataOnly`) and then immediately sets `cancelled = false` — [context-service.ts:152-156](src/context/context-service.ts#L152-L156). Meanwhile the previous `capture()` may still be awaiting `getWindowSignals()`. When it resumes it writes `this.metadataOnly` — [context-service.ts:213](src/context/context-service.ts#L213) — with the **old** window's app name and title, over the new session's value.

The `cancelled` guard does not help, because the new `start()` has already cleared it.

**What your friend experiences.** Two dictations within about a second of each other, in different windows. The second one's cleanup prompt gets the first one's window title. The visible effect is a slightly worse polish, not wrong text. Nobody will ever report it.

Worth fixing only because it is cheap and because context correctness is already costing you debugging rounds.

> **Ponytail.** A session token compared before the write — three lines. Do not introduce an `AbortController`; nothing here needs the network call cancelled, only the stale write suppressed.

---

### B20 — The microphone-test failure reason is discarded by a wrong field name

**Severity: Low. CONFIRMED by reading.**

[audio-recorder.ts:331](src/audio/audio-recorder.ts#L331):

```ts
this.resolveTestMic({ ok: false, error: "Recorder was closed." } as TestMicResponse);
```

`TestMicResponse` declares `message`, not `error`. The `as` cast silences the compiler. `resolveTestMic` then rejects with `new Error(response.message || "Microphone test failed.")` — and `message` is `undefined`, so the specific reason is replaced by the generic one.

Tiny, but it is the one place in the file where an `as` cast defeats the type checker and immediately loses information. Everything else in this codebase validates its IPC payloads properly.

> **Ponytail.** Rename the key and delete the cast. The cast is the bug — without it TypeScript would have caught this at build time.

---

### B21 — There is no LICENSE file

**Severity: Low. CONFIRMED.**

No `LICENSE` in the repo. `README.md` says "Private project. Add a license before public release."

Not a blocker for five friends. It matters the moment the repo is public or the installer goes further than you intended, because with no license the default is all-rights-reserved and nobody may legally redistribute it — including the friend who wants to pass it to a colleague.

---

### B22 — Plaintext API-key fallback never tells the user

**Severity: Low. CONFIRMED by reading.**

`encryptApiKey` returns `""` when `safeStorage.isEncryptionAvailable()` is false — [config-store.ts:183](src/config-store.ts#L183). `save()` then writes the raw key into `config.json` and logs `apiKeyStorage: "plaintext_fallback"` — [config-store.ts:134](src/config-store.ts#L134). The user is never told.

On Windows `safeStorage` is DPAPI-backed and effectively always available, so this is a corner. But the corner is silent, and the fallback is exactly the case where the user would want to know.

The design is otherwise good: encrypted-first, prefix-versioned (`safeStorage:v1:`), graceful on a corrupt blob, `GROQ_API_KEY` env fallback, and — importantly — [settings-window.ts:52](src/settings-window.ts#L52) blanks the key before it ever crosses IPC to the renderer, so it never reaches a web page. That last one is a detail a lot of Electron apps get wrong.

> **Ponytail.** One row in the existing Home health table: "Key storage: Encrypted / **Plaintext**". The table is already built and already reads from `health`.

---

## 6. Cold-machine install — the risk you have never tested

You confirmed nobody but you has ever installed BayanFlow. This section is what changes between your machine and theirs.

**Verified good — I checked these, they are not risks:**

| Risk | Result |
|---|---|
| Visual C++ Redistributable needed? | **No.** I read the PE import tables of both native addons. `libnut.node` imports only `gdi32/kernel32/user32` (plus the N-API host). `uiohook-napi.node` imports only `advapi32/kernel32/user32`. No `vcruntime140.dll`, no `msvcp140.dll`. Nothing for your friends to install. |
| Do the native binaries survive packaging? | **Yes.** Both land in `app.asar.unpacked`, where `node-gyp-build` and `bindings` can find them as real files on disk. The `asarUnpack` config is correct. |
| Does the packaged app start? | **Yes.** `npm run packaged:smoke` passed against a build I made during this audit, with a clean `BAYANFLOW_USER_DATA_DIR`. |
| Production dependency vulnerabilities? | **None.** `npm audit --omit=dev` reports 0. |
| Does the dock actually paint pixels? | **Yes.** `local:smoke` asserts non-blank frames by counting opaque pixels — a genuinely good check most projects do not have. |

**Untested and still live:**

| Risk | Why your machine cannot tell you | Finding |
|---|---|---|
| Antivirus quarantines the keyboard hook | Yours is trained on this binary; theirs is not | **B4** |
| Two or more monitors | Dock follows the mouse, not the keyboard | **B11** |
| Display scaling other than 100% | The dock is measured by the renderer in CSS pixels and applied as screen pixels via `setBounds`. At 150% scaling it may come out under-sized. Noticed, not proven. | — |
| Windows "Let desktop apps access your microphone" is off | `getUserMedia` rejects and the message does reach the user, so this one is probably handled | — |
| A different default microphone | `openMicrophone` falls back correctly on `NotFoundError`; the checklist wrongly claims the mic was tested | **B5** |
| SmartScreen on a machine with no reputation | Yours has run this exe hundreds of times | Section 7 |

**Test recommendation.** Before sending anything, install the fresh build on one machine that is not yours — ideally a friend's, over a call — and watch them do it. One session will surface more than another week of reading. Watch specifically for: the SmartScreen click-through, whether the app appears at all (B4), and whether they find the Groq console unaided (B3).

---

## 7. SmartScreen, in plain English

You asked what this means. Here it is with no jargon.

**What is happening.** Windows checks every downloaded program against a Microsoft reputation service. Two things build reputation: a **code-signing certificate** — a paid identity document for software, proving "this came from a specific real company" — and **download volume**, meaning thousands of people installing it without incident. Your installer has neither. It is unsigned, and it has been downloaded by one person: you.

**What your friend actually sees.** A full-window blue box: *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognised app from starting."* The only visible button is **Don't run**. To continue they must click the small **More info** text, which then reveals a **Run anyway** button. Most people do not find that link. Many who do find it decide not to click it, and they are behaving sensibly.

**Why it matters more here than for most apps.** BayanFlow asks for microphone access and installs a global keyboard hook. An unsigned app that listens to your keyboard and your microphone is, from Windows' point of view, indistinguishable in shape from spyware. This also feeds **B4** — unsigned raises the heuristic score that makes antivirus quarantine the hook in the first place.

**Your options, with real costs:**

| Option | Cost | What it fixes |
|---|---|---|
| **Do nothing, tell them the two clicks** | Free | Nothing technically, but for 5–20 friends who already trust you, this is genuinely fine. Send a screenshot of the dialog with the "More info → Run anyway" path circled, *before* they download. |
| **Azure Trusted Signing** | ~$10/month | Microsoft's own service, no hardware token. Removes "unknown publisher" straight away. Requires a verifiable identity — an individual developer needs several years of verifiable history, a business needs registration documents. This is the modern default. |
| **OV certificate** (Sectigo, DigiCert) | ~$200–400/year | Signs the exe, but SmartScreen reputation still accrues over time, so early users may still see a warning. |
| **EV certificate** | ~$300–600/year plus a hardware token | Instant SmartScreen reputation. Overkill unless you are going commercial. |
| **Ship a portable zip instead of an installer** | Free | Sidesteps the installer warning, but Windows still flags the exe on first run. Not really a fix. |

**My recommendation for where you are:** do nothing about signing. Write four lines in the message you send with the installer — what the warning looks like, why it appears, and the exact clicks — and treat that as part of shipping. Revisit Azure Trusted Signing if this goes beyond people who know you personally. Spending $200 to save twelve friends two clicks is the wrong trade.

What is **not** optional is telling them in advance. A friend who hits an unexplained "Windows protected your PC" screen on software you sent them has a worse moment than one who was warned.

---

## 8. Ponytail audit — over-engineering, ranked

Nothing was treated as sacred, per your instruction. Two things I expected to flag turned out to be earned, and I say so at the end.

### P1 — `GroqCleanupProvider` and `GroqRewriteProvider` are the same class written twice

**~120 lines. Medium risk.** [groq-cleanup-provider.ts](src/cleanup/groq-cleanup-provider.ts) (160 lines) and [groq-rewrite-provider.ts](src/rewrite/groq-rewrite-provider.ts) (179 lines).

Same four private fields — `client`, `model`, `fallbackModel`, `cooldown`. Same constructor signature. Same two-method shape: a public method that calls `withModelFallback`, wrapping a private `…WithModel`. Each carries its own `estimate…OutputTokens` helper and its own byte-identical `createRequestId`.

They differ in prompt-building and in nothing else. One class taking a prompt builder collapses both.

**Why this is medium risk, not low.** These two are the money path. They both feed `ModelCooldownManager`, which is shared deliberately because rate limits are enforced per account. Merging them touches the rate-limit and fallback logic that took real debugging to get right, and the tests cover the two classes separately. Worth doing, worth doing carefully, and worth doing **after** the beta blockers.

### P2 — A 45-line hand-written tween to animate a 150 ms window resize

**~50 lines. Low risk.** [overlay-dock.ts:376-421](src/overlay/overlay-dock.ts#L376-L421).

A `setInterval` at 16 ms, cubic easing, a manual `setBounds` every frame, plus `tweenTimer` state and a `stopTween()` method threaded through `hide()`, `destroy()` and `applyBounds()`.

The comment correctly notes that Electron's `setBounds` animate flag is macOS-only. The question the comment never asks is whether the animation should exist at all.

**The codebase already answered it.** Commit `a0e13e4` — *"stop the idle pill's hover resize disturbing focus"* — disabled the tween for the idle view because roughly twenty-two `setBounds` calls on an always-on-top window were **disturbing the focus of the app the user is typing into**. That is the one thing this window must never do. The animation was removed from the only view where it fired often, and the machinery was kept for the views where it fires once.

So: 50 lines of state and timers to ease a 150 ms resize the user is not looking at, on a window that has already caused one focus bug through exactly this mechanism. Delete the tween, keep `applyBounds` as a single `setBounds`, and let CSS animate the contents — which it already does.

### P3 — `hardenWindow` copy-pasted into three files

**~10 lines. Zero risk.**

Byte-identical at [audio-recorder.ts:398](src/audio/audio-recorder.ts#L398), [overlay-dock.ts:472](src/overlay/overlay-dock.ts#L472), and [settings-window.ts:168](src/settings-window.ts#L168).

This is a **security** helper — it denies `window.open` and blocks navigation. Three copies means the next hardening step (a `will-attach-webview` deny, a permission handler) gets added to one file and silently missed in the other two. The current copies happen to agree; nothing keeps them agreeing.

It also lives in the wrong place. Two of the three windows get their copy of the logic from a module about **audio recording**.

One `src/electron-window.ts` exporting `hardenWindow`. Ladder rung 2, and the most obviously correct fix in this document.

### P4 — `createId` written out seven times

**~15 lines. Zero risk.**

```txt
src/audio/audio-recorder.ts:395
src/cleanup/groq-cleanup-provider.ts:159
src/history/history-store.ts:114        (h_ prefix, underscores)
src/main.ts:1675
src/observability/errors.ts:253         (createErrorId)
src/rewrite/groq-rewrite-provider.ts:178
src/transcription/groq-transcription-service.ts:349
```

Five are byte-identical. Two are the same idea with different separators. One shared helper; the two variants pass their own prefix and separator.

### P5 — `app-logger.ts` is a 10-line module holding one singleton

**~10 lines. Zero risk.** [app-logger.ts](src/observability/app-logger.ts).

The entire file is `export const logger = new Logger()` plus a three-line `configureLogger`. It imports from `logger.js` and nothing else. It exists only to hold a module-level instance — which is what the bottom of `logger.ts` is for. One import fewer in each of the roughly twenty files that use it.

Small, but it is the shape that makes people think a layer exists when it does not.

### Deliberately NOT flagged — these earned their complexity

I went in expecting to cut these and could not justify it:

- **`src/llm/` — 5 files, 647 lines.** Every one traces to a documented production bug. `completion-budget.ts` exists because a reasoning model spent 5,106 characters thinking and returned nothing. `rate-limit-headers.ts` turns a dead end into "try again in 4 minutes". `model-cooldown.ts` is shared across providers because limits are per account. `client-options.ts` exists because four modules each baked in their own timeout and endpoint. This is the opposite of speculative — it is scar tissue, and every scar has a date in the audit log.
- **`src/observability/errors.ts` — 272 lines.** Long, and every branch earns its place: 404 means a retired model and says so, 429 passes the provider's own wait time through, offline is separated from provider-down because they produce identical sockets, and rate limits are excluded from retry with a comment explaining why retrying makes it worse. This is better error handling than most commercial desktop software.
- **`interface CleanupProvider` with one implementation.** Normally a rung-1 violation. Here it is the test seam that `dictation-pipeline` injects through, and the pipeline tests use it. Justified.
- **`debug/case-export.ts` and the debug panel.** For a private beta this is how you diagnose a friend's bad dictation without sitting at their desk. Keep it. It did cause **B1**, but that is the handler bookkeeping, not the feature.
- **The `ponytail:` comments already in the code.** [history-store.ts:191](src/history/history-store.ts#L191) and [hotkey-reducer.ts:50](src/hotkey/hotkey-reducer.ts#L50) each name a real ceiling and its upgrade path. Exactly right.

---

## 9. What is already good — do not regress these

Stated plainly, because a list of 27 problems gives a false impression of the whole.

- **Electron security is genuinely correct.** All three windows use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Strict CSP with no `unsafe-inline`, enforced by a **test** that fails if anyone adds an inline `<script>` or `<style>`. Every preload exposes a narrow, named surface with no `ipcRenderer` leak. Every IPC handler calls `assertSender` and checks the webContents id. Payloads are validated, not trusted. Most Electron apps fail at least two of these.
- **The API key never reaches a renderer.** `settings:load` and `settings:save` both blank it before returning. A compromised renderer cannot read it.
- **Log redaction is real and tested.** `sanitize()` strips transcript fields; `sanitizeErrorMessage` regexes out `gsk_`/`sk-`/bearer tokens; the diagnostics export re-sanitises on the way out; vocabulary is logged as a **count**, never as terms; and the context blocklist deliberately logs nothing about which pattern matched, so the log cannot leak what it was protecting.
- **Clipboard handling is careful in a way that is easy to get wrong.** Sentinel-based capture to distinguish "empty selection" from "copy failed"; restore-if-unchanged rather than blind restore; retry on write; and on any failure the text is left on the clipboard so nothing is ever lost.
- **The modifier-release wait.** Waiting for the user's fingers to come off Ctrl+Shift before sending Ctrl+V, with a 600 ms ceiling and a documented rationale, routed through **one** function so select-all and copy get it too. This is the kind of bug most apps ship forever.
- **Redo does not trust Ctrl+Z.** It reads the input back and splices, and refuses rather than guessing when the previous text is gone. The comment explains that the undo approach was tried and found unverifiable.
- **`local:smoke` asserts painted pixels.** Counting opaque pixels to prove the dock is not blank — because a clipped window still reports `visible: true` with correct bounds — is a better check than most teams write.
- **The comments explain *why*, with measurements.** "18-23 ms warm against 1,646 ms cold." "Presses ran 128 ms to 1,365 ms with no clean gap, so no threshold works." "`low` burned 5,106 characters thinking." This is the single most valuable thing in the codebase, and it is why this audit could be specific instead of vague.
- **269 tests, passing, testing real behaviour** — races, security invariants, precedence rules — not getters.

---

## 10. Suggested fix order

**Before anyone else installs it — the beta gate:**

1. **B1** — Settings reopen. Fix the mechanism, not the line. Takes B14 with it.
2. **B3** — A button that opens `console.groq.com` via `shell.openExternal`, plus one sentence saying the account is free.
3. **B2** — Delete or rewrite `user-quick-start.md`.
4. **B5** — Make the checklist tell the truth.
5. **B4** — Catch the native-module load failure and show a real dialog.
6. **B8** — One line on Home about history and context being on.
7. **B17** — Bump the version, rebuild, and write the SmartScreen note into the message you send.

**First week of the beta:**

8. **B9** — Verify the context model id against the log. One dictation.
9. **B6, B7, B10, B20** — Four small, self-contained error-handling fixes.
10. **B11** — Use the window bounds you already capture. Most likely difference between your machine and theirs.
11. **B12** — Make the silence timeout a setting.

**When the beta is stable:**

12. **P3, P4, P5** — Zero-risk deletions, roughly 35 lines.
13. **P2** — Delete the tween.
14. **B16** — `signExecutable: false`, delete the rcedit block.
15. **B13** — One hotkey listener owning one hook.
16. **B15, B18, B19, B21, B22** — Cleanup.
17. **P1** — Merge the two providers. Last, because it is the money path.

**Deliberately not scheduled:** code signing, and the deferred state-machine refactor (task 11 in `capability-audit.md`), for which this audit found no new reason to bring it forward.

---

## 11. Explanation

### What changed

No source code. This audit file was added and `docs/specs/README.md` gained one row. The audit records 22 correctness and UX findings and 5 over-engineering findings across `src/` (13,156 lines), `scripts/`, the packaging config, and the user documentation.

### Why it was needed

BayanFlow has never run on a machine other than the author's, and the plan is to hand it to 5–20 friends. The existing `capability-audit.md` covers output quality and reliability in depth, but it was written from the inside, for the person who built it. This pass asks a different question: what happens to somebody who has never seen the app, on hardware nobody has tested, with no one to ask.

### How the audit was done, step by step

1. **Interview first.** Twelve questions in three rounds, before reading anything, so the audit optimised for the right bar. "Private beta" and "nobody has installed it" changed what counts as critical: an unsigned installer became a note, while a stale user guide became a blocker.
2. **Verify before reading.** `build`, `test`, `local:smoke`, `audit:prod` — so every later claim sits on a known-good baseline. All four passed.
3. **Read the main process end to end.** All 1,723 lines of `main.ts`, then each subsystem, tracing real call paths rather than sampling.
4. **Trace the security boundary specifically.** Every `webPreferences`, every preload, every `ipcMain.handle`, every `assertSender`. This is where B1 came from — a mechanical diff of registered channels against removed channels across the whole repo.
5. **Prove the important finding twice.** A minimal Electron probe established that a duplicate `ipcMain.handle` throws. Then the real compiled `dist/settings-window.js` was driven through open/close/open against a fake Electron, reproducing the exact failure sequence.
6. **Test the cold-machine story with real builds.** `npm run pack` produced a fresh 281 MB unpacked app; `packaged:smoke` passed; the PE import tables of both native addons were read directly to settle the Visual C++ Redistributable question.
7. **Run the ponytail lens on the same pass**, so each finding could say whether the fix should add or remove code — which changed the recommendation in several places. B1, B10 and B16 are all net deletions.

### Files and functions examined

- `src/main.ts` (all 1,723 lines) — startup, tray, hotkeys, dictation, redo, rewrite, providers, diagnostics, temp files
- `src/settings-window.ts` — **B1 found here**
- `src/audio/audio-recorder.ts` and `src/renderer/recorder.js` — **B12, B14, B20**
- `src/insertion/text-inserter.ts` — clipboard and window targeting; no defects found
- `src/observability/errors.ts` — **B6**
- `src/config-store.ts` — **B8, B9, B22**
- `src/history/history-store.ts` — **B8**
- `src/context/context-service.ts` — **B19**
- `src/overlay/overlay-dock.ts` — **B11, P2**
- `src/hotkey/hotkey-listener.ts` — **B4, B13**
- `src/renderer/settings.js` and `settings.html` — **B3, B5**
- `scripts/after-pack.cjs`, `scripts/bundle-main.mjs`, the `build` block of `package.json` — **B16**
- `docs/user-quick-start.md`, `README.md` — **B2**

### Important decisions

- **Report only, no code changed.** Your call, and it keeps the audit honest — nothing here is a defence of a fix I had already made.
- **Every finding is labelled CONFIRMED or BY READING.** You said a light review is a rejected review; the opposite failure is a confident review that is wrong. Nine findings are proven by running something. The rest say plainly what would prove them.
- **The ponytail lens sits inside each finding, not in a separate report.** It changed the recommendation in B1 (fix the mechanism, not the line), B10 (move the check, add nothing), B14 (free if B1 is done properly), and B16 (delete 30 lines by using a supported flag).
- **Two expected ponytail findings were withdrawn** after reading the history. `src/llm/` and `errors.ts` look over-built until you trace each branch to a dated bug. Calling scar tissue "bloat" would have been the wrong kind of lazy.
- **B12 is the one place I recommend more code, not less.** A real microphone in a real room needs a calibration knob. That is the explicit carve-out from the laziness rule.
- **Code signing was not recommended.** $200 or more to save twelve friends two clicks is the wrong trade. A four-line warning in the message you send is the right one.

### Tests and verification

Everything reported in section 3 is real output from this machine on 2026-09-12. `build`, `test` (269/269), `local:smoke`, `audit:prod` (0 vulnerabilities), `pack`, and `packaged:smoke` all passed. Two throwaway probes, quoted in B1, were written and then deleted; `git status` is clean.

**Not run:** the app was never launched interactively, no dictation was performed, and no Groq API call was made. Findings that depend on live behaviour — B4 (antivirus), B9 (model id), B11 (two monitors), B12 (threshold) — say so.

### Edge cases and limitations of this audit

- **No live run means no live UX judgement.** How the dock *feels*, whether 150 ms reads as instant, whether the polish quality is good — none of that is testable here.
- **B9 cannot be settled without a key.** One dictation and one `grep` of the log resolves it.
- **DPI scaling was noticed but not investigated.** The dock measures in CSS pixels and positions in screen pixels; at 125% or 150% it may come out under-sized. Flagged, not proven.
- **Prompt quality was not audited.** Whether the cleanup and rewrite prompts produce good text is a product question needing real dictations, not a code question.
- **The deferred state-machine refactor was not re-examined.** No new reason to bring it forward appeared; the dictation state flags in `main.ts` are managed consistently across all exit paths, including `finally` blocks.
- **This audit found nothing wrong with the clipboard, paste-targeting, or error-taxonomy layers**, which are the three places a tool like this usually breaks. That is a real result, not an omission.

---

## 12. Updates

Append-only. Newest entry at the bottom.

### 2026-09-12 — audit delivered

22 correctness/UX findings and 5 over-engineering findings, 8 blocking a private beta. Report only, no
code changed. Sections 1–11 above are that report, unedited.

### 2026-09-12 — all 27 findings fixed

You asked for everything fixed and left the order to me. Waves ran bug-fixes-first, deletions-last, on
the principle that refactoring before fixing means fixing bugs in code you are about to delete, and a
failure after a combined change cannot be attributed. Tests were green between every wave.

**One new defect was found during the work and is recorded below as B23.**

| # | Status | What was done |
|---|---|---|
| B1 | **Fixed** | New `src/ipc-handler-set.ts`. One list instead of two hand-maintained ones, so removal cannot fall behind registration. Both `SettingsWindow` and `AudioRecorder` use it. |
| B2 | **Fixed** | `docs/user-quick-start.md` rewritten from scratch against the app that exists. Rewritten rather than deleted: friends need a user-shaped doc, and the README is developer-shaped. |
| B3 | **Fixed** | `app:open-groq-console` IPC → `shell.openExternal("https://console.groq.com/keys")`. Buttons on the Settings connection card and the Home setup notice. One hard-coded URL, not an open-any-URL bridge. |
| B4 | **Fixed** | `src/main.cjs` now catches the early import failure and shows `dialog.showErrorBox`, naming antivirus quarantine of the keyboard hook as the likely cause and pointing at the log, then exits. |
| B5 | **Fixed** | Three new config booleans — `didTestMicrophone`, `didDictate`, `didRewrite` — written by the main process only on real success. The checklist reads facts instead of inferring from the absence of failure. |
| B6 | **Fixed** | `failureCategory` is set *after* `assertAudioWithinLimits`, so "Recording is too large. Try a shorter dictation." survives instead of becoming "Transcription failed". A one-line move. |
| B7 | **Fixed** | `exportDiagnosticsSafely()` wraps the export, matching the shape `exportDebugCase` already used three lines away. |
| B8 | **Fixed** | A fifth Home checklist row states plainly that history is saving locally and window-title context is being sent to Groq, with a pointer to the Privacy tab. No consent modal. |
| B9 | **OPEN — needs you** | Cannot be settled without a key. See "What is still open" below. |
| B10 | **Fixed** | The `MAX_REWRITE_INPUT_CHARS` check moved above the model call. The block was already written; it was standing in the wrong place. |
| B11 | **Fixed** | `OverlayDock.setAnchorWindow()`. The dock picks its display from the centre of the focused window's bounds — already captured on `PasteTarget` — and falls back to the pointer only when there are none. |
| B12 | **Fixed** | `silenceStopSeconds` added to config, clamped to 2–30, default 5, plumbed to the recorder over IPC and exposed in Settings → Dictation → Recording. The RMS threshold stays hardcoded until someone reports it. |
| B13 | **Fixed** | `HotkeyListener` became `HotkeyWatcher`: one object owns the one process-wide hook and watches all three hotkeys. `setBindings` swaps hotkeys without stopping the hook, closing the settings-save window where nothing was listening. Keystroke fan-out drops from three reducer passes to one. |
| B14 | **Fixed** | Free, via B1. `recorder:devices` is now removed with everything else. |
| B15 | **Fixed** | `TEMP_AUDIO_DIR_NAME = "bayanflow"`, one constant instead of three literals. Startup also sweeps the old `whispr-clone` folder so upgraders do not keep orphaned audio. |
| B16 | **Fixed** | `signAndEditExecutable: false` → `signExecutable: false`, the option electron-builder's own log recommended. Deleted ~30 lines of `after-pack.cjs` and the undeclared 4-deep `electron-winstaller` dependency. |
| B17 | **Fixed** | Version bumped to **0.2.0** and repackaged from current `main`. |
| B18 | **Fixed** | `app.exit(0)` instead of `app.quit()` for the losing second instance, which cannot fall through into the startup chain. |
| B19 | **Fixed** | A generation counter guards every write to the shared `metadataOnly` slot, so a slow capture cannot overwrite the next dictation's context. |
| B20 | **Fixed** | `message` instead of `error`, and the `as TestMicResponse` cast deleted. The cast was the bug — without it the compiler would have caught this. |
| B21 | **Fixed** | `LICENSE` added: proprietary, all rights reserved, with third-party components noted. Swap it whenever you want something else. |
| B22 | **Fixed** | A "Key storage" row on the Home health table reads "Encrypted on this PC" or "Plain text — this PC cannot encrypt it". |
| P1 | **Deferred, deliberately** | See below. |
| P2 | **Fixed** | The 45-line manual tween is gone. `applyBounds` is one `setBounds`. The guard test was tightened rather than relaxed: exactly one `setBounds` in the file, inside `applyBounds`, and no `setInterval`. |
| P3 | **Fixed** | Three byte-identical `hardenWindow` copies replaced by one `src/electron-window.ts`. |
| P4 | **Fixed** | Seven `createId` copies replaced by `createPrefixedId` in `src/ids.ts` — deliberately dependency-free, because `errors.ts` is unit-tested with no Electron loaded. |
| P5 | **Fixed** | `app-logger.ts` deleted; its singleton and `configureLogger` moved to the bottom of `logger.ts`. 16 files repointed. |

#### B23 — Esc has never cancelled a recording. Found while fixing B13, now fixed.

Writing the `HotkeyWatcher` tests surfaced a real defect that predates this work and is identical in
`HEAD`:

- `uiohook-napi` reports keycode `1` and the name table resolves it to **`"ESCAPE"`**.
- `toUiohookHotkey("Esc")` produces the key **`"ESC"`**.
- `matchesGlobalKey` had aliases for Ctrl, Shift, Alt and Command — and none for Escape.

So the Esc binding matched nothing, on every keypress, forever. Verified directly:

```txt
keycode 1 resolves to name: "ESCAPE"
parsed key   : "ESC"
matches ESCAPE? false
```

This was promised in three places — the README, the quick-start guide, and the dock's own
"Release to finish · Esc cancels" hint — and delivered in none.

Fixed at `matchesGlobalKey`, which is the one function every caller routes through, with a regression
test asserting both spellings match and that the alias did not turn Esc into a wildcard.

This is the second defect in this codebase whose root cause was two names that had to agree by hand,
after B1's two handler lists. Worth watching for as a pattern.

#### P1 — why the two providers were not merged

`GroqCleanupProvider` and `GroqRewriteProvider` really are the same class twice, and merging them is
still the right call eventually. It was deliberately left undone:

- They are the money path. Both feed the shared `ModelCooldownManager`, and rate-limit and
  fallback behaviour took real debugging to get right.
- The tests cover the two classes separately, so a merge means rewriting the tests that would catch a
  merge going wrong — the worst possible order.
- It is the only item on the list with no user-visible symptom whatsoever.

Everything above it is now fixed and green, which is exactly the state that makes this safe to do next.
It should be its own change with its own review, not the tail of a 27-item batch.

#### Verification

Every command below was run after the final change, on 2026-09-12:

```txt
npm run build          -> exit 0, bundled dist/main.bundle.js (588 KB)
npm test               -> tests 279 | pass 279 | fail 0
npm run local:smoke    -> PASS: alive 8s, startup log written, 3 non-blank dock frames
npm run audit:prod     -> found 0 vulnerabilities
npm run pack           -> exit 0, afterPack removed 32.0 MB, "file signing skipped via signExecutable"
npm run packaged:smoke -> PASS: startup success log found
```

Tests went from **269 to 279**. The ten new ones are not padding; each pins a defect fixed here:

- Settings opens → closes → opens → opens again (B1), and the handler set re-registers cleanly (B14).
- Silence timeout clamping across junk, zero, too-small, too-large and fractional input (B12).
- Onboarding flags default to not-done and survive a round trip (B5).
- One hook drives three hotkeys with one handler pair; swapping bindings never stops the hook;
  `start()` is idempotent; a bare hotkey adds no modifiers to the paste guard; an unparseable binding
  is dropped without taking the others down (B13).
- Esc matches the keycode uiohook actually reports, and is not a wildcard (B23).

The dock geometry guard test was **tightened**, not relaxed, when the tween was deleted.

B16 was verified beyond "it builds". The packaged exe was inspected:

```txt
ProductName      : BayanFlow
FileDescription  : BayanFlow
CompanyName      : BayanFlow
FileVersion      : 0.2.0
ProductVersion   : 0.2.0.0
InternalName     : BayanFlow
LegalTrademarks  : BayanFlow
icon payload probe found in exe: true
```

This is strictly better than before: the old manual `rcedit` call set the version *strings* but never
`FileVersion`/`ProductVersion`, which were empty. Bug reports can now identify the build. The one
regression is a cosmetic empty `OriginalFilename`, which is not worth a dependency to set.

#### What is still open

- **B9 — the context model id.** `contextModel` defaults to `qwen/qwen3.6-27b` and I could not verify
  it without a key. If it is wrong, every dictation makes a network call that can never succeed, and
  the failure is invisible by design. **Dictate once, then run
  `grep context.infer %APPDATA%/BayanFlow/logs/app.log`.** A `status: 404` on `context.infer.failed`
  settles it, and the fix is one string.
- **P1 — merging the two Groq providers.** Reasoned above.
- **Not launched interactively.** No dictation was performed and no Groq call was made in this work.
  Everything here is verified by the build, 279 unit tests, both smoke runs and the packaged binary —
  which is a real bar, but it is not the same as using the app. B11 (two monitors) and B12 (the RMS
  threshold) in particular want a human at a keyboard.
- **Code signing.** Still not recommended at 5–20 friends. Send the SmartScreen instructions with the
  installer instead; section 7 has the wording and the costs.

### 2026-09-12 — B9 closed from the log, and the real bug was underneath it

You dictated and I read `%APPDATA%/BayanFlow/logs/app.log`. **The audit's guess was wrong, and the
evidence says something more useful.**

`contextModel: "qwen/qwen3.6-27b"` is a **valid, working model id**. 43 `context.infer.success` entries,
with real `visibleNameCount` values of 2 to 7 and real token usage. No 404 anywhere. Finding B9 as
written — "the model id may be retired" — is **withdrawn**.

But 16 of those 59 captures failed, all with the same error:

```txt
429 Request too large for model `qwen/qwen3.6-27b` ... on output tokens per minute (OTPM):
Limit 1000, Requested 1079. The request's expected output tokens exceed the enforced limit;
reduce max_tokens (or the request's expected output) and try again.
```

That is **a 27% failure rate on context capture**, and it is not a quota that ran out. Groq rejects a
request whose *declared* `max_completion_tokens` exceeds the per-minute output allowance, before the
model runs at all.

**Root cause.** `estimateOutputTokens` added reasoning headroom regardless of whether reasoning was
actually requested. The context call is the one place in the app that explicitly disables reasoning —
`reasoning_effort: "none"`, added deliberately after `"low"` burned 5,106 characters thinking — and the
budget still reserved 840 tokens for the thinking that had just been switched off:

```txt
inputTokens                    : 36
reasoningHeadroom              : 840   <- reserved for thinking that is switched OFF
extraTokens                    : 200
=> max_completion_tokens sent  : 1076
   Groq free-tier OTPM limit   : 1000
   tokens actually used        : ~63
```

A 17x over-reservation, large enough on its own to exceed the free tier's entire per-minute output
allowance. The successful calls were no better off: each one reserved 1,076 of the 1,000-token minute,
taking headroom away from the cleanup call that actually matters.

**Fix.** `estimateOutputTokens` takes the reasoning effort as an argument and reserves headroom only
when reasoning will really happen. `context-service.ts` now passes one shared
`CONTEXT_REASONING_EFFORT` constant to both the budget and the request, so the ceiling it declares and
the work it asks for cannot drift apart again — which is precisely how this happened.

Cleanup and rewrite are untouched: they do reason, and shrinking their ceiling is what previously cut
replies off mid-sentence. Only an explicit `"none"` opts out. Three tests pin all of it.

**Not verified by me:** that the 429s actually stop. That needs you to dictate again on the new build
and confirm `context.infer.failed` no longer appears. The arithmetic and the tests say the declared
ceiling is now comfortably under the limit; the live confirmation is one dictation away.

**A note on the pattern.** This is the third defect in this codebase caused by two things that had to
agree by hand — after B1's two handler lists and B23's two spellings of Escape. Here it was a requested
effort and a budgeted effort. Each fix collapsed the pair into one source of truth.

#### Verification after this change

```txt
npm run build       -> exit 0 (588 KB)
npm test            -> tests 282 | pass 282 | fail 0
npm run local:smoke -> PASS
```

Tests went 279 → 282.

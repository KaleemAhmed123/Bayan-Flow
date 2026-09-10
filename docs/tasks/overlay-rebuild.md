# Overlay Rebuild

## 1. Task

- **Name:** Overlay rebuild — one bottom dock replaces the status pill and the Input Assist panel.
- **Status:** shipped
- **Started:** 2026-09-05
- **Last updated:** 2026-09-05

## 2. What you asked for

Your words, kept as constraints:

- "I want entire control on speech to paste with the polish thing as quick as possible."
- "Few quick and good prompts in layers."
- "Remove confirm just paste, users can generate a new one if not satisfied."
- "Clear icons visible so user can click and use easily with best UX."
- Act as a desktop application engineer and UI/UX expert; audit first, then rebuild.
- Failure report from previous attempts: "the polish text screen was coming on bottom right 50% or
  something and rest hidden on right side, and for the first time it comes then next time on center;
  also polish time pasting issues, not clear error visibility."
- Daily apps: VS Code, Brave, WhatsApp, Notion, terminal.

## 3. Open questions

All 16 were answered during the interview. Recorded here so nothing is lost to chat scrollback.

| # | Question | Recommendation | Your answer |
|---|---|---|---|
| 1 | One overlay surface or two windows? | One | **One surface, one window** |
| 2 | Where does the recording indicator live? | Fixed bottom-center | **Fixed bottom-center, never moves** |
| 3 | Core recording gesture? | Hold to talk | **Hold to talk, release to send** |
| 4 | How much rework? | Rebuild overlay layer | **Rebuild the overlay layer properly** |
| 5 | Where do menu and preview go? | Bottom-center | **Everything bottom-center, one column** |
| 6 | Keep the floating magic icon? | Kill it | **Kill it, hotkey opens the menu directly** |
| 7 | Preview before replace? | Always | **Always** — later reversed by you, see Update 2 |
| 8 | Long-dictation escape hatch? | Hold plus tap-to-latch | **Hold-to-talk plus tap-to-latch on one key** |
| 9 | What to do with Settings? | Re-skin on tokens | **"Actually redesign, I give you the control"** |
| 10 | Visual style? | Dark frosted glass | **Dark frosted glass, minimal** |
| 11 | Dismissal on focus loss? | Preview stays, menu closes | **Preview stays, menu dismisses** |
| 12 | What broke the last attempts? | — | **Preview appeared half off-screen bottom-right; position differed between first and later runs; paste errors not visible** |
| 13 | Daily apps? | — | **VS Code, Brave, WhatsApp, Notion, terminal** |
| 14 | What did "clear icons" mean? | Dock icons | **Icon buttons inside the bottom dock** |
| 15 | What does Redo replace? | Overwrite last paste | **Redo re-selects and overwrites what it just pasted** |
| 16 | What does "prompts in layers" mean? | Layered menu | **Layered menu: 3 main actions, more on expand** |

## 4. Plan

### Root cause of every symptom you reported

One defect class: **the same dimension defined in two places.**

1. **Size disagreement.** `StatusOverlay.resizeForMessage()` set the *window* size in TypeScript while
   `status.css` set the *card* size independently. They disagreed in all four states. Worst case was a
   304px window around a 156px card, leaving 148px of invisible, click-blocking window while recording.
2. **Position race.** `InputAssistWindow.resizeAndPositionWindow()` chose between `centerInContext()`
   and `positionPopover()` based on whether `this.contextBounds` was set, and that field is filled by an
   async `captureActiveTarget()` call. Won the race: centered. Lost it: popover. That is exactly
   "first time it comes, next time on center."
3. **Off-screen clipping.** `positionPopover()` derived its work area from
   `screen.getDisplayMatching(activeTarget.bounds)`, using bounds supplied by Windows UI Automation.
   Four of your five daily apps are Chromium or Electron, where those bounds are routinely stale or
   wrong. Wrong bounds resolve the wrong display, the containment check passes against the wrong work
   area, and a 450x354 panel lands half past the right edge.
4. **Invisible errors.** Paste failures called `showStatus("error", ...)`, which renders on the
   top-center status pill, while you are looking at the bottom-right preview panel. It then auto-hid
   after 5 seconds.
5. **Ghost icon.** A 500ms poll called `showIcon()`, which did resize plus reposition plus `moveTop()`
   twice a second, and the fallback anchor used the live cursor Y, so the icon slid up and down
   following the mouse.

### The rule that removes the class, not the instances

**The renderer measures itself; the main process never invents a size.**

```
renderer   ResizeObserver on .dock
             -> ipc "dock:resize" { width, height }
main       x = displayCenterX - width / 2
           y = workArea.bottom - height - 32
```

- CSS and TypeScript can no longer disagree, because TypeScript no longer holds an opinion about size.
- Position cannot race, because it depends on nothing asynchronous.
- Width is **fixed at 480px in every state**; only height changes. That stops the sideways sliding.
- The display is **snapshotted when a session begins** and reused for the whole session, so the dock
  cannot hop mid-interaction.
- The window is sized to exactly the card, so there is no invisible click-blocking region.

### Flow

```
        +- hold hotkey ------+         +- tap hotkey -+
        |  speak, release    |         |  latched     |
        +---------+----------+         +------+-------+
                  +---------------+-----------+
                                  v
                        +--------------------+
                        | ((( ))) 0:04     X |   listening
                        +--------------------+
                                  v   release / tap / Esc = cancel
                        +--------------------+
                        | ~ Transcribing...  |   working
                        +--------------------+     3s  -> elapsed shown
                                  v                8s  -> "Taking longer than usual"
                        +--------------------+
                        | ~ Polishing...     |
                        +--------------------+
                                  v
                       +-- PASTE. No confirm. --+
                                  v
              +------------------------------------------+
              |  Pasted     Redo     Polish     More     |   done
              +------------------------------------------+
                        auto-hides after 8s idle
                                  |
                    +-------------+-------------+
                    v                           v
              Redo                        Polish / More
        Ctrl+Z the paste,           layer 1: Polish | Professional | Shorten | More
        re-polish, paste again      layer 2: Fix grammar, Friendly, Expand,
                                             Simplify, Custom
```

### Error contract

Every failure renders **in the dock**, carries its own recovery button, and clears after 8s idle.

| Failure | Dock shows | Button |
|---|---|---|
| No API key | Add your Groq API key to start | Open Settings |
| Transcription failed | normalized message plus error id | Retry |
| Polish failed | raw transcript still pasted | Redo |
| Paste blocked | Text is on your clipboard | Copy again |
| Hotkey unavailable | Another app may be using that shortcut | Open Settings |

### Files

**Delete:** `src/status-overlay.ts`, `src/input-assist-window.ts`,
`src/renderer/status.{html,css,js}`, `src/renderer/status-preload.js`,
`src/renderer/input-assist.{html,css,js}`, `src/renderer/input-assist-preload.js`

**Add:** `src/overlay/overlay-state.ts` (pure, tested), `src/overlay/overlay-dock.ts`,
`src/renderer/dock.{html,css,js}`, `src/renderer/dock-preload.js`, `src/renderer/tokens.css`

**Modify:** `src/main.ts`, `src/hotkey/hotkey-listener.ts`, `src/hotkey/hotkey-parser.ts`
(add `classifyPress`), `src/rewrite/rewrite-actions.ts` (layer grouping),
`src/insertion/text-inserter.ts` (add `sendUndo`), `src/types.ts`, `src/renderer/settings.*`

**Untouched:** `src/audio/`, `src/transcription/`, `src/cleanup/`, `src/observability/`,
`src/config-store.ts`, `src/input-assist/uia-helper.ts` (demoted to read-only, not deleted).

### Alternatives rejected

- **Patch the existing two windows.** Fixes instances, not the class. The two-source-of-truth defect
  would return with the next state added.
- **Keep the floating icon with better math.** No amount of math fixes UIA bounds that are wrong, and
  four of five daily apps are Electron.
- **Keep UIA `replaceWholeText`.** Microsoft's own docs state TextPattern cannot insert or modify text,
  and Electron apps expose TextPattern rather than ValuePattern. Clipboard is the only real path.
- **Preview before every paste.** Rejected by you after the research: Wispr Flow pastes straight
  through, and a preview is a confirmation step by another name. Replaced by Redo.

## 5. Tasks

- [x] 1. Write this task file
- [x] 2. `tokens.css`, one shared palette
- [x] 3. `overlay-state.ts`, pure placement, recovery, press classification, plus tests
- [x] 4. `overlay-dock.ts` plus dock renderer with the self-measuring resize contract
- [x] 5. Hold-to-talk plus tap-to-latch in the hotkey listener
- [x] 6. Layered rewrite actions
- [x] 7. Redo (Ctrl+Z, re-polish, paste)
- [x] 8. Rewire `main.ts`, delete the two old windows
- [x] 9. Settings redesign on shared tokens
- [x] 10. `npm run build` and `npm test` green

## 6. Updates

### 2026-09-05 — interview and audit

Read all 6,805 lines. Ran a 16-question interview across three rounds. Audit findings recorded in
section 4. Researched Wispr Flow, Superwhisper, and Microsoft UI Automation documentation.

Key external findings:

- Wispr Flow uses a bottom-of-screen "Flow Bar", hold-to-dictate with release-to-paste and no confirm
  step, and double-press for hands-free. Your instincts matched the market leader on all three.
- Wispr Flow's error UX puts the message on the bar itself with a recovery button (Retry for
  transcription, Paste for paste failures) and auto-clears after 8s. Adopted wholesale.
- Wispr Flow shipped the same bug family. Their changelog lists "Flow Bubble UX cleanup: fixing sizing
  glitches, visibility issues, errors that used to stick around."
- Microsoft: "The TextPattern classes do not provide a means to insert or modify text." This is why
  in-place replacement never worked in your apps.

### 2026-09-05 — you reversed the preview decision

The round 2 answer was "always preview". After seeing the research you said "remove confirm just paste,
users can generate a new one if not satisfied". Preview is removed from the dictation path and Redo
replaces it. The earlier answer is kept above rather than deleted, per the append-only rule.

### 2026-09-05 — scope grew: Settings

You approved "rebuild the overlay layer", not the full redesign. Two questions later you said
"Actually redesign, I give you the control, you are an expert". Settings is therefore in scope: same
tokens, dark frosted, first-run checklist. Flagged out loud rather than expanded quietly.

### 2026-09-05 - first real-app test failed; three root causes found in the logs

You reported: "it does not paste and shows error", with the dock reading
"Could not replace the text. The rewrite is on your clipboard - press Ctrl+V."

That message was wrong on two counts. Reading `app.log` found **three** separate defects.

**1. The Groq model was decommissioned.** Both cleanup and rewrite returned:

```
404 {"error":{"message":"The model `llama-3.3-70b-versatile` does not exist
or you do not have access to it.","code":"model_not_found"}}
```

Groq retired `llama-3.3-70b-versatile` on 2026-08-16. This was the actual reason nothing worked.
Changing the default alone would not have helped, because your saved `config.json` still held the
retired id. Fixed by adding a `RETIRED_MODELS` map in `config-store.ts` that `modelOr()` applies, so
load and save both migrate existing installs. New default is `openai/gpt-oss-120b`, Groq's own
recommended replacement.

**2. The dock stole focus, so the paste was refused.** From the log:

```
warn  paste.target.changed   { expectedHasHandle: true, actualHasHandle: true, titleChars: 9 }
error clipboard.paste.failed { message: "Active window changed before paste." }
```

`titleChars: 9` is "BayanFlow". You finished the recording by clicking the dock's Finish button,
which made the dock the foreground window, and `assertActiveTarget()` correctly refused to paste
into it. **This was a regression I introduced**: the old `StatusOverlay` was created with
`focusable: false`, and I created the dock with `focusable: true`. Fixed by creating the dock
non-focusable and calling `setFocusable()` only for the menu view, which is the one view that needs
keyboard input, plus refocusing the captured window before pasting.

The same bug also corrupted the rewrite target: `paste.target.captured { titleChars: 9 }` shows
`openRewriteMenu()` captured the dock itself rather than your editor.

**3. The error message was wrong and it copied the wrong text.** `runRewrite`'s catch block read the
shared `lastInsertion`, which was still set from the earlier dictation. The log proves it:

```
groq.rewrite.start     { inputChars: 17 }     <- the rewrite input
clipboard.copy.success { textChars: 474 }     <- the previous dictation, copied by mistake
```

So a failed API call reported a replacement failure and put 474 stale characters on your clipboard.
Fixed by tracking this attempt's output in a local variable, so the "could not replace" branch is only
taken when the model actually returned text.

**Also changed:** a 404 now reads "That AI model is no longer available. Open Settings to choose
another." instead of "Groq model or request is invalid", and 404/401/403 failures offer `Open Settings`
rather than a `Try again` button that cannot succeed. A blocked paste during dictation now shows one
message instead of two competing ones.

**Verified:** `npm run build` clean, `npm test` 78 pass / 0 fail, and a real launch against your actual
config logged `dictation.providers.ready { cleanupModel: "openai/gpt-oss-120b" }`, proving the
migration fires on load. Root causes 2 and 3 are code-level fixes not yet exercised by a real
dictation.

### 2026-09-05 - all three flows confirmed working; added the permanent pill and a new palette

You confirmed dictation, Redo, and rewrite all work. Two follow-ups:

> "I don't see a permanent flow button because button gets disappeared after sometimes, so can we have
> a small icon on hover of it things open, and also work on UI/UX more, better colors like original
> Wispr Flow or better."

**Decisions taken (3 questions):** fixed bottom-centre with a hide toggle; "Ink & Iris" palette;
clicking the pill starts dictation while hovering reveals the actions.

**Research:** Wispr Flow ships its Flow Bar hidden by default (Settings, System, Show Flow Bar at all
times), supports drag-to-snap on the bottom/left/right edges, and offers a right-click menu with
"Hide for 1 hour". The hide toggle and the one-hour snooze are taken from that; drag-to-snap was
deliberately not taken, because saved per-display position is the same state that produced the
original placement bugs.

**New idle view.** `DockView` gains `{ kind: "idle", ready }`, a small capsule showing a state dot and
a mini waveform. It never focuses, never dismisses on blur, and never auto-clears. Everything that used
to call `dock.hide()` now calls `dock.showRest()`, which returns to the pill when it is enabled and
hides only when the user turned it off or snoozed it. The dot turns grey when there is no API key or
the hotkeys failed to register.

**Hover expansion.** `dock.js` listens for mouseenter/mouseleave on the dock root and toggles a
`data-hover` attribute, with a 350ms grace period on leave so crossing a gap does not collapse it.
Expanded, the pill shows Dictate, Rewrite, Settings, and Hide for 1 hour.

**The pill core does not move when it expands.** The pill is a three-column grid whose side columns are
equal `1fr`, so the core button sits exactly on the centre line in both states; combined with the
centre anchor, the control under the cursor stays put. A first attempt used `1fr auto 1fr` in both
states and measured wrong: the collapsed pill came out 106px wide with its core at x=27 rather than 53,
because empty `1fr` columns still reserve width inside an intrinsically-sized grid. Fixed by collapsing
to a single `auto` column and only switching to three columns on hover. Measured after the fix:
collapsed 53px with the core at 27 of 27, hovered 396px with the core at 198 of 198 - zero offset in
both.

**Sizing contract extended.** The renderer now reports width as well as height, because the pill is far
narrower than the 480px working states. The invariant is unchanged and in fact stronger: CSS owns the
size, the renderer measures it, and the main process only positions. The regression test was rewritten
to assert that directly - `overlay-dock.ts` must contain exactly one `setBounds` call, must derive it
from `clampDockSize(this.lastSize, workArea)`, and must contain no `setSize` call at all.

**Palette.** `tokens.css` replaced with "Ink & Iris": a near-black desaturated base (`#0a0b0f`) with a
single violet accent (`#7c6aff`), mint for live recording, amber for busy, coral for errors. The
Settings window background moved from `#eef2f6` to the same near-black, so nothing light remains.

**New setting.** `showDock` (default true), exposed in the tray menu and in Settings, plus a one-hour
snooze from the pill itself.

**Verified:** `npm run build` clean, `npm test` 82 pass / 0 fail (4 new: idle never focuses or
auto-clears, only a recording claims a display, the narrow pill shares the working states' centre line,
and the single-owner sizing guard). `npm run local:smoke` passes. All eight dock states rendered in a
browser against the real `dock.css`/`dock.js`, with reported size equal to measured size in every one.

**Not verified by machine:** how the pill feels in daily use, and whether hover-to-expand behaves well
with a real mouse over a real always-on-top window.

### 2026-09-05 - the dock rendered completely blank; root cause and a real guard

You reported: "The screen is not visible at all now, on click of ctrl+shift+space the background thing
works but UI [not] visible." Dictation still worked; the entire overlay was invisible.

**Evidence first.** `dock.view` was logged at debug level, and the configured level is info, so it was
being dropped. Promoted it to info with the real window state, and the window turned out to be fine:

```
dock.view {"view":"idle","visible":true,"x":720,"y":972,"width":480,"height":39, ...}
dock.resize {"width":480,"height":54,"view":"done"}
```

Shown, correctly sized, correctly positioned. So the problem was paint, not window logic. Added a
`capturePage()` diagnostic behind `BAYANFLOW_DOCK_CAPTURE=1` that counts non-transparent pixels:

```
dock.capture {"kind":"idle","width":480,"height":54,"totalPixels":25920,"opaquePixels":0,"isBlank":true}
```

**Zero opaque pixels in every state.** Conclusive.

**Root cause.** The previous change made the dock `position: absolute` and gave `body`
`position: relative`, so body became the dock's containing block. `body` also carries
`overflow: hidden`, and with the dock out of flow body has zero height. An absolutely positioned
element is clipped by an ancestor that is both its containing block and has `overflow: hidden`, so
the whole card was clipped to a zero-height box and painted nothing.

Absolute positioning had been introduced so the measured rect would be "pure content size, independent
of the window size". That reasoning was wrong: the width is set explicitly in CSS, so a normal-flow
block already measures the same regardless of the viewport. It bought nothing and cost everything.
Fix: remove both `position: absolute` on `.dock` and `position: relative` on `body`.

**Why the browser harness did not catch it.** The harness gave body 16px of padding, so the clip box
was 32px tall instead of 0 and roughly half the card still rendered. I saw that half-rendered card in
the very first harness screenshot, decided it was a screenshot artifact because
`getBoundingClientRect()` reported the correct size, and moved on. Bounding rects ignore clipping, so
measurement could never have caught this. That call is what let the bug ship.

**The guard.** `npm run local:smoke` now runs the app with `BAYANFLOW_DOCK_CAPTURE=1` and fails if any
captured dock frame is blank. Verified both ways, which is the point:

```
# with the bug reintroduced
Local smoke failed: the dock rendered 3 blank frame(s) (idle, idle, error).
The window is visible and correctly sized but paints nothing.        -> exit 1

# with the fix
Local smoke passed: ... and painted 4 non-blank dock frame(s).       -> exit 0
```

This closes a real gap: every other check the project has - unit tests, startup smoke, window bounds
logging - reports success on a completely invisible UI.

**Verified:** `npm run build` clean, `npm test` 82 pass / 0 fail, `npm run local:smoke` passes with 4
non-blank frames, and the guard demonstrably fails when the defect is reintroduced.

### 2026-09-05 - pill confirmed visible; motion, colour, and dead-code cleanup

You confirmed the pill renders. Three follow-ups: the hover expansion was sudden, the amber read as
"light brown" and looked ugly, and dead code should go.

**Motion.** The expansion was instant because the window jumped between two sizes in a single
`setBounds`. Electron's `setBounds(bounds, animate)` flag is macOS-only, so `applyBounds()` now eases
the window manually: 150ms, easeOutCubic, 16ms steps. Content-driven resizes animate; the first
placement of a new view still snaps, so pressing the hotkey feels immediate.

Two supporting changes were needed to make that look right:

- `body` is now `display: flex; justify-content: center`, so while the window animates between two
  widths the card is clipped evenly on both sides instead of only from the right. That matches the
  centre-anchored window and keeps the pill core visually still.
- `.dock` is `flex: 0 0 auto`. Without it the card would shrink to fit the mid-animation window, report
  the smaller size back over IPC, and start a feedback loop against the animation.

The revealed buttons also fade in over 200ms with a keyframe animation rather than a transition,
because they come from `display: none`, which a transition cannot animate.

**Colour.** `--bf-busy` moved from amber `#ffb454` to sky `#5cc8ff`. The amber was a desaturated
orange that reads brown at dot size and clashed with the violet accent and mint live state. Sky sits
between violet and mint on the wheel, is unmistakably not brown, and still reads as "attention" for
the two places it is used: the warn dot on a done state, and the "not done yet" checklist marker in
Settings. Green, violet, and coral are unchanged.

**Dead code removed.** A scan for exported symbols with no reader outside their own definition found:

- `src/input-assist/` - the whole directory (`uia-helper.ts`, `input-assist-types.ts`,
  `rewrite-source-selection.ts`, `speech-readiness.ts`). Nothing has imported it since the rewrite flow
  moved to clipboard capture, so the PowerShell helper process was already never spawned.
- `src/helpers/input-assist-helper.ps1` and the now-empty `src/helpers/`, plus the matching copy step
  in `scripts/copy-renderer.mjs`.
- `src/assets/magic-wand.png`, used only by the deleted floating icon.
- `tests/input-assist-target.test.mjs`, which only tested the deleted modules.
- `inputAssistEnabledOnStartup` - a config field nothing had read since the floating icon was removed,
  threaded through `types.ts`, `config-store.ts`, and `settings-window.ts`.
- `DOCK_ELAPSED_AFTER_MS` and `DOCK_SLOW_AFTER_MS` in `overlay-state.ts`, duplicated by the renderer's
  own constants, which are the only ones that ran.
- `RecorderLike` in `recorder-session.ts`.

A second scan after the deletions reports no unused exports remain.

**Test guard updated.** The single-owner sizing test asserted exactly one `setBounds` call. The tween
legitimately needs three, all inside `applyBounds`. Rewritten to assert the real invariant: every
`setBounds` in the file must lie within `applyBounds`, the size must still come from
`clampDockSize(this.lastSize, workArea)`, and there must be no `setSize` anywhere.

**Verified:** `npm run build` clean, `npm test` 75 pass / 0 fail (down from 82 purely because the
7 deleted input-assist tests went with their modules), `npm run local:smoke` passes with non-blank dock
frames.

**Not verified by machine:** whether 150ms is the right easing duration in the hand, and whether sky
is the colour you actually want. Both are one-value changes.

### 2026-09-05 - polish truncating text, and "no text found" on a focused input

You reported two things: polish sometimes cut the text down to one sentence with the rest gone, and
"no text found in that input" even though you were in the input before clicking More then Shorten.
Both were regressions from my own changes, and both were provable from `app.log`.

**Bug 1: the model ran out of budget thinking.**

Every truncated rewrite had `completion_tokens` landing exactly on the computed ceiling:

| action | input chars | output chars | budget (in/4 + 128) | completion_tokens |
|---|---|---|---|---|
| polish | 292 | 96 | 201 | 201 |
| professional | 327 | 39 | 210 | 210 |
| professional | 340 | 141 | 213 | 213 |
| friendly | 354 | 80 | 217 | 217 |
| cleanup | 383 | 13 | - | 160 |

Exact equality every time is the signature of hitting `max_completion_tokens`.

Root cause: `openai/gpt-oss-120b` is a reasoning model, and its thinking tokens are charged against
`max_completion_tokens`. The budget formula was `inputTokens + 128`, sized for `llama-3.3-70b`, which
emits no reasoning. I swapped the model in the deprecation fix and never resized the budget, so the
reasoning consumed the whole allowance and the visible answer was cut off mid-sentence.

Worse, when reasoning consumed *all* of it the content came back empty and both providers did
`content?.trim() || trimmed`, silently returning the **original text** and logging it as success. That
is why some rows show `outputChars` exactly equal to `inputChars`: the rewrite never happened and
nothing said so.

Fixes, in `src/llm/completion-budget.ts`:

- `estimateOutputTokens()` adds reasoning headroom (`inputTokens * 2 + 768`) for models that need it,
  with a 512-token floor and a 4096 ceiling. The failing cases go from 201-217 tokens to 1243-1291.
- `reasoning_effort: "low"` is sent to reasoning models, since a tidy-up needs no deep thought. It is
  not in the installed SDK's types and the user can type any model id into Settings, so
  `withReasoningEffort()` drops it and retries once if the API rejects it as an unknown parameter. A
  genuine error such as a bad key is never swallowed by that retry.
- `finish_reason === "length"` now throws instead of returning a fragment. For rewrite the dock shows
  "That was too long for the model to finish. Try a shorter selection."; for cleanup the dictation
  pipeline catches it and inserts the raw transcript, which the dock already labels as such.
- The rewrite provider no longer falls back to the input on empty content. Cleanup still does, because
  its prompt legitimately asks for an empty reply on silence and losing a transcript would be worse.

**Bug 2: the rewrite captured our own overlay as the target.**

Of 17 rewrite target captures in the log, 7 recorded `titleChars: 0` and one recorded `titleChars: 9`.
Nine characters is exactly "BayanFlow". The dock is always-on-top and can be the foreground window
right after it is clicked, so `openRewriteMenu()` captured the dock itself, then
`captureTextFromTargetByClipboard()` sent Ctrl+A and Ctrl+C to our own overlay, found nothing, and
blamed the user with "Type or select something first".

Fix: `isUsableTarget()` in `text-inserter.ts` rejects untitled windows and any window belonging to
BayanFlow. `captureTarget()` in `main.ts` routes every capture through it and falls back to the last
window that genuinely was the user's app, which is what the user means when they click Rewrite on the
pill. Dictation uses the same helper, so clicking the pill to dictate cannot paste into the dock
either. The message when there is genuinely no target now says what to do rather than implying the
input was empty.

**Verified:** `npm run build` clean, `npm test` 89 pass / 0 fail (11 new tests covering the reasoning
budget, the unsupported-parameter fallback, truncation detection, and the target guard),
`npm run local:smoke` passes.

**Not verified by machine:** the fix cannot be exercised against the live Groq API without a key, so
whether the larger budget and `reasoning_effort: "low"` fully eliminate the truncation needs a real
run.

### 2026-09-05 - rewrites were appending instead of replacing

You showed a screenshot of `.node-version` holding six stacked paraphrases of the same sentence, from
using Shorten. The file on disk was untouched (`22.12.0`, matching HEAD), so that was an unsaved
buffer, but the behaviour was real and it is a data-integrity bug.

**Arithmetic proof from the log.** Three consecutive entries:

```
groq.rewrite.start  redo    inputChars 678
clipboard.paste     redo    textChars  333
clipboard.capture   shorten scope selection, textChars 1011
```

678 + 333 = 1011. The Redo did not replace the previous text, it **appended** it, and the next
operation then read the combined result as its input. Repeat that a few times and you get the
screenshot.

**Root cause.** Nothing verified that the destination still held what we were rewriting.

- The rewrite selection path did `focusTargetWindow()` then `pasteText()`. Refocusing restores the
  *window*, not the caret or the selection inside it. The dock takes focus while its menu is open and
  a network round trip passes before the paste, so by then the selection is often gone. Ctrl+V with no
  selection **inserts**, so the rewrite landed after the original instead of over it.
- Redo used Ctrl+Z then pasted. Ctrl+Z is fire-and-forget: nothing checked that the host app actually
  undid anything, and when it did not, the new version was appended.

Note the asymmetry that hid this: the `whole` scope already went through
`replaceWholeTextByClipboard()`, which re-reads the input and refuses to write on a mismatch. Only the
`selection` path and Redo were unguarded.

**Fixes.**

- `replaceSelectionByClipboard()` in `text-inserter.ts`. Re-copies the live selection immediately
  before writing and refuses unless it still matches the text that was rewritten. On refusal the
  rewrite is left on the clipboard, so nothing is lost.
- Redo no longer sends Ctrl+Z. `sendUndo()` is deleted. Instead `replaceInsertedText()` in `main.ts`
  reads the input back, confirms the previously inserted text is still present, splices in the new
  version with `replaceLastOccurrence()`, and writes it through the checked whole-input path. If the
  old text is not found, or the input is larger than `MAX_REWRITE_INPUT_CHARS`, nothing is overwritten
  and the new version is copied with a message saying so.

The rule this establishes: **never write into an input without first proving it still contains what we
think it contains.** Both write paths now do.

**Verified:** `npm run build` clean, `npm test` 93 pass / 0 fail (4 new: selection replace succeeds
when intact, refuses when the selection changed, refuses when nothing is selected, and the
last-occurrence splice), `npm run local:smoke` passes, no unused exports.

Also confirmed working from the same log: `target.capture.rejected ... reusedPrevious: true` shows the
previous round's dock-capture guard firing correctly, and no request hit its token ceiling, so the
reasoning-budget fix held.

**Not verified by machine:** the fix cannot be exercised against a live host app from here, so whether
Shorten now replaces cleanly in VS Code needs a real run.

### 2026-09-07 - appending without a selection, and Redo losing the action

Two follow-ups after the previous fix: text still appended "sometimes if I have not done Ctrl+A
before pressing shorten", and Redo "does not redo the last polish like shorten, it does something
else generic rewrite".

**Why the previous fix did not cover it.** `replaceSelectionByClipboard()` proved the *text* was
unchanged, but it could not prove a *selection existed*. VS Code copies the caret's current line when
nothing is selected, so Ctrl+C returned text, the verification re-copied the same line, the comparison
matched, and the paste went ahead with nothing selected. Ctrl+V then inserted. The check was sound and
still wrong, because Ctrl+C is not a selection detector.

**The fix: stop needing to know.** `captureSelectionAndWhole()` reads the selection and then the whole
input. Every rewrite now writes through `replaceWholeTextByClipboard()`, where Ctrl+A selects
everything and a paste therefore always replaces. A scoped rewrite is spliced back into the surrounding
text with `replaceLastOccurrence()` rather than pasted over a selection that may not be there.

This also gives the caret-on-a-line case a sensible meaning: pressing Shorten with no selection
shortens the line the caret is on and puts it back where it was, instead of appending a copy.

Guard: if the whole input is longer than `MAX_REWRITE_INPUT_CHARS` the rewrite is copied rather than
written, because Ctrl+A over a large document is too destructive to risk on a clipboard read.

**Redo lost the action.** `redoLastInsertion()` always called the provider with
`actionId: "custom"` and a generic "rewrite this differently" instruction, so a Redo after Shorten
produced something that was not a shortening. `lastInsertion` now records which action produced the
text, and Redo repeats it. `buildRewritePrompt()` takes an `attempt` number and appends a variation
note when it is above 1, so the instruction stays the same while the wording is asked to differ.
Dictation has no action, so its Redo still re-polishes the raw transcript. The dock now says
"Shorten - attempt 2" rather than "Replaced - attempt 2".

**Removed as dead:** `replaceSelectionByClipboard()` and `captureTextFromTargetByClipboard()`, both
superseded, along with `ClipboardTextSource` and their tests.

**Verified:** `npm run build` clean, `npm test` 92 pass / 0 fail, `npm run local:smoke` passes, no
unused exports.

**Not verified by machine:** whether the whole-input replace behaves well in every host app, and
whether the caret-line behaviour reads as helpful rather than surprising.

## 7. Explanation

### 1. What changed

Two overlay windows became one. `StatusOverlay` (the top-centre pill) and `InputAssistWindow` (the
floating magic icon and its popover panel) are deleted. In their place is a single window, the **dock**,
that sits at the bottom centre of one display and switches between five states.

The floating icon is gone entirely, along with the 500ms polling loop that repositioned it. Dictation
changed from press-to-start/press-to-stop to hold-to-talk with tap-to-latch. The rewrite preview screen
is gone; results paste immediately and `Redo` replaces them. Settings was rebuilt on the same design
tokens as the dock.

### 2. Why it was needed

Every symptom reported traced back to one defect: **the same dimension was defined in two places.**

- The status pill's window size was computed in TypeScript while its card size was set independently in
  CSS. They disagreed in all four states. In the recording state a 156px card sat inside a 304px window,
  leaving 148px of invisible-but-clickable window over whatever was underneath.
- The rewrite panel chose between two different placement algorithms depending on whether an async
  `captureActiveTarget()` call had finished. Won the race: centred. Lost it: anchored. That is the
  "first time bottom-right, next time centre" behaviour exactly.
- That anchored path derived its screen bounds from Windows UI Automation. In Chromium and Electron apps
  those bounds are frequently stale or wrong, which resolved the wrong display and let a 450x354 panel
  land half off the right edge.
- Paste errors were sent to the top-centre pill while the user was looking at the bottom-right panel,
  and auto-hid after five seconds.

Patching each symptom would have left the defect class in place.

### 3. How it works, step by step

**The sizing contract.** The renderer runs a `ResizeObserver` on its root `#dock` element. Whenever the
element's height changes, it sends that number to the main process over `dock:resize`. The main process
applies exactly one formula, in `dockBounds()`:

```
x = workArea.x + (workArea.width - width) / 2
y = workArea.y + workArea.height - height - 32
```

Width is a constant, `DOCK_WIDTH = 480`, in every state. CSS gives `.dock` `width: 100%`, so it fills
whatever the window is. **The main process has no opinion about size and CSS has no opinion about
position**, which makes a disagreement between them structurally impossible.

**The display choice.** `workAreaForSession()` picks the display nearest the cursor on the first show and
caches it until the dock hides. Synchronous, so it cannot race; cached, so moving the mouse to another
monitor mid-dictation cannot make the dock hop.

**Dictation.** `HotkeyListener` now records a timestamp on key-down and passes the held duration to
`onReleased`. `classifyPress()` splits at 400ms: a hold finishes the recording on release, a tap latches
recording on until the next tap. A third listener watches `Esc` and cancels if recording. uiohook
observes rather than consumes, so `Esc` still reaches the app underneath.

**Insertion.** Transcribe, polish, paste. No confirmation. Before recording starts, the active window is
captured; before pasting, that window is verified by handle. If it changed or Windows refused, the text
stays on the clipboard and the dock says so with a `Copy again` button.

**Redo.** `lastInsertion` holds the original transcript, the text that was inserted, and the target
window. Redo increments an attempt counter, asks the model for a different phrasing of the *original
transcript* (not of the already-rewritten text, so repeated Redos do not compound), sends `Ctrl+Z` to
undo the previous paste, then pastes the new version.

**Rewrite.** The hotkey captures the target window *before* the menu opens, because opening the menu
focuses the dock and would otherwise make the dock itself the active window. Choosing an action reads
the input through the clipboard, rewrites it, then replaces it. The whole-input path re-verifies the
text has not changed since capture.

**Errors.** `recoveryForFailure()` maps each failure kind to exactly one button: missing key and hotkey
failures offer Settings, transcription offers Retry, polish offers Redo, paste offers Copy again. Errors
render in the dock and clear after 8 seconds.

### 4. Files and functions changed

**Added**

- `src/overlay/overlay-state.ts` - pure geometry and rules. `dockBounds()`, `clampDockSize()`,
  `recoveryForFailure()`, `viewNeedsFocus()`, `viewAutoClears()`, `viewDismissesOnBlur()`, and the
  `DockView` union. No Electron import, so it is unit-testable.
- `src/overlay/overlay-dock.ts` - the window. `setView()` sends the view and applies bounds,
  `applyBounds()` is the only place geometry is decided, `workAreaForSession()` caches the display.
  Validates every IPC payload from the renderer.
- `src/renderer/tokens.css` - the only file that defines colour, type, radius, spacing, and motion.
- `src/renderer/dock.html`, `dock.css`, `dock.js`, `dock-preload.js` - the dock UI. `dock.js` owns
  section switching, the recording and elapsed tickers, and height reporting.
- `tests/overlay-state.test.mjs` - 9 tests covering placement determinism, off-screen clamping,
  negative-origin displays, recovery mapping, focus and blur rules, and the tap/hold boundary.

**Deleted**

`src/status-overlay.ts`, `src/input-assist-window.ts`, and the `status.*` and `input-assist.*` renderer
files, with their preloads.

**Modified**

- `src/main.ts` - rewritten around the dock. All `showStatus()` calls replaced by `showListening()`,
  `showWorking()`, `showDone()`, `showFailure()`. Added `handleDictationKeyDown/Up()`,
  `redoLastInsertion()`, `openRewriteMenu()`, `runRewrite()`, `runRecovery()`. Removed the Input Assist
  polling loop, the enable/disable toggle, the pending-rewrite state machine, and the UIA helper wiring.
- `src/hotkey/hotkey-parser.ts` - added `classifyPress()` and `HOLD_THRESHOLD_MS`.
- `src/hotkey/hotkey-listener.ts` - tracks press time, passes held duration to `onReleased`.
- `src/insertion/text-inserter.ts` - added `sendUndo()`.
- `src/rewrite/rewrite-actions.ts` - added a `layer` field, `getDockMenuActions()`,
  `isRewriteActionId()`, and `buildRedoInstruction()`. Reordered so layer 1 is Polish, Professional,
  Shorten.
- `src/config-store.ts` - `autoPaste` default flipped to `true`.
- `src/types.ts` - removed the now-dead `AppStatus` and `StatusMessage`, and the unreachable
  `input-assist` runtime state.
- `src/renderer/settings.*` - rebuilt on tokens, dark, with a four-step first-run checklist. Removed the
  auto-paste acknowledgement gate and the dead Input Assist startup toggle.
- `package.json` - `npm test` now passes an explicit glob, which Node 24 requires.
- `tests/renderer-security.test.mjs` - retargeted at the dock; added a guard that fails if `.dock` ever
  gains a fixed pixel width, so the original defect cannot be reintroduced silently.
- `tests/rewrite-actions.test.mjs` - asserts the action set and the layering rather than a fixed order.
- `tests/config-store.test.mjs` - updated for the new `autoPaste` default.

### 5. Important decisions

- **The renderer measures itself.** The alternative was to keep computing sizes in TypeScript and be
  careful to mirror them in CSS. Care is what failed the first time. Removing one of the two owners is
  the only fix that holds.
- **One fixed width.** The old pill re-centred on every message, so it slid sideways as the status
  changed. A constant width removes the motion entirely rather than smoothing it.
- **Cursor display, cached per session.** Rejected using the target window's bounds, because those come
  from UI Automation and are the very thing that was wrong.
- **Redo instead of preview.** Your call after seeing the research. It also matches Wispr Flow, which
  pastes on release with no confirmation step.
- **Ctrl+Z for Redo.** Chromium text controls treat a paste as one undo unit, covering four of your five
  daily apps. Rejected counting characters and sending backspaces, which is slow and breaks on any edit
  the user makes in between.
- **UIA demoted, not deleted.** `replaceWholeText()` is no longer called. Microsoft's documentation
  states TextPattern cannot insert or modify text, and Electron apps expose TextPattern rather than
  ValuePattern, so that path could never have worked reliably in your apps. Clipboard is the real path.
  The `src/input-assist/` files stay on disk but nothing calls them, so the PowerShell helper process is
  never spawned.
- **autoPaste default flipped to true.** You asked for "entire control on speech to paste". This changes
  a safety default, so it is called out here rather than buried. Copy-only is still one toggle away.

### 6. Tests and verification

Real output, all run on this machine:

- `npm run build` - clean, no TypeScript errors.
- `npm test` - **76 tests, 76 pass, 0 fail** (was 43 before this work).
- `npm run local:smoke` - "Local smoke passed: Electron stayed alive for 8 seconds and wrote startup log."
- Custom startup probe against a real Electron run confirmed `dock.init.success`,
  three `hotkey.listener.started` events, `app.startup.success`, and **zero** legacy
  `status.*` or `input_assist.*` events.
- Rendered all five dock states in a browser harness driving the real `dock.js`, `dock.css`, and
  `tokens.css`. Measured result:

  | State | Reported height | Measured height | Width |
  |---|---|---|---|
  | listening | 54 | 54 | 480 |
  | working | 54 | 54 | 480 |
  | done | 54 | 54 | 480 |
  | menu | 183 | 183 | 480 |
  | error | 64 | 64 | 480 |

  Width is identical everywhere and reported height equals measured height in every state, which is the
  sizing contract holding. The three bar states are pixel-identical, so the dock does not move at all
  across listening to working to done.

**Not verified by machine:** whether `Ctrl+Z` cleanly undoes a paste in VS Code, Brave, WhatsApp,
Notion, and a terminal. This cannot be automated here and needs a manual pass.

### 7. Edge cases and limitations

- **Redo in a terminal.** Terminals have no undo stack, so `Ctrl+Z` does nothing and the new version is
  appended after the old one. Marked with a `ponytail:` comment in `text-inserter.ts`.
- **Redo after a manual edit.** If the user types after the paste and then presses Redo, `Ctrl+Z` undoes
  their edit rather than the paste. The dock does not detect this.
- **Rewrite uses the clipboard.** It sends Ctrl+A and Ctrl+C to read the input, which momentarily
  replaces the clipboard. The previous contents are restored, but a clipboard manager will record it.
- **Transparent window corners.** The window is sized to the card, so there is no large dead zone, but
  the rounded corners are transparent and still capture clicks over roughly 14px.
- **Shadow clipping.** Because the window is exactly the card size, a wide drop shadow would be cut off.
  The design uses a tight shadow plus a border instead.
- **Full-screen exclusive apps** can still cover the dock. The tray tooltip remains the fallback signal.
- **The 8s auto-clear** applies to done and error states. A long error message may disappear before it is
  fully read; it is also written to the log with an error id.
- **`src/input-assist/` is dead code** that still ships. Removing it is a follow-up, deliberately not
  done here because the approved spec said demote rather than delete.

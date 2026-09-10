# History And Stats

## 1. Task

- **Name:** History and Stats — a real BayanFlow window, plus a rewrite menu that shows every action.
- **Status:** shipped
- **Started:** 2026-09-07
- **Last updated:** 2026-09-07

## 2. What you asked for

Your words, kept as constraints:

- "can we make those buttons smaller so more accomodate without going to more button"
- "also add a history page on what I spoke and their polised version opening option"
- "Add stats also how much I spoke etc"
- "we need to build like whispr flow the page"

Read as four deliverables:

1. The rewrite menu shows every action at once. No `More` click for the common case.
2. A History page listing every dictation, openable to compare raw speech against the polished text.
3. A Stats page: how much you spoke, in words, sessions, and time.
4. The app gets a proper multi-page window like Wispr Flow's, not just a settings form.

## 3. Open questions

| # | Question | Recommendation | Your answer |
|---|---|---|---|
| 1 | History means storing spoken text on disk. How? | Plain capped JSON file plus a Clear button | **Plain file + Clear button** |
| 2 | Where do History and Stats live? | One window with a left sidebar | **One window with a sidebar** |
| 3 | How small do the rewrite buttons go? | 4 per row, keep the 32px minimum height | **4 per row, keep 32px tall** |
| 4 | What does History record? | Dictations only | **Dictations only** |

### The privacy reversal, recorded on purpose

Before this task the app was built to never keep spoken text: the logger redacts `transcript`,
`rawText`, `finalText`, and `cleanedText`, and temp audio is deleted on every exit path. History
reverses that for one specific file and nothing else.

- Spoken and polished text is written to `history.jsonl` under the Electron `userData` directory.
- It is written **only** there. The logger's redaction rules are untouched, so logs still carry no text.
- Nothing is uploaded. The file never leaves the machine.
- `historyEnabled` turns recording off, and Clear history deletes the file.
- The file is capped at the newest 500 entries so it cannot grow without bound.

A future session reading AGENT.md must not "fix" this file as a privacy defect. It is a deliberate,
user-approved trade, and AGENT.md now says so.

## 4. Plan

### Part 1 — Rewrite menu

`REWRITE_ACTIONS` carried a `layer` field: layer 1 rendered inline, layer 2 hid behind `More`. The
layering was the feature you asked to remove, so the field goes with it. All eight actions render in
one 4-column grid. Buttons keep `min-height: var(--bf-hit)` (32px) and lose padding and font size
instead, because the 32px hit target is a documented product rule and cramped clicking is a worse
outcome than a second row.

### Part 2 — History store

New `src/history/history-store.ts`. Append-only JSON Lines, one entry per dictation:

```
{ id, at, seconds, words, chars, app, raw, polished, polishedDiffers }
```

JSONL rather than a JSON array so an append is one `appendFile` and a partially written last line
can be dropped instead of corrupting the file. Trimming to the newest 500 rewrites the file, which
is cheap at that size and needs no database.

Stats are derived from the same file at read time. No second store, no counters to keep in sync.

### Part 3 — The window

`SettingsWindow` becomes the app window: a left sidebar with Home, History, Stats, Settings, and one
pane visible at a time. It stays one class, one window, one preload, because a second window would
mean a second lifecycle, a second IPC surface, and two places to look for the same information.

### Part 4 — Docs

This file, the task index row, and the AGENT.md sections that would otherwise contradict the new
behaviour.

### Rejected alternatives

- **A second History window.** Two windows to keep in sync for no user benefit.
- **SQLite.** A dependency, a native build, and a migration story for at most 500 rows.
- **Encrypting history.** The API key is encrypted because it is a credential that grants spend. A
  transcript in the user's own profile directory is already behind the Windows account boundary, and
  encryption would have made the file impossible to inspect or export by hand.
- **Separate stats counters.** Derivable from the history file; a second store is a second thing to
  get wrong.

## 5. Tasks

- [x] 1. Drop `layer` from the rewrite actions and render all eight in a grid.
- [x] 2. Shrink the menu buttons without going under 32px tall.
- [x] 3. Add `HistoryStore` with append, list, stats, delete one, clear all, and a 500-entry cap.
- [x] 4. Add the `historyEnabled` setting.
- [x] 5. Record every successful dictation from `main.ts`.
- [x] 6. Add history IPC to the app window and expose it through the preload.
- [x] 7. Rebuild the window with a sidebar: Home, History, Stats, Settings.
- [x] 8. Tests for the store and the updated rewrite menu.
- [x] 9. Build, test, and smoke.
- [x] 10. Update AGENT.md and write section 7 below.

## 6. Updates

- **2026-09-07** — Task opened. Four questions asked and answered before any code was written.
- **2026-09-07** — All ten tasks shipped. 103 unit tests pass (11 of them new), `npm run local:smoke` painted three
  non-blank dock frames, and the app window was launched and screenshotted on the Home page. The
  History and Stats pages were not screenshotted: the window opens behind the foreground app, and
  `PrintWindow` returns a blank bitmap for an occluded Electron window — proved by capturing the Home
  page the same way and also getting blank, while the always-on-top dock captured fine. Forcing the
  window forward would have disturbed another session running on the same desktop.

## 7. Explanation

### 7.1 What changed

Four things, in one pass:

1. **The rewrite menu lost its More button.** All eight actions now render together in a four-column
   grid of compact buttons.
2. **Dictations are now recorded** to a local file, when the new `historyEnabled` setting is on.
3. **The Settings window became the app window** — a left sidebar with Home, History, Stats, and
   Settings, one page visible at a time.
4. **History and Stats pages exist**, both reading the same file.

### 7.2 Why it was needed

- Three of the eight rewrite actions were one click and five were two clicks, for no reason a user
  could see. The layering was a design guess that did not survive contact with real use.
- There was no way to see what you had dictated. Once text was pasted it was gone: logs redact it and
  the audio is deleted. Nothing could answer "what did I say" or "how much do I dictate".
- The app had one form and no home. Wispr Flow has a real app window; BayanFlow had a settings page.

### 7.3 How it works, step by step

**The rewrite menu.** `REWRITE_ACTIONS` used to carry a `layer` field, 1 for visible and 2 for hidden
behind More. That field is deleted. `getDockMenuActions()` now returns only `{ id, label }`, the dock
renderer drops them all into one `.action-grid`, and CSS lays that out as four equal columns. The
buttons get `.btn-compact`: smaller font, less padding, ellipsis on overflow — and an unchanged
`min-height: var(--bf-hit)`, which is the 32px minimum click target this project holds itself to.

**Recording a dictation.** `startRecording()` stamps `recordingStartedAt`. When `stopRecording()` has
a transcript and a polished result, and before it pastes anything, it calls
`historyStore.append({ seconds, app, raw, polished })`. The call is deliberately not awaited: `append`
is written so it can never reject, and history must not put a single millisecond in front of the paste.
The duration stored is microphone-open time, measured from the recording start to the moment the stop
began, so transcription and polish time are not counted as speaking.

**The store.** `src/history/history-store.ts` writes JSON Lines to `history.jsonl` under the Electron
user data directory. One line per dictation: id, timestamp, seconds, words, chars, target app title,
raw transcript, polished text. JSON Lines rather than one big array for two reasons: an append is a
single `appendFile`, and a half-written last line from a crash can be dropped while the rest of the
file still parses — there is a test that tears the last line off and asserts the earlier rows survive.
After each append the file is trimmed to the newest 500 rows.

**Stats.** `summarize()` walks the entries once and derives everything: totals, average speaking rate,
minutes of typing avoided at 40 words per minute, longest dictation, days used, the current streak,
a fixed seven-day activity series, and the top five target apps. It is a pure function taking `now` as
an argument, so every number is unit-tested without a clock or a disk. There is no separate counter to
drift out of sync with the list, and clearing history genuinely resets the stats.

**The window.** `SettingsWindow` registers four extra IPC channels: `history:list`, `history:stats`,
`history:remove`, and `history:clear`. They are read-and-delete only — nothing the renderer can call
writes a new entry — and every one runs the same `assertSender` check the settings channels use, so
only this window web contents can reach them. All four are removed when the window closes, matching
the existing pattern.

**The pages.** `settings.js` keeps one `.page` visible and hides the rest. Home shows four tiles
(words today, streak, all-time words, typing time saved), the setup checklist, and the two hotkeys.
History lists entries newest first; each row is a native `<details>` element, so opening one is browser
behaviour rather than state this code has to track, and only the open rows lay out their full text.
Opening a row shows what you said next to what was inserted, each with a Copy button, plus the target
app and a Delete button. A search box filters the loaded list in memory. Stats shows six tiles, a
seven-day bar chart built from divs, and a top-apps list with meters. Both pages reload from the store
every time you navigate to them, so a dictation made while the window sat open is never missed.

### 7.4 Files and functions changed

| File | What it does now |
|---|---|
| `src/rewrite/rewrite-actions.ts` | `RewriteAction` lost `layer`; `getDockMenuActions()` returns `{ id, label }`. |
| `src/overlay/overlay-state.ts` | `DockMenuAction` lost `layer`; the `menu` view lost `expanded`. |
| `src/renderer/dock.html` | One `#menuActions` grid replaced the primary row and the secondary grid. |
| `src/renderer/dock.js` | `renderMenu()` renders every action; `createMoreButton()` deleted. |
| `src/renderer/dock.css` | `.action-row` gone; `.action-grid` is four columns; new `.btn-compact`. |
| `src/history/history-store.ts` | New. `HistoryStore` (append, list, remove, clear, stats, trim) plus pure `summarize`, `countWords`, `dayKey`. |
| `src/types.ts`, `src/config-store.ts` | New `historyEnabled` setting, defaulting to on. |
| `src/main.ts` | Creates the store, stamps `recordingStartedAt`, appends on every successful dictation, passes the store to the window. |
| `src/settings-window.ts` | Four history IPC handlers, their teardown, and the window title is now "BayanFlow". |
| `src/renderer/settings-preload.js` | Exposes `historyList`, `historyStats`, `historyRemove`, `historyClear`. |
| `src/renderer/settings.html` | Rebuilt: sidebar plus four pages. |
| `src/renderer/settings.js` | Page switching, history list and search, entry rows, copy, delete, stats tiles, chart, top apps. |
| `src/renderer/settings.css` | Sidebar and page shell, tiles, history rows, chart, meters, status bar. |
| `tests/history-store.test.mjs` | New. 11 tests: round trip, empty text, ordering, delete, torn line, the 500 cap, streaks, buckets, stats maths. |
| `tests/rewrite-actions.test.mjs` | The three-visible-actions test became a no-layering test. |

### 7.5 Important decisions

- **Storing speech at all.** Everything else in this app is built so spoken text cannot be recovered.
  History reverses that in exactly one file, because History and Stats are impossible otherwise. The
  boundaries — one file, no logs, no diagnostics export, an off switch, a Clear button, a 500 cap — are
  what make it a trade rather than a leak, and they are written into the file header and AGENT.md so a
  future session does not "fix" it.
- **Plain JSON, not encrypted.** The API key is encrypted because it is a credential that can be spent.
  A transcript sitting in your own profile directory is already behind the Windows account boundary, and
  encrypting it would have made the file impossible to read or export by hand for no real gain.
- **Stats derived, never counted.** A running counter would be less work per read and one more thing to
  drift. One pure function over the rows cannot disagree with the list the user is looking at.
- **Keeping the 32px button height.** Fitting all eight actions in one row needed 26px buttons. The
  padding and font gave back enough room for four columns without touching the height, so two tidy rows
  beat one cramped one.
- **One window, not two.** A separate History window would have meant a second lifecycle, a second IPC
  surface, and two places to look. The sidebar is also what Wispr Flow actually does.
- **`<details>` instead of a JS accordion.** Native open and close, native keyboard and screen-reader
  behaviour, no state to track.

### 7.6 Tests and verification

- `npm run build` — clean, no TypeScript errors.
- `npm test` — **103 tests pass, 0 fail**, including 11 new history-store tests.
- `npm run local:smoke` — passed: "Electron stayed alive for 8 seconds, wrote startup log, and painted
  3 non-blank dock frame(s)."
- Launched the real app against an isolated user data directory and screenshotted it: the window opens
  with the sidebar, Home renders the tiles, the setup callout, the checklist, and the hotkey card. No
  renderer errors in the app log.
- Static check: every `getElementById` in `settings.js` resolves to an id in `settings.html`, and every
  class it creates has a CSS rule.
- **Not verified visually: the History and Stats pages.** See the note in section 6. The logic behind
  them is covered by the unit tests, but the rendering has not been seen on screen.

### 7.7 Edge cases and limitations

- History records dictations only. Rewrites are not stored, so Stats are purely about speaking.
- Turning `historyEnabled` off stops new entries but keeps old ones. Clear all is the delete.
- The 500-entry cap is silent. Entry 501 drops the oldest with no warning.
- A single stored transcript is clipped at 20,000 characters.
- Search runs over the loaded list in memory. Fine at 500 rows; it would need rethinking at 50,000.
- "Typing time saved" compares against a fixed 40 words per minute. It is a comparison, not a
  measurement, and the interface says so.
- The duration recorded is microphone-open time, so a long pause before you speak counts as speaking
  and drags the words-per-minute average down.
- If two BayanFlow instances ever wrote at once, the trim could lose an entry. The app takes a single
  instance lock, so this cannot currently happen.
- The window still opens at 920x760. Below roughly 1000px wide the home tiles drop to two columns and
  the entry comparison stacks vertically.

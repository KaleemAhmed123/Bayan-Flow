# Settings tabs and layout

## 1. Task

- **Name:** Settings tabs and layout
- **Status:** shipped
- **Started:** 2026-09-10
- **Last updated:** 2026-09-10

## 2. What you asked for

> "Arrange settings page layout better make tabs so I dont have to look for things
> make great UX act like UI/UX expert"

Constraints taken from that:

- **Tabs are required.** Not an accordion, not a longer scroll.
- **Finding a setting must be fast.** "So I don't have to look for things" is the
  acceptance test, not the tab count.
- Act as a UI/UX expert: the grouping and the copy are part of the job, not just
  the markup.

## 3. Audit of what exists today

`src/renderer/settings.html`, the `#page-settings` section. 22 controls plus one
read-only status list, in a single scrolling column.

| Card today | Controls |
|---|---|
| Access | API key, microphone, dictation hotkey, rewrite hotkey, reserve-hotkey toggle |
| Behaviour | pill, auto paste, polish, start at login |
| History and stats | history toggle |
| Language and vocabulary | spoken language, paste language, custom vocabulary |
| Screen context | context capture, window screenshot, keep exact words, AI-answer guard, debug capture, blocklist |
| Advanced models (`<details>`) | transcription, cleanup, context, fallback models |
| Rail (sticky, 280px) | health list, read-only |

### Findings

1. **Miscategorised controls.** "Keep my exact words", "Protect against the AI
   answering you" and "Capture dictations for debugging" sit under **Screen
   context**. None of them read the screen. A user looking for exact-wording
   will not open a card called Screen context.
2. **Help text outweighs the control.** Every toggle carries a 3-5 line
   paragraph that is always visible. The page cannot be scanned, only read.
3. **The status rail costs half the window.** `.grid` is
   `minmax(0,1fr) 280px` and the window is 920px wide with a 216px sidebar, so
   the form gets roughly 376px. The `@media (max-width: 880px)` collapse never
   fires at the real window size. The rail is read-only diagnostics; it is not
   why anyone opens Settings.
4. **No search.** The only way to find a setting is to read the page.
5. **Save is at the bottom of the scroll.** After a change near the top you must
   scroll to the end to commit it.

## 4. Open questions

| # | Question | My recommendation | Your answer |
|---|---|---|---|
| 1 | Which tab split? | The five below. Named by the job the user came to do, not by the subsystem. | **Approved** |
| 2 | Where does the read-only status list go? | **Home page**, beside the setup checklist. "Is it working" is a Home question; Settings is for changing things. This also frees the full width. | **Home page** |
| 3 | Long help text? | Keep a **one-line** summary always visible, move the long tail behind a `More` expander on the six items that need it. Nothing is deleted. | **One line + More** |
| 4 | Auto-save on change instead of a Save button? | **No.** Saving re-registers global hotkeys in the main process; a half-typed hotkey must not be applied. Keep an explicit Save, but make the bar sticky and show an unsaved-changes marker. | **Keep Save, sticky bar** |

## 5. Plan

### Tab split

Five tabs, each named for a job:

| Tab | Contains | Why here |
|---|---|---|
| **General** | Groq API key, microphone + Test microphone, start at sign-in, keep the pill on screen, paste straight into the app | The make-it-work tab. First stop for a new user and for "it stopped working". |
| **Shortcuts** | Dictation hotkey, rewrite hotkey, reserve the hotkey from other apps (+ its live note) | One job. Nobody hunting for a hotkey should read anything else. |
| **Dictation** | Spoken language, paste language, polish with AI, keep my exact words, guard against the AI answering, custom vocabulary | Everything between "what you said" and "what lands in the box". Fixes finding 1. |
| **Privacy** | Keep history, use the app you are typing into, send a picture of the window, never-look-at list, capture dictations for debugging | Every control that decides what is stored or what leaves this machine, in one place. Fixes finding 1. |
| **Advanced** | Transcription, cleanup, screen-context and fallback model names | Power users only. The tab is the disclosure, so the `<details>` wrapper goes. |

### Beyond tabs

Tabs alone do not meet "so I don't have to look for things" — five tabs still
means guessing which one. So:

- **A search box in the Settings header.** Typing filters every row across all
  five tabs at once and labels each hit with the tab it lives in. Empty box
  returns to normal tabs.
- **Sticky save bar** with an unsaved-changes marker, so Save is always reachable
  and you can always tell whether you committed.
- **Shorter help**, one line plus `More`, per open question 3.
- **Full-width form** once the status rail leaves.
- **Real tab semantics**: `role="tablist"`, arrow-key movement, `aria-selected`.

### Files touched

- `src/renderer/settings.html` — rewrite the `#page-settings` section only. Move
  the health list into `#page-home`. Every input `id` is unchanged.
- `src/renderer/settings.css` — append tab, search and sticky-save rules.
- `src/renderer/settings.js` — add sub-tab navigation, search filtering, dirty
  tracking. `fields`, the load handler and the save handler are untouched.

### Deliberately NOT changing

- Any input `id`, so `fields{}`, load and save keep working as-is.
- The main sidebar (Home / History / Stats / Debug / Settings).
- What any setting does. This is layout and copy only, no behaviour change.
- The in-flight Debug page in the working tree.
- Auto-save. See open question 4.

### Rejected

- **One long page with anchor links.** Still one scroll; you were explicit about tabs.
- **Accordion sections.** Better than today, but every section still costs a click
  and the page still grows without bound.
- **Health as a sixth tab.** A user whose app is broken will not look in Settings
  for a diagnosis. Home is where they already land.

## 6. Tasks

- [x] 1. Rewrite `#page-settings` as five tab panels
- [x] 2. Move the health list to the Home page
- [x] 3. Shorten help copy, long tail behind `More`
- [x] 4. CSS for tabs, search, sticky save bar
- [x] 5. JS: sub-tab nav with arrow keys
- [x] 6. JS: cross-tab search filter
- [x] 7. JS: dirty tracking on the save bar
- [x] 8. `npm run build`, launch, verify every control still saves

## 7. Updates

- **2026-09-10** — Spec written. Awaiting approval on the four open questions.
- **2026-09-10** — All four answers approved as recommended. Implementation started.
  Noted in passing: the working tree carries an unfinished Debug page — `#page-debug`
  exists in `settings.html` but `settings.js` has no `debug` key in its `pages` map, so
  that nav button is inert. Left untouched by this task.

## 8. Explanation

### 1. What changed

The Settings page went from one 22-control scroll to **five tab panels plus a
search box that filters across all five at once**. The read-only status list
moved off Settings and onto Home. Save became a sticky bar that says whether
anything is uncommitted.

Nothing any setting *does* changed. Every input kept its `id`, so the main
process receives exactly the same payload it did before.

### 2. Why it was needed

Five concrete problems, all listed in section 3 above. The two that mattered
most: three controls were filed under a heading that did not describe them
("Keep my exact words" under *Screen context*), and a 280px status rail squeezed
the form into roughly 376px of a 920px window.

### 3. How it works, step by step

**Browsing.** The tab strip is a `role="tablist"` of five buttons. Clicking one
calls `showTab(name)`, which sets `hidden` on the four panels that do not match
`data-tab`, flips `aria-selected`, and moves the single `tabindex="0"` onto the
chosen tab. That last part is a *roving tabindex*: the whole strip is one Tab
stop, and Left/Right/Home/End move between tabs inside it, which is how a real
tab control behaves.

**Searching.** Typing in the box runs `applySettingsSearch()`. For each row — a
`.field` or a `.toggle` — it builds a haystack from the row's own `textContent`
plus its `data-keywords`, and sets `hidden` on rows that do not contain the
query. A card with no visible rows hides; a panel with no visible cards hides.
The tab strip hides too, and each surviving panel shows its `.panel-tag`
heading, so results read as "DICTATION → Language → Spoken language" rather than
as a flat list you cannot place.

Two details make the search feel like it knows more than it does:

- A `<select>` owns its `<option>` elements, so `textContent` already contains
  every language name. Typing `urdu` finds both language rows with no extra work.
- `data-keywords` carries only the words that are *not* on screen — `blacklist`
  for the blocklist, `shortcut` for the hotkeys, `ollama` for the base URLs.

Search never rewrites the DOM. It only toggles `hidden`, so every input keeps
its element, its id, its listeners, and whatever the user has typed into it.
Clearing the box calls `showTab(activeTab)` and puts the previous tab back.

**Saving.** `markDirty()` runs on `input` and `change` for every entry in
`fields`. A fresh page load assigns ~28 values with `.value =` and `.checked =`,
which fire no events, so the bar stays clean until the user actually edits
something. `markClean()` runs only after a save resolves. Navigating away from
Settings while dirty raises the existing status toast, because the save bar
leaves with the page.

### 4. Files and functions changed

**`src/renderer/settings.html`**

- `#page-settings` rewritten: search box, five `.tab` buttons, five `.panel`
  sections, sticky `footer.savebar`.
- A `<section class="card">` holding `<ul id="health">` added to `#page-home`.
- `#setupNotice` gained an **Add key** button that jumps to Settings → General
  and focuses the key field.
- Toggles changed from `<label class="toggle">` wrapping everything to
  `<div class="toggle">` with the title carrying the `for`. Necessary: a
  `<details>` inside a `<label>` would flip the checkbox on every click of its
  summary.

**`src/renderer/settings.css`**

- Deleted `.grid`, `.column`, `.rail` and the `@media (max-width: 880px)` rule —
  dead once the rail left.
- Deleted the `border-top` from base `.toggle` and the
  `.card .toggle:first-of-type` undo; separators are now
  `.toggle-list > .toggle + .toggle`, which needs no undo rule.
- Moved the trailing scroll gutter from `.content` to `.page`. See decision 3.
- Added: `.searchbox`, `.tabs`/`.tab`, `.panels`/`.panel`/`.panel-tag`,
  `.field-row`, `.field-pair`, `.toggle-list`, `.more`, `.savebar`,
  `.save-state`, `.sr-only`, and first-time rules for `select`, `textarea`,
  `input[type="number"]` and `code`.

**`src/renderer/settings.js`**

- Added `showTab`, `applySettingsSearch`, `markDirty`, `markClean`, tab
  click/keydown handlers, Ctrl+S to save, Ctrl+F to focus search, and the
  setup-notice jump.
- `showPage()` now warns when leaving Settings dirty.
- The save handler calls `markClean()` on success.
- `renderSetupChecklist` copy fixed: the mic Test button is no longer "at the
  top of the Settings page".

### 5. Important decisions

1. **Search, not just tabs.** Five tabs still means guessing which one. The
   search box is what actually answers "so I do not have to look for things".
2. **Toggle is a `<div>`, not a `<label>`.** The `More` expander lives inside
   the toggle; inside a `<label>` every click on its summary would also flip the
   checkbox. Verified in the browser.
3. **The scroll gutter moved from `.content` to `.page`.** A scroll container's
   bottom padding sits outside its scrollport, so a `position: sticky;
   bottom: 0` child comes to rest that many pixels *above* the window edge. The
   save bar was floating 72px up with cards visible below it. Measured at
   `barBottom: 688` against a `760` viewport, fixed, re-measured at `760`.
   `#page-settings` gets `padding-bottom: 0` because it ends in the bar itself.
4. **Explicit Save kept.** Saving re-registers global hotkeys in the main
   process, so a half-typed hotkey must never be applied. Rejected auto-save.
5. **Status went to Home, not a sixth tab.** Someone whose app is broken does
   not open Settings for a diagnosis; they are already on Home, next to the
   setup checklist.
6. **Rejected:** anchor links on one long page, and an accordion. Both keep the
   unbounded scroll.

### 6. Tests and verification

- `npm run build` — clean.
- `npm test` — **269 passed, 0 failed.**
- `node --check src/renderer/settings.js` — clean.
- Static check: no duplicate element ids; all 23 config field ids present
  exactly once; each resolves to exactly one tab panel.
- **Driven in a real browser** at the shipped 920x760 window size, against a
  stubbed `settingsBridge`. Confirmed:
  - Search `screenshot` returns hits from Privacy *and* Advanced; `blacklist`
    (a keyword that appears nowhere on screen) finds the blocklist; `urdu` finds
    both language selects; `zzzz` shows the empty state; clearing restores the
    previous tab and all rows.
  - Clicking a `More` summary does not flip its checkbox; clicking the title does.
  - Dirty marker: clean on load → "Unsaved changes" on edit → clean after save →
    warning toast when leaving Settings dirty.
  - The screenshot toggle still disables itself when its parent is off.
  - Arrow-Right and End move tabs; `aria-selected` and roving `tabindex` follow.
  - Save bar bottom edge measured at `760` against a `760` viewport.
  - The status list renders 9 rows on Home.

### 7. Edge cases and limitations

- **Search is a plain substring match.** No fuzzy matching, no stemming — a typo
  finds nothing. `data-keywords` covers the synonyms that matter today; a term
  nobody thought of will miss.
- **Search does not highlight the matched text**, it only filters rows.
- **The dirty marker is set-only per session.** Editing a field and typing the
  original value back still reads as unsaved. Tracking real equality would mean
  snapshotting 28 values on load for very little gain.
- **Leaving Settings dirty warns but does not block.** Deliberate: a modal that
  traps you on a settings page is worse than a toast.
- **Ctrl+F only works while Settings is open.** Elsewhere it is left alone rather
  than yanking the user off the page they are on.
- **Tabs are not deep-linkable.** Only the setup notice jumps to a specific tab.
  If the main process ever needs to open Settings at a named tab, `showTab` is
  the hook.

## 9. Updates (continued)

- **2026-09-10** — Shipped. While this was in flight, a parallel session
  committed `52ad9c3` ("configurable base URLs and per-stage timeouts"), which
  swept this task's html/css/js in alongside its own work and added five new
  fields into the Advanced panel. That merge left three regressions, all fixed
  here:
  1. The new *Where the models run* card used `class="grid"`, a rule this task
     had deleted as dead. Its five fields rendered with no layout at all.
     Changed to `.field-pair`, which is what the card wanted.
  2. `input[type="number"]` had never been in the input selector, so the three
     new timeout fields rendered as default light browser inputs in a dark UI.
  3. `<code>` in the new base-URL help copy had no rule behind it.

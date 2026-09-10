# Settings tabs and layout

## 1. Task

- **Name:** Settings tabs and layout
- **Status:** planned
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
| 1 | Which tab split? | The five below. Named by the job the user came to do, not by the subsystem. | |
| 2 | Where does the read-only status list go? | **Home page**, beside the setup checklist. "Is it working" is a Home question; Settings is for changing things. This also frees the full width. | |
| 3 | Long help text? | Keep a **one-line** summary always visible, move the long tail behind a `More` expander on the six items that need it. Nothing is deleted. | |
| 4 | Auto-save on change instead of a Save button? | **No.** Saving re-registers global hotkeys in the main process; a half-typed hotkey must not be applied. Keep an explicit Save, but make the bar sticky and show an unsaved-changes marker. | |

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

- [ ] 1. Rewrite `#page-settings` as five tab panels
- [ ] 2. Move the health list to the Home page
- [ ] 3. Shorten help copy, long tail behind `More`
- [ ] 4. CSS for tabs, search, sticky save bar
- [ ] 5. JS: sub-tab nav with arrow keys
- [ ] 6. JS: cross-tab search filter
- [ ] 7. JS: dirty tracking on the save bar
- [ ] 8. `npm run build`, launch, verify every control still saves

## 7. Updates

- **2026-09-10** — Spec written. Awaiting approval on the four open questions.

## 8. Explanation

_Written when the work ships._

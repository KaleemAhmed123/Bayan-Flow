# Theme and mark

## 1. Task

| | |
|---|---|
| **Name** | Theme and mark — "Terminal" palette, a new icon, and a density pass |
| **Status** | Phase 1 and Phase 2 shipped |
| **Started** | 2026-09-15 |
| **Last updated** | 2026-09-15 |

## 2. What you asked for

Your words, kept so nothing is lost to chat scrollback.

> I wanna give minimalistic hacker like premium feeling ... it must look premium and serious not
> casually made on weekend

On the four theme directions I showed you:

> Theme directions => B Terminal

On the logo:

> The Mark we need better icon you can generate according to theme and serious one
> Pill, beh (. a little below it looks attached), voice to text ok

and then, after the second round:

> we can use a different color instead of blue that closely matches with our theme and pill lamp left

On the buttons:

> The button pass a little less padding on verticals so we save some space especially on the chips we
> get after clicking the polish

and then:

> 28

On what comes next:

> you can work on making the settings and onboarding page according to our style we started our work
> with serious, minimalist and professional and great UX and everything else that comes along it's way

### Constraints carried in from these

- **Serious, not casual.** Minimal and premium, not playful.
- **The mark gets a colour that belongs to the theme.** Not blue — the old icon's blue was one of the
  reasons it read as foreign to the app.
- **Chips at 28px**, accepted knowingly against the 32px comfort floor (see the open question below).
- The **release is held** until the new mark is in, so v0.2.1 ships carrying the new identity rather
  than publishing the old blue icon and replacing it a day later.

## 3. Open questions

Each with my recommendation, and your answer where you have given one.

| # | Question | My recommendation | Your answer |
|---|---|---|---|
| Q1 | Which theme direction? | B Terminal — it is the brief you described, and "no colour except the live signal" is discipline cheap software never has | **B Terminal** |
| Q2 | Which mark? | The pill — the product *is* a pill at the bottom of the screen, so the mark is self-referential and survives 16px | **The pill** |
| Q3 | Lamp centred or left? | Left — it reads as an indicator lamp on a device rather than a hole in a shape | **Lamp left** |
| Q4 | What colour for the lamp? | The theme's own signal green `#3fe08a` — the same green that means *recording* in the app, so the icon is literally the product's pill with its live lamp lit | **Answered as "a colour that matches the theme"; I took the signal green.** Flagged out loud rather than assumed silently |
| Q5 | Chip height, 28px or 30px? | 30px, because 28 goes under your own `--bf-hit` comfort floor | **28px** — your call, taken |
| Q6 | Density pass on the settings window too? | Not blindly. Settings is a window you sit in, the dock is glanced at | **Covered by "work on settings and onboarding" — treated as its own phase, see below** |
| Q7 | Does an onboarding page exist to restyle? | — | **No.** Investigated: there is no onboarding window. There is a `setupChecklist` on the settings Home page and `onboarding.step.completed` logging in `main.ts`. Building one is new work, not a restyle — so it is phased separately |

## 4. Plan

### Why this is cheap

Two findings from reading the code first, both of which shrink the work:

1. **`settings.css` and `dock.css` contain zero hardcoded hex colours.** Every colour already routes
   through `tokens.css`. Changing the tokens re-themes both windows completely.
2. **Pillow 12.2.0 is available on this machine**, so a proper multi-size `.ico` can be rasterised
   rather than hand-waved.

### Phases

**Phase 1 — theme, density, mark.** Fully specified by your answers; no further design input needed.

- Rewrite the palette half of `tokens.css` to Terminal. Structure, spacing and radius names stay.
- Density: `.bar` and `.panel` in `dock.css` only.
- Generate the mark at seven sizes, each drawn at its own size rather than downscaled from one.

**Phase 2 — settings and onboarding.** Deliberately *not* started in the same change. Phase 1 restyles
the settings window for free (it shares the tokens), which means Phase 2 can be judged against a
settings window that is already in the new palette, instead of guessing twice. Onboarding is new
product surface and gets designed before it gets built.

### Files this touches — Phase 1

| File | Change |
|---|---|
| `src/renderer/tokens.css` | Palette swapped to Terminal. One new token: `--bf-font-mono`. Radii tightened |
| `src/renderer/dock.css` | Density only: `.bar`, `.panel`, `.action-grid`, `.btn-compact`. Timer set in mono |
| `src/assets/tray-icon.ico` | Regenerated: 16/20/24/32/48/64/256, each drawn at its size |
| `build/installerHeaderIcon.ico` | Regenerated to match. Currently a different 14 KB file that does not match the app icon |
| `build/*.bmp` | Installer header and sidebar art regenerated in the Terminal palette |
| `scripts/make-icons.py` | New. Generates every icon and installer bitmap from one geometry definition |
| `tests/*.test.mjs` | Guards for the things that silently rot: token presence, icon size set |

### Deliberately NOT changing

- `--bf-hit: 32px` stays. Only `.btn-compact` drops to 28px; every standalone button keeps its target.
- The dock's **structure and sizing logic**. This is a palette and spacing change, not a layout change.
- `settings.css` — it inherits the theme through the tokens. Its own spacing is Phase 2.
- The **violet is not kept anywhere.** No second accent sneaks back in.

### Alternatives rejected

- **A Graphite (Apple-style).** Safe, and the least distinctive — a hundred menu-bar apps already look
  like it.
- **C Iris Refined.** Zero risk, but it does not answer the brief you actually gave.
- **D Signal (amber).** The most distinctive, and a strong flavour to live with daily. Parked, not dead.
- **A transparent tray glyph instead of a tile.** Rejected on evidence: Windows draws the `.ico` as-is
  and does not recolour it per taskbar theme, so a bare white mark disappears on a light taskbar. One
  file serves the tray, both windows, the app icon and the installer, so it must carry its own ground.
- **Adding `sharp` or `jimp` to generate icons.** A new runtime dependency to redraw a file that
  changes once a year. Pillow is already on the machine and the script is not part of `npm run build`.

## 5. Tasks

- [x] 1. Swap the palette in `tokens.css` to Terminal, add `--bf-font-mono`, tighten radii
- [x] 2. Density pass in `dock.css` — bar 52→44, chips 32→28, panel padding and gaps
- [x] 3. Set the dock timer in mono
- [x] 4. Write `scripts/make-icons.py` — one geometry definition, all outputs
- [x] 5. Regenerate `src/assets/tray-icon.ico` at seven sizes
- [x] 6. Regenerate the NSIS installer art so it matches the app
- [x] 7. Add tests guarding the token set and the icon's size list
- [x] 8. `npm run build && npm test && npm run local:smoke`
- [x] 9. `npm run dist && npm run packaged:smoke`
- [x] 10. Phase 2: design settings + onboarding, get sign-off, then build
- [x] 11. Fix the white-as-data-ink regression (findings 01)
- [x] 12. Findings 02-07
- [x] 13. Build the three-step first-run view
- [x] 14. Guard the CSP trap and the first-run wiring with tests

## 6. Updates

### 2026-09-15 — spec opened

Four theme directions and three marks were put on a decision page and rendered with the app's real
dock markup at real size, rather than described in prose. You picked B Terminal and the pill.

Two things were found by looking rather than reasoning, and both changed the design:

**A bare white mark disappears on a light Windows taskbar.** Windows does not recolour tray icons the
way macOS does — whatever is in the `.ico` is what gets drawn. Every mark therefore carries its own
near-black tile. Confirmed that one file (`src/assets/tray-icon.ico`) serves the tray, the settings
window, the recorder window, the app icon and the installer, so it has to work as an app tile too.

**The current `.ico` holds exactly one image, 256×256, 32bpp.** Verified by reading the file's
directory header, not assumed. Windows downscales that single image to 16px for the tray, which is why
thin gradient line art with five elements turns to smudge.

### 2026-09-15 — a claim of mine was wrong, corrected here

On the decision page I said setting the timer in a monospace face would fix a twitching timer. It would
not: `dock.css` already sets `font-variant-numeric: tabular-nums` on `.timer`, and Segoe UI honours it.
The digits do not jitter today. **Mono is a style choice that serves the Terminal read, not a bug fix**,
and it is recorded here as such so nobody later believes a bug was closed.

### 2026-09-15 — Phase 1 built and verified

The first icon draft **looked like a settings toggle**. A white pill with a large dot on one side is
the universal iOS switch, and the small-size tuning had made the lamp even more knob-like. This was
caught by rendering the `.ico` to a contact sheet and looking at it, not by reasoning about it.

Fixed by proportion rather than by changing the design: a toggle knob fills the pill's height, a lamp
does not. Five variants were rendered side by side; the winner moved the pill from 2.2:1 to 3:1 and
dropped the lamp to roughly 42% of the pill's height, which gives it visible white margin. That ratio
is now written down in `scripts/make-icons.py`, because it is the thing that must not drift.

A second problem surfaced from measuring rather than looking: at 16px the pill straddled half pixels,
so the downsampler handed it grey blend rows top and bottom — the exact soft-edged look this work
exists to remove. Every small size now uses geometry that lands on whole pixels, and a test asserts
there are zero blended rows.

**One regression caught before it shipped:** the new installer header banner was drawn dark. The
previous art was white, verified by reading its corner pixels, and that was correct — NSIS draws its
header bar light and prints the page title beside the bitmap in dark text, so a dark banner floats
there as an obvious rectangle. The header is white again, with the dark tile providing the contrast.
The sidebar was already dark in the old art and stays dark.

### 2026-09-15 — Phase 2 opened: settings and first run

Every settings page was rendered with a stubbed bridge and realistic data — 214 dictations, a real
history, a real debug capture — and looked at. Seven findings, one of them a regression from Phase 1.

**Your answers:**

| # | Question | Your answer |
|---|---|---|
| Q8 | Fix the white-as-data-ink regression? | **Yes** — white for primary actions only, muted token for data |
| Q9 | Which UX findings? | **All of them** (02–07) |
| Q10 | Is the three-step first run right? | **Yes** |
| Q11 | Does first run stay reachable afterwards? | **Vanish** — the Home checklist is the permanent record |
| Q12 | The idle pill | **More padding, slightly bigger text** — "just a little" |

**The findings:**

1. **White is doing two jobs** *(my regression)*. `--bf-accent` became paper-white in Phase 1, and the
   accent also paints checkbox fills, chart bars and progress meters. White on near-black is the
   highest contrast available, so the bar chart outshouts every heading on Stats and four checkboxes
   dominate Privacy. Fix: new `--bf-data` / `--bf-data-strong` tokens for anything encoding a
   quantity; checkboxes get a dark fill with a white tick. White then means only "primary action".
2. **"Get started" never leaves** — permanently expanded, and its subtitle says "Four steps" above
   five items.
3. **A disclosure disguised as an achievement** — "Know what is on by default" is hardcoded
   `done: true` and wears the same green tick as steps the user actually completed.
4. **Status is below the fold**, and it is the only place that confirms the key is present and the
   hotkey registered.
5. **Six stat tiles wrap to 4+2 with a hole.**
6. **Chart values float at the top of the column** rather than sitting on their bars.
7. **The History heading collides with "Clear all"**, orphaning the word "only." on its own line.

**A correction to my own finding.** On the decision page I said finding 5 was caused by the tile grid
being "fixed at four columns". It is not — `.tiles` is already
`repeat(auto-fit, minmax(180px, 1fr))`. The symptom is real, but the cause is that six items in a grid
sized for four leave a two-tile gap. The fix is therefore not "make it auto-fit" but to let the tile
count pick the track width, so six tiles resolve to 3×2 at this window width.

**First run: there is no missing window.** `main.ts` already opens the settings window automatically
when there is no API key, shows a tray balloon and logs it. The problem is where it lands: Home is a
dashboard that greets a brand-new user with "Welcome back", "0 words today" and a "0 day streak", then
hands them a checklist whose every item points somewhere else. The fix is a first-run **view** that
replaces Home until setup is done — same window, same bridge, no new window class and no new IPC —
where **each step contains the actual control** instead of directions to it.

Three steps: key, microphone, say something. Step 3 needs no button, because `didDictate` already
flips when a dictation genuinely succeeds, so the view can show the hotkey and advance itself. Every
step is skippable, and once dismissed the view never returns.

## 7. Explanation

### What changed

BayanFlow's visual identity moved from "Ink & Iris" — near-black with a violet accent — to
**Terminal**: near-true black, warm paper-white text, no accent hue at all, and exactly one colour in
the whole product. The dock's vertical spacing tightened. The icon was replaced with a new mark and,
for the first time, is a real multi-size `.ico`.

### Why it was needed

Two reasons, one taste and one a plain bug.

The taste one: you asked for something that reads as serious and premium rather than made on a
weekend. The violet was fine but generic, and the old icon — a gradient head with a brain, a headset,
a speech bubble and soundwaves, in blue — said "an AI app" rather than "BayanFlow", and clashed with
an interface that had no blue in it.

The bug: **the old `.ico` contained exactly one image, 256×256.** Windows was shrinking that single
image to 16px for the tray, and thin gradient line art with five elements does not survive that. A
correct `.ico` carries a separate, hand-tuned drawing per size.

### How it works, step by step

**The theme.** `tokens.css` is the single place any colour is defined — verified, not assumed: a test
now asserts that `dock.css` and `settings.css` contain zero hex values between them. So re-theming the
product is a rewrite of one file's palette section. The structural idea is that **there is no accent
hue any more**: `--bf-accent` is paper-white `#e7e7e3` and `--bf-accent-text` is near-black, so every
primary button inverts to black-on-white instead of wearing a colour. The single chromatic value left
is `--bf-live: #3fe08a`, which appears on the recording dot and the listening waveform and nowhere
else. Danger red survives because "something went wrong" must not be signalled by text alone, but it
is a dot, never a fill.

**The density pass.** Only the dock changed. `.bar` went from a 52px minimum to 44px, which is not a
taste number: a 32px control plus 6px of padding each side is exactly 44, and the old 52 was eight
pixels of air with nothing in it. The Polish panel's padding went 12→10, its internal gap 8→6, and the
chip grid's gap 6→5. The chips went from 32px to 28px. That last one is the only control in the app
that goes under `--bf-hit`, your comfortable-click floor, and it is marked as a deliberate exception
in the CSS with a note that 30px is the fallback if a chip ever feels fiddly. 28px is still above the
WCAG 2.2 minimum target size of 24px.

**The mark.** `scripts/make-icons.py` holds one geometry definition — a dark rounded tile, a
paper-white pill, a green lamp on the left — expressed on a 32×32 grid. For each output size it scales
that geometry, renders at eight times the target size, and downsamples with Lanczos filtering. Two
things make it more than a resize loop. Small sizes get **tuned geometry**: the pill is proportionally
fatter at 16px (38% of the tile versus 25% at 48px) so the lamp keeps enough pixels to read as a lamp.
And every small-size number is chosen so that, multiplied by size/32, it lands on a whole pixel, which
is what keeps the edges sharp rather than grey.

**The `.ico` writer is hand-rolled**, for two reasons. Pillow's own ICO export resizes a single source
image, which is precisely the bug being fixed. And entries 64px and under are written as uncompressed
32bpp DIBs rather than PNG, because NSIS does not reliably decode PNG-compressed entries for an
installer icon. Only the 256px entry is PNG, where it saves about a quarter of a megabyte. The DIB
writer handles the format's quirk correctly: an icon DIB declares double its real height, because the
bottom half is a 1bpp AND mask, and rows run bottom-up.

### Files and functions changed

| File | What it now does |
|---|---|
| `src/renderer/tokens.css` | Defines the Terminal palette. Accent is paper-white; `--bf-live` is the only hue. Adds `--bf-font-mono`. Radii tightened 8→6, 12→9, 16→11 |
| `src/renderer/dock.css` | `.bar` 44px min-height with 6px padding; `.panel` 10px padding, 6px gap; `.action-grid` 5px gap; `.btn-compact` pinned to 28px; `.timer` set in `--bf-font-mono` |
| `scripts/make-icons.py` | New. `draw_mark()` renders one size from the shared geometry; `write_ico()` assembles multi-size files; `_dib_entry()` encodes one uncompressed entry; `write_header_bmp()` and `write_sidebar_bmp()` produce the NSIS art |
| `src/assets/tray-icon.ico` | 7 sizes (16/20/24/32/48/64/256), each its own drawing. Serves the tray, both windows, the app icon and the installer |
| `build/installerHeaderIcon.ico` | Regenerated from the same geometry, so it can no longer drift from the app icon |
| `build/installerHeader.bmp` | White ground, dark tile, dark text — matches the light NSIS header bar |
| `build/installerSidebar.bmp`, `build/uninstallerSidebar.bmp` | Dark panels in the Terminal palette |
| `tests/theme-and-icons.test.mjs` | New. 10 static guards, listed below |

### Important decisions

- **No accent colour at all**, rather than swapping violet for another hue. Inverting the primary
  button to white-on-black is what makes the theme read as deliberate instead of merely recoloured.
- **The lamp is `--bf-live` exactly**, the same green that means recording. The icon is literally the
  product's own pill with its lamp lit. You asked for "a colour that matches the theme", and this is
  the only chromatic value the theme has, so it was the honest reading — but it was a judgement call
  and is recorded as one.
- **The mark carries its own dark tile**, rejecting a transparent glyph on evidence about how Windows
  draws tray icons.
- **Only the chips break the hit-target floor.** Rejected lowering `--bf-hit` itself, which would have
  quietly shrunk every button in both windows.
- **A Python script, not a new npm dependency.** `sharp` or `jimp` would be a permanent dependency to
  redraw a file that changes once a year.
- **Rejected letting Pillow write the `.ico`** — it would have reintroduced the original bug.

### Tests and verification

Everything below was run, with real output:

```txt
npm run build            -> exit 0, bundled dist/main.bundle.js (590 KB)
npm test                 -> tests 309 | pass 309 | fail 0     (299 -> 309)
npm run local:smoke      -> PASS, 3 non-blank dock frames
npm run dist             -> exit 0, BayanFlow-Setup-0.2.0.exe built, NSIS accepted the new icons
npm run packaged:smoke   -> PASS, startup success log found
```

**`npm run local:smoke` failed once, then passed twice.** The failure was "the dock never reported a
rendered frame", on a run launched immediately after a full build and test pass; the script gives
Electron a fixed 8 seconds and under that load it did not get there. It is recorded here rather than
hidden, because a flaky smoke test nobody wrote down becomes a mystery later. Both passes reported
three **non-blank** frames, which is the assertion that would catch a stylesheet that broke rendering.

The ten new tests are static guards, because none of this is reachable from the unit suite — a colour
regression is invisible until someone takes a screenshot, and a broken `.ico` only shows up in the
tray of an installed build:

1. The icon carries exactly the seven expected sizes, all square, all 32bpp.
2. The small sizes are proportionally fatter than the large ones, which a downscaled stack could not be.
3. No size has a blended edge row, i.e. nothing lands on a half pixel.
4. Nothing 64px or under is PNG-compressed (the NSIS trap); the 256px entry is.
5. The installer icon is byte-identical to the app icon at 16/32/48.
6. The installer header's corner is light, so it cannot float as a dark rectangle.
7. No violet remains in any of the three stylesheets.
8. `dock.css` and `settings.css` contain no hex colours at all.
9. The token set still has every token the stylesheets reference, and the accent is still white-on-black.
10. `.btn-compact` is 28px, `.btn` still uses `--bf-hit`, and `--bf-hit` is still 32px.

Beyond the automated checks, the **real stylesheets were rendered in a browser and looked at**: all six
dock states and the settings window, served from `dist/renderer` so the actual built CSS was under
test rather than a mockup.

### Edge cases and limitations

- **The green lamp is 2–3 pixels at 16px.** That is the honest limit of the size, not a defect, but on
  a small tray it reads as a white pill with a green tint rather than a distinct lamp.
- **`--bf-font-mono` depends on the host having Cascadia Mono or Consolas.** Consolas has shipped with
  Windows since Vista, so on the target platform this is safe; the stack falls back to a generic
  monospace elsewhere.
- **The settings window was re-themed but not re-spaced.** It inherits the palette through the tokens
  and looks coherent, but its own density, empty states and layout are untouched. That is Phase 2.
- **Nothing here is a layout change.** The dock's sizing logic, which is load-bearing and reports its
  own measured rect over IPC, was not touched. The bar is 8px shorter, so the dock window reports a
  slightly smaller height; that goes through the existing measurement path, and the packaged smoke
  confirms the dock still paints.
- **The icon script needs Pillow and, for the installer text, Windows system fonts.** It is a manual
  asset generator, not part of the build, so it never blocks `npm run build` or CI.
- **The update signing risk from the previous session still stands.** Updates install an unsigned
  installer with signature verification off; the protection is HTTPS plus the SHA-512 in the manifest.

### 2026-09-15 — BYOK named in the app

> Can we mention we have this BYOK bring your own key design or whatever in a good way

Verified the claim before writing any copy, because a positioning line that is not true is worse than
no line. Both facts hold: the key is encrypted on the machine through `safeStorage` (DPAPI-backed on
Windows) in `config-store.ts`, and it is handed straight to the Groq SDK from the user's machine.
**There is no BayanFlow server anywhere in the path.**

**The wording is deliberately fenced.** BYOK means *your key, your account, no middleman*. It does not
mean the audio stays on the machine — it still goes to Groq. The Privacy tab draws that line carefully,
and a loose BYOK sentence would quietly contradict it. A test now asserts the note never claims
"never leaves", "stays on your PC", "fully local", "offline" or "no data is sent", and never prints the
acronym without the plain phrase beside it.

**Two placements, not five.** First-run step 1, where the user is being asked for a key and is
wondering why — the note reframes that friction as the reason there is no sign-up and no subscription.
And the Connection card in Settings, where the key permanently lives. Home and the Privacy tab were
left alone: Home is already dense, and Privacy's job is precise disclosure rather than positioning.

**A bug caught during the change.** Settings search iterates `.field, .toggle` rows, so the new
`.byok` block was invisible to it in two ways: its `data-keywords` did nothing, and — worse — filtering
never hid it. Searching "microphone" would have hidden every real row in the Connection card and left
the BYOK note floating there alone. Both the prebuilt reset list and the per-card filter loop now
include `.byok`, and a test asserts the two selectors agree, since having a row type in one but not the
other is exactly the shape of that failure.

Verified in the browser against the built files: searching "microphone" hides the note, "byok" and
"subscription" both find it, and clearing the box restores it.

```txt
npm test                 -> tests 314 | pass 314 | fail 0   (312 -> 314)
npm run local:smoke      -> PASS, 3 non-blank dock frames
npm run dist             -> exit 0
npm run packaged:smoke   -> PASS
```
---

## 8. Explanation — Phase 2

### What changed

The settings window keeps the Terminal palette but stops shouting: white is now reserved for primary
actions alone, and anything that encodes a quantity uses a muted ink. Home was reordered and its setup
card taught to collapse. A three-step first-run view was added that replaces Home until setup is done
and then never appears again.

### Why it was needed

Phase 1 made `--bf-accent` paper-white, which was right for buttons and wrong for everything else that
happened to use the accent. Checkbox fills, chart bars and progress meters all encode state or
quantity, not action — and painting them the brightest colour on the screen meant the Stats chart
outshouted every heading, and the Privacy tab read as four white blocks with some text nearby.

Separately, the settings window had accumulated small costs: a setup card that never left, a privacy
disclosure disguised as a completed task, Status pushed below the fold, and — for anyone installing
for the first time — a dashboard greeting them with "Welcome back" and a zero-day streak.

### How it works, step by step

**Data ink.** Two new tokens, `--bf-data` and `--bf-data-strong`. Chart bars, empty-day stubs and the
"where you dictate" meters take the muted pair; `--bf-accent` is now used by primary buttons and focus
rings only. The rule is worth stating plainly because it is the thing that will drift: **if it is not
something you click, it does not get the accent.**

**Checkboxes** stopped using `accent-color`, which paints the entire box in the accent. They are now
`appearance: none` with a dark fill, a border that brightens when checked, and a tick drawn from two
borders on a rotated element.

**The chart.** Each column used to be a three-row grid — value, bar, label — so the value sat in its
own top row regardless of how tall the bar was. Now the column is two rows and the value lives inside
a flex `.chart-plot` with the bar, both pushed to the baseline, so the number sits on its own bar. A
bar under 18% of the chart height drops its label rather than colliding with its neighbour.

**The tiles** grid now reads a `data-count` written by `renderTiles`, and six tiles widen the track so
they land as 3x2 instead of 4+2 with a hole.

**Home** is now tiles, then a standing privacy disclosure, then the collapsible setup card, then
Status, then "How to use it". Status moved above the reference material because "is it working" is
checked often and "how does it work" is read once.

**The setup card** is a native `<details>`. It counts its own items — the old subtitle said "Four
steps" beside five — and opens only while something is unfinished. Once complete it collapses to
`Setup complete - 4 of 4`.

**First run** is a page in the same window, registered in the same `pages` map, shown by the same
`showPage`. `startFirstRun` picks the first incomplete step from the config that was already being
loaded. Each step drives the real Settings field and then clicks the real `#save` button, so there is
exactly one save path and one definition of a valid key. Step 3 polls `settingsBridge.load()` every
1.5 seconds while it is on screen, because `didDictate` is flipped in the main process and there is no
push channel to the renderer; the poll stops the instant it advances or the user leaves.

### Files and functions changed

| File | What it now does |
|---|---|
| `src/renderer/tokens.css` | Adds `--bf-data` and `--bf-data-strong` |
| `src/renderer/settings.css` | Hand-drawn checkboxes; chart bars and meters on data ink; `.tiles[data-count]`; `.chart-plot`; new `.disclosure`, `.collapsible`, `.steprail`, `.step*` and `.keycaps` blocks |
| `src/renderer/settings.html` | Home reordered; disclosure row added; setup card wrapped in `<details>`; "Clear all" moved into the toolbar; whole `#page-firstrun` section added |
| `src/renderer/settings.js` | `renderDisclosure` added; `renderSetupChecklist` counts and collapses; `renderChart` emits `.chart-plot` and suppresses cramped labels; `renderTiles` writes `data-count`; first-run controller and `refreshHome` added |
| `tests/theme-and-icons.test.mjs` | Three more guards: no `url()` images in CSS, first-run ids all exist, first run has no nav entry |

### Important decisions

- **White means "primary action" and nothing else.** Stated as a rule, not just a set of edits,
  because the next person adding a meter will otherwise reach for the accent.
- **The tick is CSS, not an SVG data: URI.** Both renderer pages set `img-src 'self'`, so a data: URI
  is blocked. Weakening the CSP to draw a checkmark was rejected outright.
- **First run reuses the real fields and the real save button** rather than getting its own save. A
  second save path is a second place for validation to drift.
- **Polling, deliberately.** No new IPC channel was added for one screen, so the only honest way to
  notice `didDictate` is to re-read the config while step 3 is visible.
- **Skip is session-scoped**, not persisted. Persisting it needs a config field and main-process
  support; a user who skips and fully restarts the app with no API key should see setup again,
  because the app genuinely does not work without one.

### Tests and verification

```txt
npm run build            -> exit 0 (590 KB)
npm test                 -> tests 312 | pass 312 | fail 0   (309 -> 312)
npm run local:smoke      -> PASS, 3 and 4 non-blank dock frames
npm run dist             -> exit 0, installer built
npm run packaged:smoke   -> PASS
asar list | grep preview -> 0   (the preview harness is not shipped)
```

The whole first-run flow was exercised in a browser against the real built stylesheets and scripts:
step 1, save, step 2, microphone test, step 3, then `didDictate` flipping — landing on Home with a
refreshed checklist, all without pressing a finish button. The collapse was verified at `4 of 4`, and
the checkbox tick was measured as actually rendering after the CSP fix.

**`npm run local:smoke` has now flaked twice**, both times on the first run immediately after a heavy
step (a full build, or the whole test suite). It gives Electron a fixed 8 seconds and under load it
does not get there; both times it passed on re-run. This is a property of the harness, not of the app,
and the threshold was deliberately **not** raised to make it pass — changing a timeout to silence a
failure is something to do on purpose, not in passing.

### Edge cases and limitations

- **Step 3 polls once per 1.5s.** Cheap — an in-memory config read — but it is polling, and it runs
  only while that step is visible.
- **Skipping does not survive an app restart**, by the decision above.
- **First run is decided once per window session.** If setup completes while the window is open the
  flow finishes; it never restarts mid-session.
- **The preview harness lives in `dist/renderer/` when in use**, which electron-builder packages. It
  is deleted before every packaging run and its absence is now verified, but it is a foot-gun worth
  knowing about.
- **The History subtitle was shortened, not re-laid-out.** `.page-sub` carries a deliberate
  `max-width: 62ch` reading measure; the old sentence ran a few characters past it and orphaned the
  word "only." Moving "Clear all" fixed the button collision, which was a separate problem.
- **Nothing in the main process changed.** No new IPC, no new window, no config fields.

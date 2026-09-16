# README and launch clip

## 1. Task

| | |
|---|---|
| **Name** | A real README at the repo root, and a 27s marketing clip of the real UI |
| **Status** | Shipped |
| **Started** | 2026-09-16 |
| **Last updated** | 2026-09-16 |

## 2. What you asked for

Your words, kept so nothing is lost to chat scrollback.

**Job 1 — README.md at the repo root.**

> Currently there is no README. Read docs/specs/ first (capability-audit.md,
> production-readiness-audit.md, theme-and-mark.md) — they are the source of truth.
> Cover: what it is, the two hotkeys (Ctrl+Shift+Space to dictate, Ctrl+Shift+Enter
> to rewrite), install, the BYOK design (you bring your own free Groq key, there is
> no BayanFlow server in the path, no subscription), privacy (what is stored locally
> vs what is sent to Groq — be precise, audio IS sent to Groq), and how to build.
> Do not claim local-only processing.

**Job 2 — a marketing clip of the real UI, roughly 25-30 seconds.**

> Use the HyperFrames skill. Copy the structure of the reference project at
> project-videos/eudoro — read its index.html first. That one is 1920x1080, 27s,
> three tracks: track 0 real screen recordings, track 1 brand title and outro cards,
> track 2 numbered lower-third captions, plus BGM across the whole thing.
>
> Match BayanFlow's actual theme, not eudoro's pink: near-black #08080a, paper white
> #e7e7e3 text, and exactly one accent, the green #3fe08a used only for the recording
> state. Tight radii, IBM Plex Mono or Cascadia Mono for anything that is data.
> Serious and minimal, not playful.
>
> Beats: the idle pill at the bottom of the screen -> hold the hotkey, the listening
> bar with the green waveform -> text lands in a real Gmail compose or VS Code -> the
> rewrite hotkey opening the Polish panel -> Settings showing BYOK and the privacy
> controls.
>
> You have to use skill to create clips I did not record anything there all created
> by agent.

### Constraints carried in from these

- **The README must not claim local-only processing.** Audio leaves the machine.
- **The clip's only colour is the signal green, and only for the recording state.**
- **No footage exists.** Track 0 cannot be screen recordings.

## 3. Open questions

| # | Question | My recommendation | Your answer |
|---|---|---|---|
| Q1 | A README already exists at the root (10.8 KB, commit `b0f5eb8`) — the brief says there is none. Rewrite it, or add a second doc? | Rewrite in place. It is a good product guide but has no install, no build, and no precise privacy split | **Flagged, then taken on "continue"** |
| Q2 | What goes on the outro card? | `github.com/KaleemAhmed123/Bayan-Flow` — it is where `electron-builder` already publishes releases, and the updater comment confirms the repo is public | **Taken on "continue"** |
| Q3 | Where does the BGM come from? No HeyGen sign-in, and local MusicGen deps are not installed | Synthesize a minimal bed with ffmpeg and flag it as a placeholder | **Taken on "continue"** |
| Q4 | Cascadia Mono is not installed on this machine, and Consolas/Segoe UI are proprietary. Which mono? | IBM Plex Mono — you named it as the alternative, it is OFL so it can live in the repo, and HyperFrames lint requires a named family to ship a real `@font-face` file | **Taken; recorded here rather than assumed silently** |
| Q5 | Gmail in light mode would blow out the palette. Dark mode? | Dark. It is a real Gmail setting, and a white window would break the one thing the brief is strictest about | **Taken** |

## 4. Plan

### Job 1 — README

Source of truth was the code, not the old README. Every claim was checked against a file:

| Claim | Verified in |
|---|---|
| Hotkeys | `src/config-store.ts:13-14` |
| Models | `src/config-store.ts:23-27, 35` |
| Local storage table | `docs/specs/capability-audit.md` §4.1.4 |
| What is sent | `docs/specs/capability-audit.md` §4.1.4 + `src/renderer/settings.html` Privacy panel |
| Clipboard history is deliberate | `src/insertion/text-inserter.ts:60-73` |
| Unsigned builds, no Authenticode check | `src/updater.ts` security note |
| Build commands | `package.json` scripts |
| Licence is proprietary | `LICENSE` |

### Job 2 — the clip

Routed through `/hyperframes` → `/product-launch-video` in **no-capture mode**: there is no
website to crawl and no footage to cut.

**Deliberately built as a single `index.html`, not the workflow's per-frame sub-agent pipeline.**
Two reasons, both binding: the environment forbids sub-agent dispatch, and the deliverable you
specified is eudoro's shape, which is one file.

**Track 0 is HTML, not video.** With no recordings, the screens are rebuilt from the app's own
stylesheets. This is *more* faithful than a capture would have been: the colours, radii, control
heights, and the 4x2 chip grid are the real values from `tokens.css` and `dock.css`, not an
illustration of them.

### Files this touches

| File | Change |
|---|---|
| `README.md` | Rewritten |
| `docs/specs/readme-and-launch-clip.md` | New — this file |
| `docs/specs/README.md` | One index row |
| `../project-videos/bayanflow/` | New HyperFrames project |

### Deliberately NOT changing

- **No app code.** Not one file under `src/` was touched. The clip reads the stylesheets; it does
  not modify them.
- **The app's real tokens.** The video shifts its own secondary inks one rung up the app's ladder
  for legibility under compression (see Update below), but `src/renderer/tokens.css` is untouched.

### Alternatives rejected

- **Recording the real app with a screen capture tool.** You said nothing was recorded, and driving
  a live Electron tray app to hit five specific states on cue is far more work than rendering its
  own CSS deterministically.
- **Shipping Consolas or Segoe UI in the video project.** Both are Microsoft-proprietary. Segoe is
  still the face you see, because `system-ui` resolves to it on the Windows render host, which also
  sidesteps the lint rule that a *named* family must ship a font file.
- **Suppressing the Gmail overlap warning with `data-layout-allow-overlap`.** The overlap was real
  geometry. Shortening the compose body fixed the cause.

## 5. Tasks

- [x] 1. Read the three audits and the app source for every factual claim
- [x] 2. Rewrite `README.md`
- [x] 3. Route through `/hyperframes`, install `/product-launch-video`, scaffold the project
- [x] 4. Write `BRIEF.md`; record the no-capture and no-sub-agent decisions
- [x] 5. Ship IBM Plex Mono; synthesize the BGM bed with ffmpeg
- [x] 6. Build the composition — 6 scenes, 7 captions, title and outro cards, music bed
- [x] 7. `lint` and `check` to 0 errors and 0 warnings outside the three structural ones
- [x] 8. Snapshot every cut and midpoint, fix what the frames showed
- [x] 9. Render and verify the artifact with `ffprobe`

## 6. Updates

### 2026-09-16 — both jobs shipped

**The README already existed.** The brief said there was none. It was a product guide with no
install section, no build section, and no precise account of what leaves the machine. Rewritten
rather than appended to, and you were told before anything was overwritten.

**Three things the frames caught that reasoning did not.**

1. **Scenes 1 and 2 were 8 seconds of near-empty black.** The pill floated on a bare desktop. Fixed
   by putting the Gmail compose window on screen from the first frame — which is also more truthful,
   because you dictate *into* something. Scenes 1-3 then became one continuous desktop shot with a
   hard cut between them, so only the dock state and the text change. That removed 16 layout
   warnings at the same time: they were all the identical window crossfading onto itself.
2. **The pill's reveal cut "Rewrite" mid-word.** Widening a clipped container wipes text open. The
   real app fades its side groups in (`bf-reveal`), so the fade now runs behind the wipe.
3. **The VS Code gutter numbers did not sit on the code.** The gutter had its own font-size and
   line-height. Matching both to `.vs-line` fixed it, and the rewrite slot is a fixed two code lines
   so the numbering stays true whichever version of the sentence is showing.

**Two honest compromises, both visible in the output.**

- **The BGM is synthesized, not a library track.** No HeyGen sign-in and no local MusicGen deps, so
  it is an ffmpeg A-minor pad: three low-passed sine partials with slow tremolo, a long fade in and
  out, limited and mixed at 0.4. It is a bed, not a hook. Sign in with `npx hyperframes auth login`
  and it can be swapped for a real track without touching the composition.
- **The video's secondary inks are one rung brighter than the app's.** At 21px through h264, the
  app's `#7d7e78` and `#55564f` fall under 4.5:1 and stop being readable. The video's "muted" is the
  app's `--bf-data-strong`, its "faint" is the app's `--bf-text-muted`. Every value is still a real
  BayanFlow token; the primary ink and the signal green are untouched.

**Three lint warnings are accepted, not missed:** `composition_file_too_large` and two
`timeline_track_too_dense`. All three ask for the file to be split into sub-compositions. You asked
for eudoro's single-file structure, so they stay.

### 2026-09-16 — second cut: stats, settings, real logos, speed beat

**Asked for:** show the analytics page, show settings people can change, use real app icons and
make a point of them, and say out loud that speaking beats typing, with numbers.

**Decisions (approved before building):** real logos, yes — nominative use in a product demo.
Length grows from 27s to 45.6s rather than cutting Gmail beats. Stats are an invented demo week
labelled `DEMO DATA · ONE WEEK` in the page header, and every number satisfies the app's own
formula in `history-store.ts:268` (12,400 words ÷ 40 wpm = 310 min typing; 83 min spoken;
310 − 83 = **227 min saved → "3h 47m"**; 12,400 ÷ 83 = **149 wpm**). Settings shown: hotkey
rebind, spoken language → Urdu with the 15-language strip, and four custom-vocabulary chips.

**New timeline:**

```
0.0   TITLE
2.4   S1–S3  Gmail (unchanged; real Gmail icon on the tab)
16.4  S4     VS Code + Rewrite (unchanged; real VS Code icon in the title bar)
20.7  S6     "Works in every app you already use" — 8 real logos land one by one
24.0  S7     Typing 40 wpm vs speaking 149 wpm race → "3.7×" counts up →
             3 value chips: 3h 47m saved · 8 rewrite styles · 15 languages
29.4  S8     Stats page: six tiles count up, 7-day chart grows, "Where you dictate" meters fill
34.8  S5     Settings, four tabs: General/BYOK → Shortcuts (hotkey cross-fades to a new combo)
             → Dictation (language → Urdu, vocabulary chips pop in) → Privacy toggles
42.8  OUTRO
```

**Icon sourcing:** `simple-icons` (npm, CC0) for Gmail, Notion, WhatsApp, Chrome, Discord,
Google Docs. VS Code is not in simple-icons any more, so `vscode.png` is copied from the local
VS Code install (`resources/win32/code_150x150.png`). Slack is inlined from Slack's published
SVG paths. Word and Teams were wanted but neither simple-icons nor this PC has them; dropped.

**Music:** the 28s synthesized bed is cross-faded onto itself (3s `acrossfade`) and trimmed to
45.6s with a 2.2s fade-out. Original kept as `assets/bgm-28s.m4a`.

**Snapshots caught:** the stats window clipped its fifth app row, "149 wpm" and "TYPING TIME
SAVED" wrapped inside their tiles — fixed by narrowing the nav rail to 220px, dropping tile
type to 34/14px with `nowrap`, and a 660px window. The VS Code PNG has transparent padding so it
gets `scale(1.6–1.7)` wherever it sits beside SVG logos. One contrast miss (4.49:1) on the
`DEMO DATA` label — moved one rung up to `--bf-text-muted`.

**Verification:** `hyperframes check` — 0 errors across lint/runtime/layout/motion/contrast
(6 lint warnings: 3 "split the file", 3 "same icon file used in several places"; both harmless).
`ffprobe`: h264 1920×1080, aac, `duration=45.600000`, 5.7 MB.

### 2026-09-16 — README cut to what the clip cannot say

The clip now carries the tour, so the README dropped from ~1,430 words to ~740. Kept: the two
hotkeys, install with the honest SmartScreen note, the Groq-key step, BYOK in three bullets, both
privacy tables in full, the clipboard-history note, the build chain, the licence. Dropped: the
default-model table (one pointer to Settings → Advanced instead), the source-layout table, and the
long BYOK prose. The clip is embedded by a `user-attachments` URL that the owner pastes after
drag-dropping the MP4 into GitHub's README editor — a committed `.mp4` only renders as a link, and
GitHub's inline player needs the web-upload path. Placeholder line left with a comment above it.

Music is still the synthesized pad: `bgm` resolves only from the HeyGen catalog, and sign-in is a
browser OAuth step (`npx hyperframes auth login`) that cannot run from here.

## 7. Explanation

### What changed

Two deliverables, in two different repositories.

1. **`README.md` at the BayanFlow root** was rewritten from a product guide into a document that a
   stranger can install, trust, and build from.
2. **A new HyperFrames project** at `project-videos/bayanflow/` that renders a 27-second 1920x1080
   MP4 showing the real product doing the real thing.

### Why it was needed

The old README described the product well but answered none of the questions someone actually has
before running an unsigned installer: *where do I get it, what leaves my machine, and how do I build
it myself?* It also never said that dictation audio is uploaded to Groq — the single most important
fact about the app's privacy posture.

The clip exists because a tray app is impossible to explain in prose. "One hotkey, text appears
where you were typing" takes four seconds to show and a paragraph to describe badly.

### How it works, step by step

**The README** is plain Markdown. No build step. Its only notable property is that every number in
it was read out of a file rather than remembered — the model IDs, the 500-row history cap, the 5-second
silence timeout, the Node version, the fact that `verifyUpdateCodeSignature` is switched off.

**The clip** is a single HTML file that HyperFrames renders frame by frame.

1. **The DOM declares the timeline.** Each scene is a `<div class="clip">` with `data-start` and
   `data-duration` in seconds. The renderer shows a clip only inside its window.
2. **One paused GSAP timeline** is registered at `window.__timelines["main"]`. HyperFrames sets its
   time to each frame's timestamp and screenshots the result. Nothing plays; everything is seeked.
3. **Because it seeks, every frame must be reproducible from its time alone.** That is what shaped
   the code:
   - No CSS `animation: infinite`. The waveform, the lamp pulse, the spinner, and the caret are GSAP
     tweens with a computed finite repeat count.
   - No `.call()` callbacks for anything visible. GSAP suppresses callbacks on seek, so a scripted
     `textContent` swap would render blank. Every state change is instead a cross-fade between two
     elements that both exist in the DOM: the "Polishing" bar and the "Pasted" bar, the casual
     sentence and the professional one, the General panel and the Privacy panel.
   - The typing effect is a GSAP tween on a plain counter, with `onUpdate` slicing the string.
     Tween `onUpdate` *does* run on seek, because the tween re-renders.
4. **Audio** is one `<audio id="bgm">` on its own track, trimmed to 27s by `data-duration`.
5. **`ffmpeg` muxes** the captured frames and the audio into h264 + aac.

The visual flow:

```
0.0 ──2.8   TITLE      mark, wordmark, tagline
     2.4 ─────────────────────────── 7.2   SCENE 1   idle pill -> hover -> hotkey held
                    7.2 ───────────── 11.6  SCENE 2   listening bar, green waveform, mono timer
                              11.6 ──────── 16.6  SCENE 3   "Polishing" -> "Pasted", text lands
   (one continuous desktop, hard cuts — only the dock and the text change)
                                     16.4 ─── 20.9  SCENE 4   VS Code, Rewrite panel, 4x2 chips
                                          20.7 ─ 24.5  SCENE 5   BYOK card -> Privacy toggles
                                                 24.3 ── 27.0  OUTRO   repo, keycaps
captions 1..7 ride above all of it on their own track
```

### Files / functions changed

| File | What it now does |
|---|---|
| `README.md` | The document described above. Rewritten, not appended |
| `docs/specs/readme-and-launch-clip.md` | This file |
| `docs/specs/README.md` | One new index row |
| `../project-videos/bayanflow/index.html` | The whole composition — CSS recreation of the app, the DOM timeline, the single GSAP timeline |
| `../project-videos/bayanflow/BRIEF.md` | The locked brief: palette table, type rules, beats, and the "do not claim local-only" constraint |
| `../project-videos/bayanflow/assets/bgm.m4a` | The synthesized music bed |
| `../project-videos/bayanflow/assets/fonts/IBMPlexMono-*.ttf` | The mono face, shipped so lint passes and the render is deterministic |
| `../project-videos/bayanflow/renders/bayanflow-launch.mp4` | The deliverable |

**No file under `src/` was touched.**

### Important decisions

| Decision | Why | Rejected |
|---|---|---|
| Rebuild the UI in HTML from the real stylesheets | No footage exists, and the app's own CSS is a better source than a screen capture would have been | Recording the live Electron app |
| Draw the UI at 2x | A 480px dock is unreadable on a 1920 canvas. Every internal proportion is preserved | Punching in with a camera move — more moving parts, same result |
| One `index.html` | You asked for eudoro's shape, and sub-agent dispatch is forbidden here | The workflow's per-frame pipeline |
| Green only where the app puts it | The brief's strictest rule. It appears on the pill lamp, the waveform, and the "Pasted" dot — all real app behaviour — and nowhere in the video's own chrome | Using green as a caption accent |
| `system-ui` for prose, IBM Plex Mono for data | `system-ui` resolves to Segoe UI on the render host, so the app looks like itself, and a generic keyword needs no shipped font file. Plex Mono is OFL and can live in the repo | Shipping Segoe UI or Consolas |
| Fix the Gmail overlap, do not suppress it | The compose window genuinely covered an inbox row. Shortening its body removed the cause | `data-layout-allow-overlap` |

### Tests / verification

Real output, not claims.

**`npx hyperframes check`** — final run:

```
Lint      0 error(s), 3 warning(s), 0 info(s)
Runtime   0 errors, 0 warnings
Layout    0 error(s), 0 warning(s), 58 info(s)
Motion    (clean)
Contrast  (clean)
◇  Check passed
```

The 3 lint warnings are the accepted structural ones described in §6.

**`npx hyperframes render`**:

```
renders/bayanflow-launch.mp4
3.6 MB · 27.0s video · rendered in 1m 4.8s
screenshot capture · hardware gpu
```

**`ffprobe` on the artifact**:

```
codec_name=h264      codec_type=video   width=1920  height=1080  r_frame_rate=30/1
codec_name=aac       codec_type=audio
duration=27.000000   size=3757908
```

**Snapshots** were taken at every cut and midpoint across three passes and inspected as contact
sheets. The three defects in §6 were found that way, fixed, and re-snapshotted.

**Not run:** the BayanFlow test suite. No app code changed, so there was nothing for it to cover.

### Edge cases and limitations

- **The BGM is a placeholder.** A synthesized pad, not a composed track. It will not carry the video
  on its own.
- **The clip has no voiceover.** Captions carry the narrative. Fine for a muted autoplay feed; less
  good as a standalone explainer.
- **The Gmail and VS Code windows are recreations, not those products.** They are close enough to
  read as themselves and deliberately generic — no logos, no trade dress. The BayanFlow UI is exact;
  the host apps are set dressing.
- **The render needs a working Chrome.** The bundled headless shell timed out on its first probe
  here, immediately after download, and worked on retry — most likely Defender scanning a new binary.
  If it recurs, `HYPERFRAMES_BROWSER_PATH` points the renderer at system Chrome.
- **`system-ui` is host-dependent.** Rendering this project on Linux or macOS will not produce Segoe
  UI, and the app UI will look subtly wrong. It is correct on Windows, which is where it was built
  and where the product runs.
- **The README's install section will go stale** the moment the builds are code-signed. The
  SmartScreen paragraph is written to be deleted, not edited.

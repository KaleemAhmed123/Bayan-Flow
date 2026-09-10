# Bundle size reduction

## 1. Task

- **Name:** Bundle size reduction
- **Status:** shipped (Tier A + B)
- **Started:** 2026-09-07
- **Last updated:** 2026-09-07

## 2. What you asked for

> "Act like a desktop application developer electron js dev and help me reduce
> the bundle size the exe size to as small as possible upto single digit if
> possible"

Constraints taken from that:

- Target the shipped installer `.exe`, not just the source tree.
- Push as far as reasonably possible.
- "Single digit" MB was named as the stretch goal.

## 3. Open questions

| Question | Recommendation | Your answer |
|---|---|---|
| How far to go: asar slimming only, asar + GPU DLL stripping, or a Tauri rewrite for genuine single digits? | Tier A + B (asar slimming + GPU DLL stripping), because it is a same-day change with a testable outcome and no framework migration. | **Tier A + B now.** |

### Answered up front, not asked

**Is single-digit MB reachable in Electron?** No. `electron.exe` alone is
226 MB uncompressed and roughly 55 MB after the installer's LZMA compression.
That is a hard floor that cannot move without compiling a custom Chromium.
Single digits require dropping Electron for a system-WebView framework
(Tauri/WebView2), which is a separate, multi-week project. This was stated
before any work began so the goal was not silently redefined.

## 4. Plan

### Measurement first

| Item | Before |
|---|---|
| Installer `.exe` | 93 MB |
| `win-unpacked/` on disk | 320 MB |
| `BayanFlow.exe` (Electron binary) | 226 MB |
| `app.asar` (our code) | **14.7 MB** |
| `dist/` (what we actually compile) | **395 KB** |

The gap between 395 KB of compiled code and a 14.7 MB asar was the finding that
drove the whole task.

### Root cause of the asar bloat

`src/insertion/text-inserter.ts` imports four symbols from
`@nut-tree-fork/nut-js` — `getActiveWindow`, `getWindows`, `Key`, `keyboard`.
None of them touch images. But the dependency chain is:

```
text-inserter.ts
  └─ @nut-tree-fork/nut-js/dist/index.js
       └─ lib/imageResources.function.js        (required at line 36)
            └─ require("jimp")                  (line 10)  ── 10.9 MB
```

`jimp` is a full image-processing library: PNG/JPEG/GIF/TIFF/BMP decoders plus
about twenty plugins. nut-js needs it for on-screen image matching, a feature
BayanFlow never uses. Node ships the whole thing regardless.

Second source: `@types/node` (2.4 MB of TypeScript declaration files) was being
packaged because `groq-sdk` declares it as a runtime dependency.

### Approach

**Tier A — slim the asar.** Bundle the main process with esbuild into a single
file and alias the unreachable packages to an empty stub. Once bundled, the
libraries no longer need to ship as `node_modules` at all, so they move to
`devDependencies` and electron-builder stops packaging them.

**Tier B — strip unused GPU files.** The dock and settings windows are plain
HTML with no WebGL, WebGPU or canvas work, so Electron's DirectX shader
compilers and its software Vulkan driver never load. Delete them in the
`afterPack` hook that already exists for icon stamping.

### Deliberately not changed

- **`ffmpeg.dll` (3.0 MB)** stays. `src/renderer/recorder.js` records with
  `MediaRecorder(stream, { mimeType: "audio/webm" })`, which is Opus audio, and
  the Opus encoder lives in `ffmpeg.dll`. Removing it breaks recording silently.
- **`libGLESv2.dll` / `libEGL.dll` (8.6 MB)** stay. These are ANGLE, which still
  backs normal window compositing.
- **`d3dcompiler_47.dll` (4.7 MB)** stays. ANGLE's D3D11 path uses it to compile
  shaders at runtime. It may well be removable, but the outcome depends on the
  GPU and driver of the machine running the app, and that cannot be verified
  from one developer machine.
- **`LICENSES.chromium.html` (20.4 MB)** stays. It is required Chromium
  attribution.
- **`icudtl.dat` (10.9 MB)** stays. Shrinking it needs a custom Electron build.
- **The 226 MB Electron binary** stays. Same reason.

### Rejected alternatives

- **Deleting `jimp` from `node_modules` after install.** nut-js requires it at
  module load, so the app would crash on startup.
- **Replacing nut-js with the raw `@nut-tree-fork/libnut-win32` addon.** Saves a
  little more, but means reimplementing nut-js's key mapping and window handling.
  Much larger diff for a fraction of the win.
- **Bundling to CommonJS instead of ESM.** Would have made external `require()`
  work with no shim, but `main.ts`, `settings-window.ts`, `audio-recorder.ts` and
  `overlay-dock.ts` all use `import.meta.url`, which CommonJS does not have.

## 5. Tasks

- [x] Measure the real breakdown of installer, unpacked folder and asar
- [x] Trace why `app.asar` is 14.7 MB when `dist/` is 395 KB
- [x] Add esbuild and a `scripts/bundle-main.mjs` bundling step
- [x] Stub `jimp` and the default clipboard provider
- [x] Keep native addons external so their `.node` lookup still works
- [x] Fix `__dirname` breakage caused by bundling (see Update 2)
- [x] Move bundled packages to `devDependencies`; ship only native addons
- [x] Wipe `dist/` on every build so deleted sources stop shipping
- [x] Strip unused GPU files in `afterPack`
- [x] Verify: unit tests, local smoke, packaged smoke, packaged pixel check

## 6. Updates

### 2026-09-07 — Tier A: asar slimming

Added `esbuild` and `scripts/bundle-main.mjs`. It bundles `dist/main.js` into
`dist/main.bundle.js` as ESM, with:

- **External:** `electron`, `uiohook-napi`, `@nut-tree-fork/libnut-win32`.
  These must stay real files in `node_modules`. `uiohook-napi` finds its native
  addon through `node-gyp-build(join(__dirname, ".."))` and `libnut-win32`
  through `bindings("libnut")`. Both walk the filesystem starting from their own
  directory, so inlining their JavaScript into `dist/` breaks the lookup.
- **Aliased to an empty stub:** `jimp` and
  `@nut-tree-fork/default-clipboard-provider`.

`src/main.cjs` now imports `./main.bundle.js` instead of `./main.js`.

`package.json`: `@nut-tree-fork/nut-js` and `groq-sdk` moved to
`devDependencies` (they are inlined into the bundle);
`@nut-tree-fork/libnut-win32` added to `dependencies` (the native addon still
has to ship). `build.files` narrowed from `dist/**/*` to the four things
actually needed.

Result: `app.asar` 14.7 MB → **716 KB**. Packages shipped inside it dropped from
about 140 to 6, all of them native addons or their loaders.

### 2026-09-07 — Update 1: ESM had no `require`

First packaged run crashed on startup. `%APPDATA%/BayanFlow/logs/early-startup.log`
showed the bundle failing at load.

esbuild leaves external CommonJS packages as bare `require()` calls, but an ESM
module has no `require` in scope, so `require("@nut-tree-fork/libnut-win32")`
would have thrown. Fixed with a `banner` that defines one:

```js
import { createRequire as __nodeCreateRequire } from "node:module";
const require = __nodeCreateRequire(import.meta.url);
```

It resolves relative to `dist/`, which is inside the asar, so the addon is found.

### 2026-09-07 — Update 2: bundling moved `__dirname`

Bundling collapses many files into one, which changes what `import.meta.url`
points at. Four files computed their own `__dirname` from it:

| File | `__dirname` before | after bundling |
|---|---|---|
| `main.ts` | `dist/` | `dist/` — fine |
| `settings-window.ts` | `dist/` | `dist/` — fine |
| `audio/audio-recorder.ts` | `dist/audio/` | `dist/` — **`"../renderer"` broke** |
| `overlay/overlay-dock.ts` | `dist/overlay/` | `dist/` — **`"../renderer"` broke** |

The two files in subfolders joined `".."` onto `__dirname`, which was correct
from `dist/overlay/` but points outside the app from `dist/`. The dock and the
audio recorder would both have failed to load their HTML and preload scripts.

Fixed at the root rather than per call site: new `src/app-paths.ts` exports
`rendererDir` and `assetsDir`, derived once from its own location. That module
sits at `dist/` in both the per-file tsc output and the bundle, so it is correct
either way. All four files now import from it and none compute `__dirname`.

### 2026-09-07 — Update 3: the clipboard stub was constructed eagerly

Second packaged run crashed with `TypeError: e is not a constructor`. The
assumption behind stubbing `@nut-tree-fork/default-clipboard-provider` was wrong.
It is lazily required inside `provider-registry.class.js` `getClipboard()`, but
nut-js **also** registers it eagerly at import time:

```js
if (!process.env[DISABLE_DEFAULT_CLIPBOARD_PROVIDER_ENV_VAR]) {
  let e = require("@nut-tree-fork/default-clipboard-provider").default;
  registry.registerClipboardProvider(new e);   // new {} → TypeError
}
```

Fixed with nut-js's own documented off-switch, set in the bundle banner:

```js
process.env.NUT_JS_DISABLE_DEFAULT_CLIPBOARD_PROVIDER ??= "1";
```

The stub is deliberately left as an empty object rather than made into a
constructible class. If anything ever does reach for one of these again, it
should fail loudly at startup — as it just did — instead of quietly registering
a provider that does nothing.

### 2026-09-07 — Tier B: GPU file stripping

`scripts/after-pack.cjs` now deletes, after the existing icon stamping:

`dxcompiler.dll` (25.7 MB), `dxil.dll` (1.5 MB), `vk_swiftshader.dll` (5.6 MB),
`vulkan-1.dll` (0.95 MB), `vk_swiftshader_icd.json`.

Reported at build time as `afterPack: removed 32.2 MB of unused GPU files`.

### 2026-09-07 — Results

| Item | Before | After | Change |
|---|---|---|---|
| **Installer `.exe`** | **93 MB** | **81 MB** | **−13%** |
| `win-unpacked/` on disk | 320 MB | 273 MB | −15% |
| `app.asar` | 14.7 MB | 716 KB | **−95%** |
| Packages inside the asar | ~140 | 6 | — |

This came in below the roughly 74 MB installer estimated at planning time. The
estimate assumed the GPU DLLs would compress at about 2.5:1 inside the NSIS
installer; they compress better than that, so deleting them recovered less from
the download than from the disk footprint. The 47 MB saved on disk is real; only
about 12 MB of it survives compression.

## 7. Explanation

### 1. What changed

Two independent changes, both aimed at shipping less.

The main process is now compiled into **one bundled file** instead of forty-odd
loose modules plus a `node_modules` tree. Doing that let two large libraries be
dropped entirely: `jimp`, a 10.9 MB image-processing library the app never
calls, and `@types/node`, 2.4 MB of TypeScript declaration files that have no
runtime purpose.

The packaged app also no longer ships five Electron GPU files it never loads.

Along the way, three latent problems were fixed: stale build output was
shipping, and two bugs that bundling itself introduced.

### 2. Why it was needed

The compiled application code is 395 KB. The archive shipping it was 14.7 MB.
Roughly 97% of what was inside was dependencies nothing called, dragged in
transitively.

**Transitive dependency** — a package you never asked for, installed because
something you did ask for needs it. Node ships the whole package whether your
code calls into it or not.

### 3. How it works, step by step

**The build, in order:**

1. `node scripts/copy-renderer.mjs` — **wipes `dist/` completely**, then copies
   `src/renderer`, `src/assets` and `src/main.cjs` into it. The wipe is new. TypeScript
   only ever adds files, so output for deleted sources lingered forever; the old
   builds were shipping `dist/input-assist/` and `dist/helpers/` for source files
   that no longer exist.
2. `tsc -p tsconfig.json` — type-checks and emits one `.js` per source file into
   `dist/`. Unchanged, and still what the test suite imports.
3. `node scripts/bundle-main.mjs` — esbuild reads `dist/main.js`, follows every
   import, and writes one minified `dist/main.bundle.js` (556 KB).

**What esbuild does with each dependency:**

- **Inlined** — `groq-sdk`, `@nut-tree-fork/nut-js` and everything they pull in.
  Their code is copied into the bundle, so they no longer need to be installed
  at runtime.
- **Left external** — `electron`, `uiohook-napi`, `@nut-tree-fork/libnut-win32`.
  These contain or load `.node` binaries — compiled machine code, which cannot be
  inlined into JavaScript. Both addons locate their binary by walking up from
  their own folder, so they have to stay as real folders on disk.
- **Replaced with an empty stub** — `jimp` and the default clipboard provider.
  Reachable in the require graph, never called.

**At startup:**

1. Windows launches `BayanFlow.exe`; Electron reads `main` from `package.json`
   and loads `dist/main.cjs`.
2. `main.cjs` installs crash handlers, caches the `electron` module on
   `globalThis`, then dynamically imports `./main.bundle.js`.
3. The bundle's banner runs first: it creates a working `require`, and sets
   `NUT_JS_DISABLE_DEFAULT_CLIPBOARD_PROVIDER` before any nut-js code executes.
4. nut-js initialises, registering its keyboard, mouse, screen and window
   providers — all backed by the real `libnut` native addon, loaded through that
   `require` from the unpacked folder beside the asar. The clipboard provider is
   skipped.
5. `app-paths.ts` computes `rendererDir` from its own location, and the dock,
   settings and recorder windows load their HTML and preload scripts from there.

**At package time,** `afterPack` stamps the icon with `rcedit` as before, then
deletes the five unused GPU files and prints how much it removed.

### 4. Files and functions changed

| File | What it now does |
|---|---|
| `scripts/bundle-main.mjs` | **New.** esbuild config: entry, externals, stubs, banner. Prints the bundle size. |
| `scripts/empty-module.js` | **New.** Empty object standing in for stubbed packages. |
| `src/app-paths.ts` | **New.** Exports `rendererDir` and `assetsDir`, resolved once from this module's own location. The single source of truth for on-disk asset paths. |
| `scripts/copy-renderer.mjs` | Now wipes `dist/` before copying, so stale output cannot ship. |
| `scripts/after-pack.cjs` | Keeps the `rcedit` icon stamping; adds deletion of five GPU files via a `REMOVABLE_GPU_FILES` list, and logs the bytes freed. |
| `src/main.cjs` | Imports `./main.bundle.js` instead of `./main.js`. |
| `src/main.ts` | Dropped its own `__dirname`; tray icon path now uses `assetsDir`. |
| `src/settings-window.ts` | Dropped its own `__dirname`; icon, preload and HTML paths use `assetsDir` / `rendererDir`. |
| `src/overlay/overlay-dock.ts` | Dropped its own `__dirname`; dock preload and HTML use `rendererDir`. |
| `src/audio/audio-recorder.ts` | Dropped its own `__dirname` and local `rendererDir`; imports the shared one. |
| `package.json` | `build` script gained the bundling step. `nut-js` and `groq-sdk` → `devDependencies`; `libnut-win32` → `dependencies`; `esbuild` added. `build.files` narrowed to four entries. |

No behaviour in the dictation, rewrite, history or settings flows was touched.

### 5. Important decisions

**Bundle, rather than prune `node_modules`.** Deleting `jimp` after install
would crash the app, because nut-js requires it at module load. Bundling with a
stub is the only way to make the reference disappear entirely.

**ESM output, not CommonJS.** CommonJS would have made external `require()`
work with no shim. But four source files use `import.meta.url`, which CommonJS
does not have, so they would all have needed rewriting. One banner line was the
smaller change.

**Fix `__dirname` in one place, not four.** Two of the four files were broken
by bundling and two were fine by luck. Patching only the broken two would leave
the same trap set for the next file added in a subfolder. `app-paths.ts` removes
the whole category.

**Use nut-js's own env switch instead of making the stub constructible.**
Making the stub a class would have silenced the crash, but it would also have
registered a clipboard provider that does nothing — a quiet failure later
instead of a loud one at startup. The env var stops the registration outright.

**Keep `ffmpeg.dll`, ANGLE and `d3dcompiler_47.dll`.** Each has a concrete
reason under *Deliberately not changed* above. `d3dcompiler_47.dll` is the
judgement call: probably removable, worth about 2 MB of installer, but whether
it breaks depends on the user's GPU driver and that is not verifiable from one
machine.

### 6. Tests and verification

All run against the final build.

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **103 passed, 0 failed** |
| Build + tests | `npm run ci` | **passed** |
| Bundle excludes dead code | `grep -c "jimp\|clipboardy" dist/main.bundle.js` | **0 matches** |
| Natives stayed external | `grep 'from"' dist/main.bundle.js` | `electron`, `uiohook-napi` external; `libnut-win32` via `require` |
| Local smoke (dev build) | `npm run local:smoke` | **passed** — "painted 3 non-blank dock frame(s)" |
| Packaged smoke | `npm run packaged:smoke` | **passed** — "startup success log found" |
| Packaged pixel check (stripped build) | scratchpad script reusing the `BAYANFLOW_DOCK_CAPTURE` path | **passed** — see below |

The last one is the important one, because it is the only check that runs
against the build with the GPU files actually removed:

```
startup.success: true
dock frames: 4 | blank: 0
distinct events: app.startup.begin, startup.login_item.updated,
  config.load.fallback, recorder.init.success, hotkey.listener.started,
  dock.init.success, dock.view, dock.resize, settings.show.created,
  app.launch_notice.settings_opened, app.startup.success, dock.capture
warn/error: warn:config.load.fallback, warn:config.load.fallback
```

What that proves:

- `dock frames: 4 | blank: 0` — the dock renders real pixels without the
  DirectX shader compilers or the software Vulkan driver.
- `recorder.init.success` — the hidden recorder window found its HTML, so the
  `rendererDir` refactor is correct in the packaged layout.
- `hotkey.listener.started` — `uiohook-napi`'s native addon loaded from inside
  the asar-unpacked folder.
- `app.startup.success` — nut-js finished registering its providers, which it
  does eagerly at import. Those providers are backed by `libnut`, so this is
  also proof the second native addon loaded. When it did not, startup crashed
  outright, which is how Update 3 was found.

The two `config.load.fallback` warnings are expected: the check runs against a
fresh empty user-data directory with no config file yet.

**Not verified end to end:** an actual dictation round trip through the Groq
API, and a real paste into a third-party window. Both need a live API key and a
human at the keyboard.

### 7. Edge cases and limitations

- **`d3dcompiler_47.dll` risk is untested, not absent.** It was kept precisely
  because the risk could not be measured here. If it is ever removed, it needs
  testing on more than one GPU.
- **The GPU stripping is validated on one machine.** The dock renders here
  without SwiftShader. A machine with no usable GPU at all would previously have
  fallen back to the software Vulkan driver and now cannot. Chromium's own
  software compositor should still cover it, but that path is unverified.
- **The stubs are a standing assumption.** If future code ever calls a nut-js
  image API such as `screen.find()`, or nut-js's clipboard, it will fail at
  runtime. That is intentional and loud, but it is a constraint on future work.
  Anyone adding those features must remove the corresponding entry from `alias`
  in `scripts/bundle-main.mjs`.
- **Tests still depend on the unbundled output.** `tests/*.test.mjs` import
  individual `dist/**/*.js` modules, which is why tsc still emits per-file
  output. Only `dist/main.bundle.js` and the renderer files are shipped.
- **Upgrading nut-js may reopen this.** The stub list is tied to how nut-js's
  entry file is written today. If a future version registers providers
  differently or moves the jimp import, the app will fail at startup rather than
  silently misbehave — but it will need attention.
- **Single digit MB remains out of reach.** 81 MB is close to the practical
  Electron floor. Roughly 55 MB of it is the Chromium binary and about 20 MB is
  required license text. See the Tauri route in section 3.

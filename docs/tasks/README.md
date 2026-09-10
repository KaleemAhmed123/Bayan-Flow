# Task Index

One line per task. Files live beside this one as `<task-slug>.md`.

New work now lives in [`../specs/`](../specs/README.md). These files stay where they are.

| Task | Status | Notes |
|---|---|---|
| [overlay-rebuild](overlay-rebuild.md) | shipped | Replaced the status pill and Input Assist panel with one bottom-centre dock. Hold-to-talk, paste with no confirm, Redo, layered rewrite menu, shared design tokens, Settings redesign. |
| [history-and-stats](history-and-stats.md) | shipped | Rewrite menu shows all eight actions with no More button. New dictation history file, plus a Home/History/Stats/Settings sidebar in the app window. |
| [bundle-size-reduction](bundle-size-reduction.md) | shipped | Bundled the main process with esbuild and dropped jimp (10.9 MB) plus @types/node. Stripped five unused Electron GPU files. Installer 93 MB to 81 MB, app.asar 14.7 MB to 716 KB. |

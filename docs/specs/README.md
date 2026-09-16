# Spec Index

One line per task. Files live beside this one as `<task-slug>.md`.

Older shipped work stays in [`../tasks/`](../tasks/README.md) under the previous folder name; new
work goes here.

| Task | Status | Notes |
|---|---|---|
| [capability-audit](capability-audit.md) | Tier 2 shipped | Full product audit: 33 findings across output quality, reliability, input control, diagnosis, privacy, architecture, shipping, and latency. Three live defects found and fixed. Tier 1 and Tier 2 complete except the deferred state-machine refactor. Tier 3 next. |
| [production-readiness-audit](production-readiness-audit.md) | Fixed | Private-beta readiness pass with a ponytail audit side by side. 22 correctness/UX + 5 over-engineering findings, plus two defects found while fixing them: Esc never cancelled a recording, and the context call reserved 17x the output tokens it used, failing 27% of captures on the free tier. All closed except P1, deliberately deferred. 282 tests green; v0.2.0 packaged and smoke-tested. |
| [settings-tabs](settings-tabs.md) | Shipped | Settings split into five tabs (General, Shortcuts, Dictation, Privacy, Advanced) with a search box that filters across all of them. Status list moved to Home; sticky save bar with an unsaved-changes marker. |
| [readme-and-launch-clip](readme-and-launch-clip.md) | Shipped | A real root README — install, BYOK, the precise local-vs-sent-to-Groq split, and build steps — plus a 45.6s 1920x1080 launch clip built in HyperFrames (Gmail → VS Code → real-logo strip → speaking-vs-typing → Stats page → four settings tabs). No footage existed, so every screen is rebuilt from the app's own `tokens.css` and `dock.css`. `check` clean; MP4 verified at 45.600s, h264 + aac. |
| [theme-and-mark](theme-and-mark.md) | Shipped | Palette moved to "Terminal" — near-true black, no accent hue, one signal green. Dock density tightened and the chips cut to 28px. New pill-and-lamp mark generated at seven hand-tuned sizes, replacing a single-size .ico. 309 tests green; dist and packaged smoke pass. Phase 2 fixed a white-as-data-ink regression plus six settings UX findings, and added a three-step first-run view that replaces Home until setup is done. 312 tests green. |

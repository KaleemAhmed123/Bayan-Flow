# Spec Index

One line per task. Files live beside this one as `<task-slug>.md`.

Older shipped work stays in [`../tasks/`](../tasks/README.md) under the previous folder name; new
work goes here.

| Task | Status | Notes |
|---|---|---|
| [capability-audit](capability-audit.md) | Tier 2 shipped | Full product audit: 33 findings across output quality, reliability, input control, diagnosis, privacy, architecture, shipping, and latency. Three live defects found and fixed. Tier 1 and Tier 2 complete except the deferred state-machine refactor. Tier 3 next. |
| [production-readiness-audit](production-readiness-audit.md) | Fixed | Private-beta readiness pass with a ponytail audit side by side. 22 correctness/UX + 5 over-engineering findings, plus two defects found while fixing them: Esc never cancelled a recording, and the context call reserved 17x the output tokens it used, failing 27% of captures on the free tier. All closed except P1, deliberately deferred. 282 tests green; v0.2.0 packaged and smoke-tested. |
| [settings-tabs](settings-tabs.md) | Shipped | Settings split into five tabs (General, Shortcuts, Dictation, Privacy, Advanced) with a search box that filters across all of them. Status list moved to Home; sticky save bar with an unsaved-changes marker. |

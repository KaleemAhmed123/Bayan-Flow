# Continuation prompt — paste this into a new chat

---

We are building **BayanFlow**, a Windows-first dictation and rewrite tray app (Electron +
TypeScript, Groq for transcription/cleanup). Read `docs/specs/capability-audit.md` first — it is the
single source of truth for this work and it is **append-only**.

## Where we are

A full product audit produced **33 findings** in that file. Tier 1 and Tier 2 are shipped. Test suite
is at **225 passing, 0 failing**; `npm run local:smoke` passes.

**Done:** silence-hallucination suppression, auto-detect + output language, custom vocabulary (+ tray
add-word), fallback model, rate-limit cooldown store, modifier-release wait before paste, app context
capture (metadata + opt-in screenshot with a blocklist), instruction-execution guard, richer cleanup
prompt rules, verbatim mode, network reachability monitor, opt-in test-case export, microphone picker.

**Deliberately not done:**

- **Task 11** (dictation state machine refactor) — deferred by the user's decision. The earlier claim
  that it was a "precondition" for context capture was proven wrong.
- **Task 19** (keep dictations out of clipboard history) — attempted, **removed**. Electron's
  `clipboard.writeBuffer` replaces the text instead of joining it; a self-verifying probe caught it
  before it broke every paste. The user also wants the history entry as a recovery path. Do not
  re-attempt without a native Win32 clipboard write.

## The one thing pending verification

The last change was a **design fix to context capture** and it has **never been run**. Context was
asking the model for a prose summary, and prose normalises spellings — `ayeesha@gmail.com` became
"Ayesha" every time. The context model now returns two parts:

```
ACTIVITY: <two sentences>
NAMES: Ayeesha, Astrea IT Services
```

`NAMES` is copied verbatim into its own cleanup-prompt block. **First job: have the user restart the
app, dictate into a Gmail compose addressed to `ayeesha@gmail.com`, and confirm from the log that
`visibleNameCount` is non-zero and the spelling survives.**

If it still normalises, stop iterating on context. The honest answer is that context is
probabilistic and **the vocabulary list is the deterministic tool** — adding `Ayeesha` there wins
every time by the precedence rule.

## Decisions already made — do not silently reverse these

- **Vocabulary beats on-screen context** when both name the same person. Explicit user input beats
  inference; a list that only sometimes wins is a lottery.
- **A blocked window yields no context at all** — not even the window title, and the block is not
  logged with identifying detail.
- **Rate limits are never retried.** Record the provider's cooldown, switch to the fallback model.
- **Context is best-effort and must never delay or fail a dictation.** It fires at recording *start*,
  and `result()` waits at most 1.2s.
- **`reasoning_effort: "none"` for the context call.** `"low"` made the model burn 5,106 characters
  thinking and return nothing.
- Every model call goes through `src/llm/completion-budget.ts`. Skipping it caused two separate bugs.

## How to work on this

- **Check evidence before theorising.** Four rounds of this task were lost to plausible-sounding
  guesses. The log is at `%APPDATA%/BayanFlow/logs/app.log` and the live settings at
  `%APPDATA%/BayanFlow/config.json`. Read both before proposing a cause.
- **Code changes need an app restart**; config changes do not. Verify which build is running before
  trusting a test result.
- Verify with `npm run build && npm test && npm run local:smoke`.
- Every finding, reversal, and deviation gets a **dated entry** in section 6 of the audit file. Never
  rewrite an old entry.

## Immediate risk

**65 files are uncommitted** and nothing has been committed since `213cfd9`. All of Tier 1 and Tier 2
lives in the working tree. Offer to commit it in reviewable chunks early.

## What is left

**Tier 3, in the recommended order:**

1. **Task 22** — hotkey layer as a pure reducer `(state, event, config) → (state, events, consume)`.
   Precondition for 23; makes the logic testable without a keyboard.
2. **Task 23** — low-level Windows keyboard hook so the hotkey stops leaking to the focused app.
   Real native work, real risk of wedging the keyboard. Build it behind the reducer.
3. **Task 25 + 26** — configurable OpenAI-compatible base URLs and per-stage timeout overrides.
   Together these unlock local models; 26 is a prerequisite because local models are slow.
4. **Task 32** — CHANGELOG, CI workflow, auto-updater. Without an updater most users never get fixes.
5. **Task 24** — UI Automation read path with clipboard fallback (read only; UIA cannot write).
6. **Tasks 27–31** — Paste Again shortcut, press-enter voice command, shortcut start delay, pipeline
   debug panel, retry-from-history.
7. **Task 33** — streaming transcription. Significant complexity, modest payoff for short dictations.
8. **Task 34** — voice macros. Lowest value in the audit; listed only for completeness.
9. **Task 11** — the state machine refactor, when a change actually strains against `main.ts`.

Start by asking me which of these to take, unless I have already said.

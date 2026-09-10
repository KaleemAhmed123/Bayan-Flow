# Capability Audit

## 1. Task

- **Name:** Capability audit — everything BayanFlow is missing, why it matters, and what to build.
- **Status:** in progress
- **Started:** 2026-09-09
- **Last updated:** 2026-09-09 (Tier 1 shipped; Tier 2 shipped except the deferred task 11)

This is an umbrella task. It records the full audit in one place so nothing is lost, and carries
the Tier 1 implementation. Later tiers get their own dated update entries here rather than new
files, per the append-only rule.

## 2. What you asked for

Your words, kept as constraints:

- "Analyze what is good there so we can implement it, and what are the good parts of it and our
  so we can compare, critize I am open to criticism."
- "Take your time no rush and don't worry about the language focus on logics and features."
- "Metadata + screenshot" for context capture — you want the screenshot path, not just the cheap
  half.
- "Does grok or other apis use huge token to process and images will we have to add another ocr
  model or something."
- "What about sensitive info (do we store everything on their local machine)."
- "I want to add everything that is missing so start with Tier 1 for now."
- "Add all comparison but don't use their name anywhere — add the missing things as fact like we
  did an audit on how we can make it better."
- "Nothing should be skipped, record everything we can steal or inspire from and we have to add
  it, even I would request to elaborate the findings."

Framing constraint, applied throughout: this document is written as **our own product audit**.
Findings are stated as facts about BayanFlow and as decisions about what BayanFlow will do. No
third-party product is named anywhere in this file.

## 3. Open questions

| # | Question | Recommendation | Your answer |
|---|---|---|---|
| 1 | Context capture: metadata only, or metadata + screenshot? | Metadata first, screenshot as opt-in phase 2 | **Metadata + screenshot — build both** |
| 2 | Do vision models need a separate OCR model? | No | **Answered in 4.1.3 — no, and we must not add one** |
| 3 | Is the image token cost material? | No, 2048 flat tokens per image | **Answered in 4.1.2** |
| 4 | Where does captured context get stored? | Memory only by default; disk only when debug capture is explicitly on | **Answered in 4.1.4** |
| 5 | Scope for now | Tier 1 | **Tier 1 now, everything else follows** |
| 6 | Doc location — the global rule says `docs/specs/`, this repo already uses `docs/tasks/` with an index | Follow the repo, it is the same system under a different name | **`docs/specs/`.** Moved 2026-09-09. Older shipped task files stay in `docs/tasks/`. |
| 7 | Your message ended with a bare "4." | — | **Typo, nothing missing.** |
| 8 | Should the Tier 2 state-machine refactor (task 11) come before context capture? | Originally yes; now **no** — see the 2026-09-09 Tier 1 close-out | **Deferred. Confirmed by you 2026-09-09.** |
| 9 | Should dictations be kept out of clipboard-history tools? | Originally yes (finding E1) | **No — keep them.** You want the history entry as a recovery path when a paste fails. Finding E1 is withdrawn; see the 2026-09-09 entry. |

## 4. Audit findings

Thirty-three findings across eight groups. Each one states what is missing, why it matters, the
evidence in our own code, and what we will build.

Severity: 🔴 hurts every dictation · 🟠 hurts often or silently · 🟡 quality-of-life · ⚪ internal

---

### 4.1 Group A — Output quality: what actually lands in the text box

This group is where the product is won or lost. Everything here changes the text the user sees.

---

#### 4.1.1 🔴 A1. We send zero context to the cleanup model

**What is missing.** When we clean a transcript we send the transcript and nothing else. The
model has no idea whether you are writing an email, a git commit message, a WhatsApp reply, or a
support ticket. It cannot know that the person you just said "Aisha" about is spelled "Aysha" on
the screen in front of you.

**Why it matters.** This is the single largest quality gap in the product. Same audio, same
model, same provider — and the output is worse than it needs to be, on every single dictation.
Proper nouns are the worst case: names, company names, project codenames, and product terms are
exactly the words speech-to-text gets wrong, and exactly the words that are usually visible on
screen at the moment you speak them.

**Evidence in our code.** [dictation-pipeline.ts:47-56](../../src/dictation/dictation-pipeline.ts#L47-L56)
calls `cleanup.clean(rawTextValue, { mode: "default" }, ...)`. The options object carries a single
field, `mode`, whose type has exactly one legal value. There is no channel for context because
none was ever designed. We do capture the target window title in
[text-inserter.ts:95](../../src/insertion/text-inserter.ts#L95) as `PasteTarget.title`, and then
use it only to verify we are pasting into the right window. **The information is already in
memory and we throw it away.**

**What we build.** A context service that collects, at recording start:

| Signal | Source on Windows | Cost |
|---|---|---|
| App name / executable | active window handle | free |
| Window title | already captured today | free |
| Selected text | clipboard read (we already do this for Rewrite) | ~50ms |
| Screenshot of the **active window only** | `desktopCapturer` | ~80ms |
| Two-sentence activity summary | one vision-model call | ~600ms, hidden |

**The timing is the whole trick.** Context capture must fire when recording *starts*, not when it
ends. It runs in parallel with the user speaking. A person talks for three to fifteen seconds;
the context call takes under one. By the time they release the key, the context is already
sitting in memory waiting. **Perceived latency added: zero.** If we get this wrong and fire it at
stop time, we add a full second to every dictation and the feature becomes a liability.

The summary is then injected into the cleanup prompt as a *spelling and formatting reference
only*, with an explicit rule that the model may not introduce any name or term the speaker did
not actually say. Context is there to fix "Aisha" → "Aysha". It is not there to invent content.

---

#### 4.1.2 🔴 A1a. Screenshot cost — the numbers you asked for

You asked whether images burn huge amounts of tokens. Here are the confirmed figures from the
provider's own vision documentation, checked 2026-09-09.

**Token cost: each image counts as a flat 2048 input tokens.**

That is the number regardless of resolution. This is important and slightly counter-intuitive:

- Sending a 400×300 thumbnail costs **the same 2048 tokens** as sending a 1920×1080 screenshot.
- Downscaling therefore saves **upload bandwidth and latency**, not money.
- So we downscale for speed, and we choose resolution purely on "can the model still read the
  text on screen", not on cost.

**Money.** 2048 tokens per dictation, on a cheap model, is a fraction of a cent. A heavy user
doing 100 dictations a day lands around **one to two dollars a month** in image tokens. On the
user's own API key. This is not a cost problem.

**The real cost is a second network round trip**, and as covered in 4.1.1 we hide it entirely by
running it during recording.

**Hard limits we must respect:**

| Limit | Value |
|---|---|
| Vision-capable models | `qwen/qwen3.6-27b`, `qwen/qwen3.8-27b` |
| Max images per request | 5 (`3.6-27b`) / 3 (`3.8-27b`) |
| Max total request size | 20 MB |
| Context window | 131K tokens |
| Token cost per image | 2048, flat |

We send exactly **one** image, so the per-request image cap is never in play. We will still cap
the encoded image well below 20 MB — a self-imposed ceiling around 400 KB after JPEG compression,
with the image simply dropped and the request retried text-only if it overshoots. A screenshot
must never be the reason a dictation fails.

**Design consequence:** because cost is flat per image and not per pixel, the right move is a
**single downscaled JPEG of the active window** — roughly 1024px on the long edge, quality around
0.5. Small enough to upload fast, large enough that the model can read UI text.

---

#### 4.1.3 🟡 A1b. We do NOT need an OCR model

You asked whether we would need to add OCR. **No, and adding one would be a mistake.**

**What OCR means:** Optical Character Recognition — a separate model whose only job is to turn a
picture of text back into text.

Vision language models already read text inside images natively. That is what "vision" means
here. Bolting an OCR model in front would mean:

- a second model dependency to install, ship, version, and debug
- a second round trip, adding latency to a path where latency is the whole battle
- **strictly worse output**, because OCR returns a flat wall of characters with no idea what any
  of it means, whereas the vision model can tell that "Aysha Khan" is the recipient of the email
  rather than a random string in a sidebar

We ask the vision model one question — *"what is this person doing right now, in two sentences"* —
and it uses the on-screen text to answer. That is the whole design.

**The one rung above this that we should take first, though:** on Windows, UI Automation can read
the *actual text* of the focused control as text — no picture, no vision model, no tokens at all.
Where UIA gives us clean text, that beats a screenshot on every axis. It is more work, so it is
Tier 3, but it is recorded here as the eventual better answer. The screenshot path is the general
fallback that works everywhere, including Chromium and Electron apps where UIA reads poorly.

---

#### 4.1.4 🔴 A1c. Privacy: what leaves the machine, what stays, what we must build

You asked directly: what about sensitive info, and do we store everything locally? Straight
answers.

**What is stored on the user's machine.** Everything, and only on their machine:

| Data | Where | Lifetime |
|---|---|---|
| API key | `config.json`, encrypted at rest via OS secure storage | until changed |
| Dictation history | `history.jsonl`, plain text, local only | newest 500 rows |
| Temp audio | OS temp dir | deleted on every exit path |
| Logs | app log dir, transcript text redacted | rolling |
| **Captured screenshot** | **memory only — see below** | **discarded after the request** |

There is no BayanFlow server. Nothing is uploaded to us because there is no "us" to upload to.

**What leaves the machine.** Requests to the user's configured AI provider. Today that is the
audio file and the transcript text. Once context ships it also includes the window title, the app
name, and — if the screenshot toggle is on — a JPEG of the active window.

**That last item is a genuine escalation and we will treat it as one.** A picture of the user's
active window can contain a password manager, a bank balance, a private DM, a medical record, or
someone else's personal data. "It goes straight to the AI provider and we never see it" is true
and is not sufficient. The following controls are **mandatory** and ship *with* the feature, not
after it:

1. **Off by default.** Screenshot capture is opt-in. First-run explains in one sentence what it
   sends and why, and the user chooses. Metadata-only context stays on by default because a
   window title is a far smaller exposure.
2. **Active window only, never the full screen.** We capture the single window the user is typing
   into. Their second monitor, their background Slack, their open bank tab are never in frame.
   This is a capture-API choice, not a crop — we never hold the wider image at all.
3. **App blocklist, shipped with sensible defaults.** No capture when the foreground app is a
   password manager, a banking or wallet app, or a private/incognito browser window. User can add
   their own entries. When the app is blocked we fall back to metadata-only silently — the
   dictation still works, it just gets less context.
4. **A visible indicator while capture is armed.** The user must never be surprised. The dock
   shows that context capture is on.
5. **Never written to disk.** The JPEG lives in memory, goes into one HTTPS request, and is
   dropped. The only exception is the debug capture in finding D1, which is separately opt-in,
   separately labelled, and off by default.
6. **Never in logs, never in the diagnostics export.** Our log redactor is extended to cover the
   screenshot data URL and the context summary before this feature merges.
7. **One switch kills it.** Turning the toggle off stops capture immediately and drops anything
   held.

**Positioning note.** Because the metadata-only path is genuinely good and costs the user nothing
in privacy, "BayanFlow does not look at your screen unless you ask it to" is a real differentiator
worth keeping and worth saying out loud in the README.

---

#### 4.1.5 🔴 A2. No custom vocabulary

**What is missing.** There is no way for a user to tell BayanFlow how to spell anything.

**Why it matters.** Every user has a set of maybe twenty words that speech-to-text will never get
right: colleagues' names, their company, their product, their internal jargon. Right now those
words are wrong on every dictation and **the user has no lever at all**. That is the kind of
small, constant friction that makes people quit a tool.

**Evidence in our code.** Grepping our source for "vocabular" returns exactly one hit, and it is
the word "vocabulary" inside a prompt sentence at
[cleanup-provider.ts:27](../../src/cleanup/cleanup-provider.ts#L27). There is no setting, no
storage, no prompt slot.

**What we build.**

1. A vocabulary textarea in Settings — one term per line.
2. The terms merged into the cleanup prompt with a strict rule: *use these only to correct the
   spelling of words the speaker already said; never insert one that was not spoken.* Without that
   rule the model will start sprinkling the user's product name into unrelated sentences.
3. The terms also pushed into the transcription prompt, where the speech model can bias toward
   them at recognition time — which fixes the word before cleanup ever sees it. We already have
   the mechanism at [transcription-prompt.ts:1](../../src/transcription/transcription-prompt.ts#L1),
   where `BASE_TERMS` is a hardcoded array. We simply concatenate the user's terms onto it.
4. A one-click "add the word I just copied" action in the tray menu, with duplicate checking.
   Adding vocabulary at the moment you notice a mistake is the only time anyone will actually do
   it — burying it in Settings means the field stays empty forever.

---

#### 4.1.6 🔴 A3. We detect silence hallucinations and then paste them anyway

**What is missing.** Speech-to-text models emit stock phrases when fed silence or background
noise. The common ones are *"Thank you."*, *"Thank you for watching."*, *"Please subscribe."*, and
*"Subtitles by the Amara.org community."* — artefacts of the video captions the model was trained
on. We do not filter any of them.

**Why it matters.** A user taps the hotkey by accident, or speaks too quietly, and **"Thank you
for watching." gets pasted into their Slack channel.** It looks broken, because it is. This is the
most embarrassing possible failure mode for a dictation tool.

**Evidence in our code — and this is the frustrating part.** We already fetch exactly the data
needed to catch this. [groq-transcription-service.ts:87](../../src/transcription/groq-transcription-service.ts#L87)
requests `response_format: "verbose_json"`, which returns per-segment `no_speech_prob` — the
model's own confidence that a segment contains no speech at all. We then parse it at
[groq-transcription-service.ts:159](../../src/transcription/groq-transcription-service.ts#L159),
count high-probability segments into `highNoSpeechSegmentCount`, put it in a confidence bucket, and
use all of it for **one purpose only: deciding whether to retry**. We never suppress anything.

**We built the sensor and never wired the alarm.**

**What we build.** A phrase list checked against the trimmed, lowercased, punctuation-stripped
transcript — but the match alone must never be enough to suppress. Someone genuinely saying "thank
you" into a chat window is a real dictation and must survive. So suppression requires **both**
conditions:

1. the normalised text is an exact match for a known artefact phrase, **and**
2. the segment's `no_speech_prob` is at or above a threshold, meaning the model itself is telling
   us there was probably no speech there.

If the provider omits segment metadata for any reason, we do not suppress — we log that we skipped
the check and pass the text through. Failing open is correct here: pasting a spurious "Thank you"
is bad, but silently eating someone's real words is worse.

Threshold starts conservative and is a tunable constant with a comment explaining what moving it
does in each direction.

---

#### 4.1.7 🟠 A4. Nothing checks whether cleanup obeyed its instructions

**What is missing.** Our cleanup prompt tells the model "do not answer questions", "do not
summarize", "do not explain". We never verify that it complied.

**Why it matters.** Dictate *"write a message to John saying I'm running late"* and a small
cleanup model will sometimes **do it** — you get a drafted message pasted instead of your own
sentence. Same for *"translate this to Spanish"*, *"make a poem about the moon"*, or *"ask the AI
to refactor the auth module"*. The user said words; they expect those words. They get a chatbot
response instead.

This is not rare. It is the characteristic failure of small instruction-tuned models used as text
processors, and it gets worse the shorter and more imperative the dictation is.

**Evidence in our code.** [cleanup-provider.ts:36-39](../../src/cleanup/cleanup-provider.ts#L36-L39)
lists the prohibitions. [groq-cleanup-provider.ts:95](../../src/cleanup/groq-cleanup-provider.ts#L95)
takes whatever came back and returns it. There is no check between those two points. **A prompt
instruction is a request, not a guarantee.**

**What we build.** A guard that compares the raw transcript against the cleaned output and falls
back to the raw transcript when the output looks like an *answer* rather than a *clean-up*. Two
independent signals:

1. **Assistant preamble.** The cleaned text starts with something like *"Sure,"*, *"Certainly,"*,
   *"Here's"*, *"I'd be happy to"* — and the raw transcript did not. A cleanup pass cannot invent
   a preamble that was never spoken.
2. **Token divergence.** Strip stop-words from both texts. If the raw transcript contained
   imperative markers (*write*, *make*, *ask*, *summarize*, *translate*, *tell*…) and almost none
   of the significant words survived into the output, the model rewrote rather than cleaned.

On a trip, we discard the cleaned text and insert the raw transcript. That is always safe: the
user's actual words, slightly rougher.

**Honest limitation, recorded up front.** This is a heuristic built on an English marker list. It
will not work on other languages and it will occasionally misfire on very short dictations. We
gate it so it only runs when no output-language translation was requested, and we make it a
setting the user can switch off. It is a safety net with holes, which is still infinitely better
than no net.

---

#### 4.1.8 🟠 A5. Our cleanup prompt misses five behaviours people actually need

**What is missing.** Our prompt covers punctuation, capitalisation, filler removal, and "don't
invent". Those are table stakes. Five specific behaviours that materially change output quality
are absent.

**Evidence in our code.** The full prompt is
[cleanup-provider.ts:12-49](../../src/cleanup/cleanup-provider.ts#L12-L49).

**What we add, and why each one earns its tokens:**

1. **Self-corrections.** People correct themselves constantly when speaking. *"Let's meet
   Thursday — no, actually Wednesday — after lunch"* must become *"Let's meet Wednesday after
   lunch."* Both the correction marker and the abandoned wording get deleted. Right now we paste
   the whole stumbling sentence. This is probably the highest-value single rule on the list,
   because self-correction is how humans talk.

2. **Spoken punctuation.** *"hi dana comma"* → *"Hi Dana,"*. Users who have used any dictation
   tool before expect "comma", "period", "new line" to become punctuation. When it does not work
   they assume the app is broken.

3. **Spoken developer syntax.** *"user underscore id"* → `user_id`. *"dash dash fix"* → `--fix`.
   Our own README positions the product at developers writing issues, PR comments, and docs. Note
   the trap worth encoding explicitly: in *"rename user id to user underscore id"*, only the
   second span was spoken as a technical string. Converting both produces the nonsense *"rename
   user_id to user_id"*.

4. **Email shape.** When the destination is clearly email, put the salutation on its own line,
   blank line, then the body, and put a spoken closing in its own final paragraph. Critically:
   **never invent a greeting or a closing that was not spoken.** This rule only becomes possible
   once context (A1) tells us the destination is email — the two findings are linked.

5. **List requests, and when they are not list requests.** *"numbered list"* means make a list.
   Saying *"first… second… third…"* in ordinary prose does not. Neither does using the word
   "bullet" inside a sentence. Without this rule the model turns every enumerated thought into
   markdown, which is wrong in a chat box.

**Counter-note, deliberately recorded.** It is possible to take this too far and end up with a
120-line system prompt that is paid for in latency on every single dictation and that grew one bug
report at a time. We adopt these five because each maps to a behaviour users will hit weekly. We
do not adopt rules speculatively. Prompt length is a runtime cost, not a free document.

---

#### 4.1.9 🟡 A6. No way to skip cleanup

**What is missing.** Cleanup is all or nothing, via the `cleanupEnabled` boolean in
[config-store.ts:17](../../src/config-store.ts#L17).

**Why it matters.** Sometimes the user wants their exact words: a quote, a password hint, a
command, a phrase in a language the cleanup model handles badly. Today their only option is to
disable cleanup globally in Settings and remember to turn it back on.

**What we build.** A "preserve exact wording" mode that skips cleanup while keeping the rest of the
pipeline — transcription, vocabulary biasing, macros, and translation — intact. Reachable
per-dictation rather than buried in Settings.

---

#### 4.1.10 🔴 A7. Transcription language is hardcoded to English

**What is missing.** The language sent to the speech model is a string literal.

**Why it matters.** The product is named **Bayan** — بیان — *expression, speech* in Urdu and
Arabic. Shipping English-only transcription, with no setting, in a product with that name, is the
most obviously wrong decision in the codebase. It also silently degrades English spoken with a
non-native accent, because forcing `language: "en"` removes the model's ability to detect and
adapt.

**Evidence in our code.** [dictation-pipeline.ts:36](../../src/dictation/dictation-pipeline.ts#L36)
passes `{ language: "en" }`. [groq-transcription-service.ts:61](../../src/transcription/groq-transcription-service.ts#L61)
defaults to `"en"` again if nothing is passed. Two hardcoded defaults, one wrong assumption. The
`AppConfig` type at [types.ts:10](../../src/types.ts#L10) has no language field at all.

**What we build.**

1. **Transcription language** — a Settings dropdown, defaulting to *Auto-detect* rather than
   English. Auto-detect is the correct default for a multilingual user base.
2. **Output language** — optional. When set, the text is translated to that language before being
   pasted. This turns the product into "speak Urdu, paste English", which is a genuine feature and
   not merely a bug fix.
3. Both flow into the pipeline instead of the literals.

---

### 4.2 Group B — Reliability: the app staying up under real conditions

---

#### 4.2.1 🔴 B1 + B2. One model, no fallback, and we retry *into* rate limits

**What is missing.** A single cleanup model with no alternative, and no understanding of rate
limiting.

**Why it matters.** When the configured model is rate-limited or unavailable, the feature dies.
Worse: our generic retry logic makes it actively worse.

**Evidence in our code.** [errors.ts:120](../../src/observability/errors.ts#L120) classifies HTTP
429 as retryable. [errors.ts:130-146](../../src/observability/errors.ts#L130-L146) then retries the
identical request up to three times with linear backoff. **A 429 means "you are sending too much"
and our response is to send it three more times.** We burn the user's quota faster, delay the
failure by roughly two seconds, and then fail anyway. Meanwhile
[config-store.ts:20-21](../../src/config-store.ts#L20-L21) shows one `cleanupModel` field with no
companion.

**What we build.**

1. **A fallback model.** Primary and fallback in Settings. On failure of the primary for any
   reason, the request goes to the fallback rather than to the user as an error.
2. **A cooldown manager**, keyed by model, that reads the provider's own rate-limit headers rather
   than guessing:
   - `retry-after` — the authoritative wait on a 429
   - `x-ratelimit-reset-tokens` — the per-minute token bucket reset
   - `x-ratelimit-remaining-requests` and `x-ratelimit-reset-requests` — the per-day request quota
3. **Two tiers of cooldown.** A per-minute limit lives in memory and expires on its own. A
   **per-day** limit is persisted to disk, so it survives an app restart and we do not fire a
   doomed request every time the app launches. The daily reset time is shown in Settings so the
   user understands why the feature is quiet instead of assuming it is broken.
4. **Skip the doomed request entirely.** Before sending, ask the cooldown manager which model is
   actually available. If the primary is cooling down, go straight to the fallback and save the
   round trip. If both are cooling down, fail immediately with a message that says *when* it will
   work again.
5. **Remove 429 from the blind retry path.** Rate limits get the cooldown treatment. Timeouts and
   5xx keep the existing backoff, which is correct for those.

The header-parsing needs care: durations arrive in several shapes — bare seconds (`"2"`),
single-unit (`"7.66s"`, `"120ms"`), and compound (`"2m59.56s"`, `"1h0m0s"`). A malformed header
must never yield a negative, infinite, or NaN cooldown, because that would either spin or
permanently disable a model. This gets its own unit test.

---

#### 4.2.2 🟠 B3. We cannot tell "you are offline" from "the provider is slow"

**What is missing.** Any awareness of network reachability.

**Why it matters.** Both conditions surface identically — a hung socket that trips our timeout. So
a user with their wifi off is told *"Groq is temporarily unavailable"*, which sends them to check
a status page instead of their network settings. Wrong diagnosis, wasted time, and it makes the
app look like it is blaming someone else for a local problem.

**Evidence in our code.** [errors.ts:84-95](../../src/observability/errors.ts#L84-L95) maps
`ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`, `ECONNREFUSED` and any 5xx to a single message about the
provider. `ENOTFOUND` in particular is *far* more likely to mean the user's DNS is unreachable
than that the provider has vanished.

**What we build.** A reachability monitor started once at launch, tracking online/offline state
cheaply in the background. Error classification consults it: offline produces *"You appear to be
offline"* with no retry button, because retrying will not help. Online plus timeout keeps the
current provider message and its retry button. Defaults to "online" so the very first request,
before the monitor has reported, is never wrongly blamed on the network.

---

#### 4.2.3 🟠 B4. We paste while the user may still be holding modifier keys

**What is missing.** Any check that the hotkey has been physically released before we send Ctrl+V.

**Why it matters.** If the user is still holding Ctrl and Shift when our paste fires, the target
application receives **Ctrl+Shift+V**, not Ctrl+V. In many applications that is "paste as plain
text"; in others it is an entirely unrelated command. The result is a paste that silently does the
wrong thing or nothing at all — and it is intermittent, so it reads as flakiness rather than as a
bug with a cause.

The tap-to-latch flow makes it more likely, not less, because a fast tap can put the paste and the
key-up in a genuine race.

**Evidence in our code.** [text-inserter.ts:180-186](../../src/insertion/text-inserter.ts#L180-L186)
does `await sleep(75)` and then sends the paste shortcut. Seventy-five milliseconds is a guess, not
a check. Our hotkey listener at [hotkey-listener.ts:70](../../src/hotkey/hotkey-listener.ts#L70)
already tracks press state and knows perfectly well whether the key is down — the two modules
simply do not talk.

**What we build.** Before pasting, poll for the shortcut keys being physically up, with a short
interval and a bounded number of attempts. If they are still held when the budget runs out, paste
anyway rather than dropping the user's text — a possibly-wrong paste beats a silently discarded
dictation. The wait costs nothing in the common case because the user has almost always released
by the time transcription returns.

---

#### 4.2.4 🟠 B5. Our hotkey leaks through to whatever app is focused

**What is missing.** The ability to consume a keystroke.

**Why it matters.** `Ctrl+Shift+Space` fires our dictation **and** reaches the focused
application, which may well have its own binding for it. The user gets our recorder plus whatever
their editor decided to do. Our own README currently handles this by telling the user to *pick a
different hotkey* — that is a workaround presented as documentation.

**Evidence in our code.** [hotkey-listener.ts:1](../../src/hotkey/hotkey-listener.ts#L1) is built
on a listen-only global hook. It is an observer by design. It has no mechanism to swallow an
event, so there is no small fix here.

**What we build — Tier 3, flagged as real work.** Suppressing keystrokes needs a low-level Windows
keyboard hook that returns a "handled" decision per event. That is native work with real risk: get
it wrong and you can wedge the user's keyboard. It is recorded here as the correct fix, scheduled
deliberately late, and it should be built behind the reducer described in F4 so the decision logic
is testable without a keyboard attached.

---

#### 4.2.5 🟡 B6. Fixed timeouts break slow and local models

**What is missing.** Any way to extend request timeouts.

**Evidence in our code.** `GROQ_TIMEOUT_MS = 45_000` appears as a module constant in both
[groq-transcription-service.ts:9](../../src/transcription/groq-transcription-service.ts#L9) and
[groq-cleanup-provider.ts:14](../../src/cleanup/groq-cleanup-provider.ts#L14).

**Why it matters.** It is fine for a fast hosted provider and wrong for everything else. A locally
hosted model on a cold start, or a long recording on busy hardware, routinely exceeds 45 seconds.
This blocks finding G4 (self-hosted support) entirely.

**What we build.** Per-stage timeout overrides — transcription, cleanup, context — in advanced
settings. Only positive values are honoured; anything else falls back to the default.

---

### 4.3 Group C — Input and control

---

#### 4.3.1 🟠 C1. No microphone selection

**What is missing.** The user cannot choose which microphone to use, and we do not notice when
devices change.

**Why it matters.** Anyone with a headset, a webcam, and a laptop mic has three inputs and the OS
default is frequently the worst one. When they unplug the headset mid-session we keep addressing a
device that is gone. "It just stopped working" support tickets come from here.

**What we build.** A device list in Settings, a persisted selection, listeners for device
add/remove that refresh the list, and a graceful fallback with a visible message when the chosen
device disappears — rather than a silent switch the user cannot diagnose.

---

#### 4.3.2 🟡 C3. Paste Again is a button, not a shortcut

**What is missing.** A dedicated global shortcut to re-paste the most recent result.

**Why it matters.** The recovery path we already built is good — when a paste is blocked we keep
the text on the clipboard and offer "Copy again". But it requires finding and clicking the dock.
The user's hands are on the keyboard. A shortcut is one keystroke instead of a mouse hunt at
exactly the moment something already went wrong.

**What we build.** A third configurable global shortcut, defaulting to disabled so we do not grab
a binding nobody asked for.

---

#### 4.3.3 🟡 C4. No "press enter" voice command

**What is missing.** Saying *"…press enter"* at the end of a dictation should paste the text and
then submit it.

**Why it matters.** It closes the loop on the single most common dictation use case: firing off a
chat message. Speak, and it is sent. Without it the user still has to reach for the keyboard,
which breaks the whole "never touch the keyboard" promise.

**What we build.** A trailing-phrase match on the transcript. The command phrase is stripped from
the text, and Enter is pressed after the paste settles. Behind a setting, off by default, because
an accidental submit is worse than an accidental non-submit.

---

#### 4.3.4 ⚪ C5. No voice macros

**What is missing.** Mapping a spoken phrase to a fixed block of text.

**What we build.** A phrase→payload list, matched on the normalised transcript before cleanup
runs. Cheap to build on top of the vocabulary storage from A2.

**Honest assessment, recorded rather than hidden:** this is the lowest-value item in the whole
audit. Macro features are rarely discovered and rarely used. It is listed because you asked for
everything, and it is scheduled last for the same reason.

---

#### 4.3.5 🟡 C6. No shortcut start delay

**What is missing.** A configurable delay between the hotkey firing and recording starting.

**Why it matters.** Two things. A brush against the key starts a spurious recording. And a
combination shortcut is not pressed atomically — the user's fingers land a few milliseconds apart,
which can fire a partial match. A small configurable delay absorbs both.

---

#### 4.3.6 🟠 C7. Rewrite reads text only through the clipboard

**What is missing.** Any way to read the user's text that does not involve hijacking their
clipboard.

**Why it matters.** This is architectural, so it deserves a full accounting. Every rewrite
currently performs: save clipboard → Ctrl+C → Ctrl+A → Ctrl+C → send text to model → Ctrl+V →
restore clipboard on a timer. That is four synthetic keystrokes and two clipboard mutations per
rewrite. It works, we handle its failures well, and it is genuinely the only thing that works
reliably for writing into Chromium and Electron applications. But it is fragile by construction,
it fights the user's clipboard manager, and the restore is timer-based, so a fast user can copy
something in the window between our write and our restore and lose it.

**Evidence in our code.** [text-inserter.ts:145-175](../../src/insertion/text-inserter.ts#L145-L175)
is the read path. The comment there is honest about the core problem: Ctrl+C alone cannot
distinguish "there is a selection" from "there is no selection", because some editors copy the
current line when nothing is selected.

**What we build — Tier 3.** A UI Automation *read* path. Windows UI Automation can return the
selected text and the full text of a focused control **as text**, with no keystrokes and no
clipboard involvement. Two important caveats to record now:

- UIA **cannot reliably write** text back — that limitation is already documented in our
  overlay-rebuild notes. So the clipboard write path stays regardless. This finding improves
  reading only.
- UIA reads poorly in some Chromium and Electron applications, which are exactly the apps our
  users live in. So this is an *optimisation with a fallback*, never a replacement. Try UIA, fall
  back to the clipboard.

Same read path also feeds context capture in A1, which is a second reason to build it.

---

### 4.4 Group D — Diagnosis and support

The theme of this group: **when a user says "the output was bad", we currently have no way to find
out why.** Our logs deliberately redact transcript text, which is right for privacy and leaves us
blind. Every quality complaint becomes guesswork.

---

#### 4.4.1 🟠 D1. No test-case export

**What is missing.** A way to capture one complete dictation for debugging.

**What we build.** An opt-in "capture this dictation" action that produces a single ZIP:

```
case.json       metadata, raw transcript, cleaned transcript, every prompt sent,
                model IDs, settings snapshot, timings
screenshot.jpg  the context screenshot, if one was captured
audio.webm      the original recording
```

**Why this specific shape.** It makes a quality bug **reproducible**. With the audio and the exact
prompts we can re-run the pipeline offline, change one variable, and see what moves. Right now a
bad-output report gives us nothing to work with.

**Privacy is the entire design constraint here.** This bundle is the most sensitive artefact the
app can produce — it deliberately contains everything we normally refuse to store. Therefore: off
by default, per-dictation and never automatic, written only to a location the user picks through a
save dialog, never auto-uploaded anywhere, and clearly labelled with what is inside before it is
written.

---

#### 4.4.2 🟡 D2. No pipeline debug view

**What we build.** A developer panel showing the last run stage by stage: captured context, raw
transcript, prompt sent, cleaned result, which model answered, and where the time went. Hidden
behind a debug toggle.

**Why it matters.** It turns "polish made it worse" from an argument into an observation. It is
also the fastest way for us to tune prompts, because the feedback loop drops from minutes to
seconds.

---

#### 4.4.3 🟡 D3. Cannot retry a past dictation

**What is missing.** History entries are read-only records.

**Evidence in our code.** [history-store.ts:46-58](../../src/history/history-store.ts#L46-L58)
stores `raw` and `polished` text but no reference to the audio, which we delete on every exit path.

**What we build.** Optional short-term audio retention tied to history, and a "run this again"
action that re-executes cleanup — or the whole pipeline — on a stored entry. This is what makes a
model or prompt change measurable: re-run yesterday's twenty dictations and compare.

Retention is opt-in with a hard cap and an explicit note in the privacy section, because keeping
audio contradicts our current delete-always policy and that trade must be the user's to make.

---

#### 4.4.4 🟡 D4. Diagnostics export contains logs only

**Evidence in our code.** [main.ts:1171](../../src/main.ts#L1171) exports sanitised logs, with
line-level scrubbing at [main.ts:1259](../../src/main.ts#L1259).

This is correct and well built. The gap is that logs alone cannot explain a quality problem — by
design, they contain no transcript text. D1 is the answer; this entry exists so the relationship
between the two is recorded.

---

### 4.5 Group E — Privacy and clipboard hygiene

---

#### 4.5.1 🟠 E1. Every dictation pollutes the user's clipboard manager

**What is missing.** A marker telling clipboard history tools not to store what we write.

**Why it matters.** This is a genuine privacy leak that we cause. A user with any clipboard
manager — and power users all have one — accumulates a permanent, searchable log of everything
they have ever dictated, in a third-party tool, outside all of our careful redaction. We spent
real effort keeping transcripts out of our own logs and then hand every one of them to a different
application.

**Evidence in our code.** [text-inserter.ts:175](../../src/insertion/text-inserter.ts#L175) writes
with a plain `clipboard.writeText(text)`.

**What we build.** Write the clipboard with the platform's "transient" or "history-excluded"
marker so well-behaved clipboard managers skip it. A setting for users who *want* dictations in
their clipboard history, because some do.

---

#### 4.5.2 🔴 E2. No app blocklist for context capture

Covered in full under 4.1.4. Listed separately here because it is a hard blocker: **the screenshot
feature does not merge without it.**

---

### 4.6 Group F — Architecture and code health

---

#### 4.6.1 ⚪ F1. `main.ts` is 1,356 lines of module-level mutable globals

**What is missing.** A state machine at the level where the state actually lives.

**Why it matters.** Recording state, dock state, insertion state, config, and timers are all
module-scoped `let` bindings in one file. It works, because the Electron main process is
single-threaded — but there is no explicit state model, no invariant that can be checked, and **no
test covering the orchestration itself.** Every one of the features in this audit adds state to
that file. Adding them to the current structure compounds the problem.

**The frustrating part:** we already know how to do this properly. `recorder-session.ts` and
`overlay-state.ts` are clean, pure, well-tested state machines. **We had the pattern and did not
apply it at the top level.**

**What we build.** Extract a dictation session state machine — the same shape as the two that
already exist — covering idle → capturing context → recording → transcribing → cleaning →
inserting → done/failed, with cancellation valid at every stage. Then `main.ts` becomes wiring.
This is not a rewrite for its own sake: it is the precondition for adding fallback models, context
capture, and modifier-release waiting without the file becoming unmaintainable.

---

#### 4.6.2 ⚪ F2. `CleanupMode` is a single-member union

**Evidence.** [types.ts:8](../../src/types.ts#L8) declares `export type CleanupMode = "default";`
and it is threaded through `CleanupOptions`, `buildCleanupPrompt`, and the pipeline.

An abstraction with exactly one implementation, doing nothing. Either A6 gives it a second member
and it earns its place, or it gets deleted. Do not leave it as decoration.

---

#### 4.6.3 ⚪ F4. The hotkey layer is not a reducer and is barely tested

**Evidence.** [hotkey-listener.ts:26-29](../../src/hotkey/hotkey-listener.ts#L26-L29) holds
`isPressed` and `pressedAt` as mutable instance fields, with logic spread across two event
handlers. Its test file is 52 lines.

**Why it matters.** Hold-versus-tap, latching, cancel, and the eventual consume decision from B5
are genuinely intricate. Intricate logic mixed with I/O is logic that cannot be tested.

**What we build.** Restructure as a pure reduction: `(state, event, config) → (newState,
emittedEvents, consumeDecision)`. The event tap or hook stays a thin shell that feeds events in and
acts on what comes out. This makes B5 testable before we ever attach a real keyboard hook, and it
is the single highest-leverage internal change in the audit.

---

### 4.7 Group G — Shipping and distribution

---

#### 4.7.1 🟡 G1–G3. No changelog, no CI, no updater

**What is missing.** The machinery of shipping a product rather than building one.

- **No CHANGELOG.** Users cannot see what changed. We cannot either.
- **No continuous integration.** `npm run ci` exists in [package.json](../../package.json) and
  nothing runs it automatically. Our tests are good — roughly 1,520 lines covering the pure
  modules — and nothing enforces them.
- **No auto-updater.** Shipping a fix means asking every user to re-download an installer. In
  practice that means most users never get the fix.

**What we build.** A `CHANGELOG.md` on semantic versioning. A CI workflow running build plus tests
on every push and pull request. An update checker that compares versions, shows the release notes,
and points at the new installer.

---

#### 4.7.2 🟠 G4. Hard lock-in to one provider

**What is missing.** Configurable API base URLs.

**Evidence in our code.** We import and construct the vendor SDK directly in
[groq-transcription-service.ts:1](../../src/transcription/groq-transcription-service.ts#L1),
[groq-cleanup-provider.ts:1](../../src/cleanup/groq-cleanup-provider.ts#L1), and the rewrite
provider. The SDK is a devDependency bundled at build time, so the endpoint is baked in.

**Why it matters.** Three separate reasons, all real:

1. **Privacy.** Some users will not send audio or screenshots to a third party at all. A local
   model is the only acceptable answer for them, and right now we have no answer.
2. **Cost and quota.** Users on a free tier hit limits. Their own hardware has no quota.
3. **Resilience.** Today, one provider having a bad afternoon means our product does not work.

**What we build.** Configurable base URLs — one for transcription, one for chat, because they are
often different services — using the OpenAI-compatible request shape both already speak. This
opens up locally hosted models and any compatible provider. It pairs directly with B6, since local
models need longer timeouts.

Our existing retired-model remapping in
[config-store.ts:27-36](../../src/config-store.ts#L27-L36) must be scoped so it only rewrites model
IDs when the base URL is still the default provider — otherwise we would silently rewrite a user's
local model name into a hosted one.

---

### 4.8 Group H — Latency

---

#### 4.8.1 🟡 H1. No streaming transcription

**What is missing.** Audio is uploaded as one file after recording stops. Nothing is transcribed
until the user has finished speaking.

**Why it matters.** For a thirty-second dictation the user waits for the entire upload and
transcription after they stop. Streaming over a websocket during recording means the text is
substantially done the moment they release the key, and it lets the dock show live partial text,
which makes the app *feel* dramatically faster even when total time is similar.

**Honest cost note.** This is significant complexity: a websocket lifecycle, partial-versus-final
event handling, reconnection, and a fallback to the file path when streaming is unavailable. For
the short dictations that dominate real usage, the payoff is modest. **Scheduled last on purpose.**

---

#### 4.8.2 🔴 H2. Context capture must run during recording

Recorded here as a first-class engineering constraint rather than a detail of A1, because getting
it wrong silently ruins the feature.

Capture starts on the same event that starts the microphone. It runs concurrently with the user
speaking. If it has not finished by the time recording stops, we proceed with whatever metadata we
already have and skip the model-generated summary. **Context is best-effort and must never delay
or fail a dictation.**

---

### 4.9 What we already do well — do not regress these

Recorded deliberately. Several of these are better than what is typical, and the work below must
not damage them.

1. **Output-token budgeting.** [completion-budget.ts](../../src/llm/completion-budget.ts) reasons
   about reasoning models spending completion budget on thinking before emitting a character,
   scales the ceiling with input size, enforces a floor and a cap, **detects truncation via
   `finish_reason === "length"` and throws rather than pasting a clipped sentence**, and drops the
   `reasoning_effort` hint gracefully when an API rejects it. Every new model call added by this
   audit routes through it.

2. **Retired-model self-healing.** [config-store.ts:27](../../src/config-store.ts#L27) remaps dead
   model IDs on both load and save, so an old config repairs itself instead of failing forever.

3. **Transcription confidence scoring and retry.**
   [groq-transcription-service.ts:196](../../src/transcription/groq-transcription-service.ts#L196)
   buckets `avg_logprob` and retries once with a more conservative prompt on weak audio.

4. **Pure, tested state modules.** `overlay-state.ts` and `recorder-session.ts`. One anchor, one
   width, nothing async in the geometry. These are the model for F1 and F4.

5. **Test discipline.** ~1,520 test lines against ~6,500 source lines. Every finding in this audit
   ships with tests.

6. **Security hardening.** IPC sender-ID checks, session-ID validation on recorder payloads,
   `contextIsolation`, `sandbox: true`, a permission handler scoped to media for a single
   `webContents`, and an API-key regex scrubber on log lines.

7. **Redo instead of approve.** We paste immediately and offer Redo, with an explicit `attempt`
   counter injected into the prompt — because at temperature 0 a plain re-run returns
   byte-identical text. See [rewrite-actions.ts:75](../../src/rewrite/rewrite-actions.ts#L75). This
   was thought through and it is right.

8. **The Rewrite menu.** A hotkey, eight named actions, and a custom instruction box, needing no
   voice at all. It is a distinct product surface and a real differentiator. **Do not let
   dictation-parity work erode it.**

9. **One dock, one anchor, one recovery button per failure.** The error UX is genuinely good.

---

## 5. Tasks

### Tier 1 — now

- [x] 1. Suppress silence hallucinations using the `no_speech_prob` we already collect (A3)
- [x] 2. Transcription language setting, defaulting to auto-detect; remove both hardcoded `"en"` literals (A7)
- [x] 3. Output language setting with translate-before-paste (A7)
- [x] 4. Custom vocabulary: storage, Settings field, cleanup prompt slot, transcription prompt biasing (A2)
- [x] 5. Tray action to add the copied word to vocabulary, with duplicate check (A2)
- [x] 6. Fallback model setting (B1)
- [x] 7. Rate-limit cooldown manager with header parsing, two-tier memory/disk storage, and doomed-request skipping (B2)
- [x] 8. Remove 429 from the blind retry path (B2)
- [x] 9. Wait for modifier release before pasting (B4)
- [x] 10. Tests for every item above

### Tier 2 — next

- [ ] 11. Dictation session state machine; reduce `main.ts` to wiring (F1)
- [x] 12. Context capture — metadata path, fired at recording start (A1, H2)
- [x] 13. Context capture — screenshot path, active window only, opt-in (A1)
- [x] 14. App blocklist and privacy controls for context capture — **blocks item 13** (E2)
- [x] 15. Instruction-execution guard (A4)
- [x] 16. Cleanup prompt: self-corrections, spoken punctuation, dev syntax, email shape, list detection (A5)
- [x] 17. Preserve-exact-wording mode; resolve or delete `CleanupMode` (A6, F2)
- [x] 18. Network reachability monitor and error reclassification (B3)
- [~] 19. Clipboard transient marker — **attempted, removed.** Provably blocked by Electron; dictations stay in clipboard history on purpose (E1)
- [x] 20. Test-case export, opt-in (D1)
- [x] 21. Microphone picker with hot-plug handling (C1)

### Tier 3 — later

- [ ] 22. Hotkey layer as a pure reducer (F4)
- [ ] 23. Low-level keyboard hook that can consume the keystroke (B5)
- [ ] 24. UI Automation read path with clipboard fallback (C7)
- [ ] 25. Configurable OpenAI-compatible base URLs (G4)
- [ ] 26. Per-stage timeout overrides (B6)
- [ ] 27. Paste Again global shortcut (C3)
- [ ] 28. Press-enter voice command (C4)
- [ ] 29. Shortcut start delay (C6)
- [ ] 30. Pipeline debug panel (D2)
- [ ] 31. Retry-from-history with optional audio retention (D3)
- [ ] 32. CHANGELOG, CI workflow, auto-updater (G1–G3)
- [ ] 33. Streaming transcription (H1)
- [ ] 34. Voice macros (C5)

## 6. Updates

### 2026-09-09 — audit

Read all 6,500 lines of BayanFlow source plus tests, build scripts, and docs. Benchmarked against a
mature dictation product in the same category to find capability gaps. Thirty-three findings
recorded above, each with evidence from our own code.

Two of the findings are **live defects, not gaps**:

- **A3** — we request `verbose_json`, parse `no_speech_prob`, compute a confidence bucket, and then
  never use any of it to suppress a hallucinated phrase. Users can have "Thank you for watching."
  pasted into a chat window today.
- **B4** — we `sleep(75)` and paste, with no check on whether modifier keys are still held. The
  target app can receive Ctrl+Shift+V instead of Ctrl+V. Intermittent, so it reads as flakiness.

Also confirmed: **B2 makes rate limiting actively worse**, because our generic retry treats a 429
as transient and re-sends the identical request three times.

### 2026-09-09 — screenshot context questions answered

Checked the provider's vision documentation directly rather than relying on secondary sources.

- **Images cost a flat 2048 input tokens each, regardless of resolution.** Downscaling buys latency
  and bandwidth, not money. Roughly one to two dollars a month for a heavy user, on their own key.
  Not a cost problem.
- Vision models: `qwen/qwen3.6-27b` (up to 5 images) and `qwen/qwen3.8-27b` (up to 3). 20 MB max
  request. 131K context. We send one image, so the per-request cap never binds.
- **No OCR model needed, and adding one would be a regression** — a second dependency, a second
  round trip, and worse output, because OCR returns characters with no understanding of what they
  mean.
- Everything stays on the user's machine. The screenshot is memory-only, never written to disk,
  never logged, never in the diagnostics export.
- Screenshot capture ships **only** with the full control set in 4.1.4: off by default, active
  window only, app blocklist, visible indicator, and a kill switch. Item 14 blocks item 13.

Noted for later: on Windows, UI Automation can read on-screen text *as text*, with no image and no
tokens. That is strictly better than a screenshot where it works, and it fails in exactly the
Chromium and Electron apps our users live in. So it is an optimisation with a screenshot fallback,
not a replacement. Recorded as C7.

### 2026-09-09 — Tier 1 shipped

All ten Tier 1 items implemented, with tests. The suite went from 115 to 150 tests, all passing.
Local smoke passed: Electron stayed alive, wrote its startup log, and painted 3 non-blank dock frames.

Two changes went further than the task list said, both to fix a root cause rather than a symptom:

- **Right-hand modifier keys matched nothing.** While wiring the paste guard it turned out
  `matchesGlobalKey` never recognised the right Ctrl, Shift, Alt, or Meta keys, because the keyboard
  hook spells them `CTRLRIGHT` while the matcher only knew `RIGHT CTRL`. That silently broke
  hold-to-talk release detection for anyone using the right-hand modifiers, not just the new guard.
  Fixed in the shared matcher so every caller benefits.
- **The paste guard moved down a level.** It was going to sit in front of the paste shortcut only. It
  now sits in `sendKeyboardShortcut`, which every synthetic shortcut routes through, so select-all
  and copy are protected too — Ctrl+Shift+A is as wrong as Ctrl+Shift+V.

One design decision changed during implementation. The plan said "honour `retry-after` and wait".
Waiting up to five seconds inside a request while a perfectly good fallback model sits idle is worse
than switching immediately, so rate limits are now **not retried at all** at the request level. The
cooldown store records the provider's wait, the provider moves to the fallback, and the user-facing
message says when the primary will work again. Simpler code, faster path.

### 2026-09-09 — Tier 1 close-out: manual test, three gaps found and fixed

**Manual verification passed.** Vocabulary was tested with the Aisha / Ayesha case and the intended
spelling lands correctly. That is the first genuine end-to-end confirmation that A2 works as designed.

**Doc moved** from `docs/tasks/` to `docs/specs/`. Older shipped task files stayed put, per the rule
that existing files do not move.

A verification pass over Tier 1 — actually grepping the code rather than trusting the checklist —
turned up three gaps that the task list had let through:

1. **Vocabulary never reached the Rewrite path.** Task 4 said "cleanup prompt slot, transcription
   prompt biasing", and that is literally what got built. But a user does not see that distinction:
   they add "Ayesha", dictation gets it right, then they hit the rewrite hotkey and the rewrite
   model — which never saw the vocabulary — quietly changes it back. Fixed: `RewriteOptions` now
   carries vocabulary, and both call sites pass it.
2. **Rewrite had no fallback model and no cooldown.** It uses the same model id as cleanup, so a
   rate limit killed rewrite completely while dictation sailed past on the backup. Fixed by pulling
   the fallback loop out of the cleanup provider into a shared `withModelFallback` helper, which
   both providers now use. Fixing it by copying the loop would have guaranteed the two drift apart.
3. **The transcription result claimed `"en"` when it did not know.** With auto-detect on and a
   provider that omits the language field, we reported English. Nothing consumes that value today,
   which is exactly why it would have become a real bug later. Now reports empty for unknown.

Also added the new settings to the config save log — the fallback model, both languages, and the
vocabulary **count**. The count, never the terms: vocabulary is user content and the logger's job is
to stay free of it.

Suite is now **155 tests, all passing**.

### 2026-09-09 — Tier 2 part 1: context capture, instruction guard, verbatim mode

Six of the eleven Tier 2 items shipped: 12, 13, 14, 15, 16, 17. Suite is now **195 tests, all
passing**; local smoke passing.

**Task 11 was deliberately NOT done, and the earlier plan was wrong about it.** Section 4.6.1 called
the dictation state machine "the precondition" for context capture. Building context capture proved
that claim false: it added one service object, one `start()` call, and one `resolveAppContext`
callback to `main.ts`. That is not the change that makes a 1,400-line file unmanageable. Doing a
500-line refactor with real regression risk, no user-visible benefit, and no existing tests, *before*
the user-visible work, would have been building on speculation. It stays on the list and should be
done when a change actually strains against the current structure. Recorded as open question 8.

**One privacy rule got stricter than section 4.1.4 described.** That section said a blocked app
"falls back to metadata-only". That is wrong: "Chase Bank — Accounts" is sensitive as a *title*, so
withholding the screenshot while forwarding the window name would have missed the point. A blocked
window now yields **no context at all** — no title, no app name, no summary, and no provider request.
The block is also not logged with any identifying detail, since writing down which window we refused
to look at defeats the refusal.

**Two things learned while building:**

- `isBlockedWindow` originally lowercased the window title but not the patterns, so a capitalised
  entry would silently never match. Caught by a test written specifically to check the assumption.
  This is the privacy gate — a pattern that quietly fails to match is the one failure mode that
  cannot be tolerated — so the function now lowercases both rather than trusting its caller.
- An untitled window is treated as blocked. We cannot reason about a window we cannot name, and
  defaulting to "capture it" would have been the wrong direction to be wrong in.

**Verbatim mode resolved finding F2.** `CleanupMode` was a single-member union doing nothing. It now
has a real second member, and the pipeline skips the model entirely when verbatim is on with no
translation to do — the answer is the input, so a round trip would buy nothing.

### 2026-09-09 — precedence between vocabulary and context (found by your test)

Your Gmail test asked a question the design had never answered: the vocabulary list says "Aisha",
the screen says "ayeesha@allenhouse.ac.in", so which wins?

**Nothing did.** The prompt carried two rules — one in the context block, one in the vocabulary block
— that each said "correct to my spelling", and nothing said which one loses. That is undefined
behaviour: the model picks arbitrarily and can pick differently on the next run. A user-facing
setting that only sometimes applies is worse than one that does not exist, because it cannot be
trusted or debugged.

**Resolved: the vocabulary list wins.** Three reasons:

1. It is an explicit instruction the user typed. Context is inferred from whatever was on screen.
2. On-screen evidence is often weak. `ayeesha@allenhouse.ac.in` is a mailbox name, which is not
   necessarily how the person spells their name.
3. A list that only sometimes wins is a lottery, not a setting. Predictably wrong is fixable;
   unpredictably right is not.

Context still resolves every name that is NOT in the list, which is the common case and the reason
context exists. The precedence block is emitted only when both sources are present, since that is
the only time the conflict can arise.

Also hardened `findWindowSource`: the window title and the capture source name come from different
APIs and routinely disagree on casing, trailing whitespace, and truncation. Exact-equality matching
alone would have made screenshots silently fail to capture. It now falls through exact →
case-insensitive → prefix, and rejects an ambiguous prefix rather than risk screenshotting the wrong
window.

**A note on that test setup:** with the screenshot toggle off, context sees only the window title.
The recipient address lives in the page body, so the model never saw "ayeesha" at all. That test
could not have exercised precedence either way.

### 2026-09-09 — Tier 2 complete except the deferred refactor

Items 18–21 shipped, closing Tier 2 apart from task 11. Suite is now **219 tests, all passing**;
local smoke passing.

**18 — network reachability.** A dropped connection and a slow provider produce the same hung
socket, so we were telling users with their wifi off that "Groq is temporarily unavailable" and
sending them to check a status page. The checker is injected into `errors.ts` rather than imported,
which keeps that module free of Electron and therefore testable. It defaults to *online*: being
wrong that way shows a provider message for a network fault, while the opposite sends someone to fix
a connection that was never broken. Offline connection faults are also no longer retried, and the
offline dock state carries no retry button, because pressing it cannot help.

**19 — clipboard exclusion, built to disprove itself.** The open question was whether Electron's
`writeBuffer` would replace the text instead of joining it, which would silently break every paste
in the app. Rather than guess, the marker is applied and then **verified**: if the text did not
survive, it is rewritten and the feature switches off for the session. The check runs during a paste
when our own text is already on the clipboard, so it can never clobber something the user put there.
A test written to check that assumption immediately caught a second problem — the support flag was
module-level, so one clipboard without buffer support disabled the feature for every other instance.
Now per-instance, because the answer is a property of one clipboard implementation.

**20 — test-case export.** Off by default; retains exactly one dictation at a time, and turning the
setting off deletes what it was holding. The cleanup prompt is **rebuilt** from the stored inputs
rather than captured at request time: `buildCleanupPrompt` is deterministic, so the result is
identical without threading prompt-recording through every provider and keeping it in sync forever.
It writes a folder rather than a zip — Node has no built-in archiver, and the alternatives are a new
dependency or shelling out to PowerShell, neither of which earns its keep when right-click →
compress is one step.

**21 — microphone picker.** Enumeration happens in the recorder window because it is the only one
with media permission; without permission the browser returns devices with blank labels, which is a
list the user cannot choose from. A missing device degrades to the system default rather than losing
the dictation.

That last point changed during implementation. The plan said "graceful fallback with a **visible
message**", and the first attempt sent a sentinel through the recorder's *failure* channel — which
would have aborted the very session it was trying to save. The message now appears in Settings
instead, where the saved device is compared against the live list. That is the screen someone opens
when the wrong microphone is being used, so it is where the explanation belongs, and it needs no new
channel out of the recorder window.

**Still deferred: task 11.** Nothing in Tier 2 strained against `main.ts` badly enough to justify a
500-line refactor with real regression risk. It stays on the list.

### 2026-09-09 — finding E1 withdrawn: dictations stay in clipboard history

You tested the clipboard marker first, as suggested. It did not work, and the log says exactly why:

```
"event":"clipboard.exclusion.unsupported","reason":"text_replaced"
```

**Electron's `clipboard.writeBuffer` replaced the text instead of joining it.** That is precisely the
failure I built the probe to catch, and it fired on the very first real run. Without the
self-verifying check, every paste in the app would have silently started writing an empty clipboard —
a total breakage, shipped, from a change that looked like a small privacy improvement.

That is the whole argument for making a risky change prove itself rather than reasoning that it
should be fine.

**The feature is removed, not disabled.** A toggle that cannot deliver what it promises is worse than
no toggle: it is a support burden and a false statement about what the app does. The
`keepInClipboardHistory` setting, the marker constants, the probe, and their tests are all gone.

**You also made the better product call, which settles it independently.** Your reason for wanting
dictations in clipboard history — "in case pasting fails we have it there" — is right in a way worth
recording. The *current* clipboard already survives a failed paste, so `Copy again` works either way.
But if the paste fails and you then copy something else, clipboard history is the **only** remaining
way to get that dictation back. Excluding it would have removed a real recovery path in order to
close a leak we could not close anyway.

Finding 4.5.1 (E1) is therefore withdrawn as a defect and recorded as a deliberate behaviour. If we
ever want exclusion for real it needs a native Win32 clipboard write, which is not worth it against
that trade.

### 2026-09-09 — why the context test still shows "Aisha"

Your second test dictated into a Gmail compose addressed to `ayeesha@gmail.com` and the output kept
"Aisha". **Two independent things were blocking it, and neither is a bug.**

**1. Your vocabulary contains "Aisha".** The live config reads
`customVocabulary: "Aisha\nArpan\nminhaz"`. The precedence rule added earlier that day says the
vocabulary list is the final authority and beats what is on screen. So "Aisha" is not the feature
failing — it is the feature doing exactly what the settings ask. Precedence is working.

**2. The screenshot toggle has never been saved on.** The config file on disk has no
`contextScreenshotEnabled` key at all, so it is running on the default of `false`. With metadata-only
context, the model sees the window title; the recipient address lives in the page body, so
`ayeesha@gmail.com` was never visible to it in either test.

To actually exercise context: remove "Aisha" from the vocabulary field, turn the screenshot toggle on,
press Save, and dictate again. Both changes are required — fixing one still leaves the other blocking.

### 2026-09-09 — the context summary was empty on every single call

Your "no context" report was right, and the log named the cause immediately:

```
"event":"context.infer.success","durationMs":772,"summaryChars":0
```

Nine calls. Every one reached the model, every one succeeded, every one returned **zero characters**.

**The cause was mine.** The default context model, `qwen/qwen3.6-27b`, is a reasoning model: it
spends tokens thinking before it emits a single visible character, and those tokens count against
the same `max_completion_tokens` ceiling. I hardcoded **300**. The reasoning consumed all of it, the
model never got to the answer, and `stripThinkTags` correctly removed the truncated think-block —
leaving "".

This is the exact failure that [completion-budget.ts](../../src/llm/completion-budget.ts) exists to
prevent. That module is documented at length about this precise trap, and the context service did not
use it. `estimateOutputTokens` computes 1118 tokens for this model and prompt; the context call now
routes through it and through `withReasoningEffort`, like every other model call in the app.

**Two smaller things came out of the same investigation.**

The failure was *invisible*. `context.infer.success` logged a success with a zero-length summary, and
context simply got thinner with nothing looking broken. There is now a `context.infer.empty` warning
carrying the finish reason, the budget, and the raw length, so the two causes — ran out of budget, or
genuinely had nothing to say — can be told apart without a code change.

And the log said `usedScreenshot: "[redacted]"`. The key-based redaction was matching on the
substring `screenshot` and blanking a **boolean**. Redaction exists to keep text out of logs; a
boolean or a number cannot carry content, so blanking it only destroys the diagnostic the field was
added for. `sanitize` now redacts by key only for values that could actually hold content.

**Still true, and still blocking your test:** `customVocabulary` remains `"Aisha
Arpan
minhaz"`,
and the config file still has no `contextScreenshotEnabled` key, so the screenshot path has never
run. Both need changing before context can be judged.

### 2026-09-09 — the context model was thinking itself to death

The budget fix shipped and the very first run on the new build produced the diagnosis the old one
could not:

```
"context.infer.empty","maxOutputTokens":1133,"finishReason":"length","truncated":true,"rawChars":5106
```

**5,106 characters of output, all of it reasoning, ceiling hit, no answer.** Raising the budget from
300 to 1,133 did not fix it and could not: this model will fill whatever ceiling it is given. It also
took 2,474ms, up from ~700ms.

The real cause was the *effort level*, not the budget. `withReasoningEffort` sent
`reasoning_effort: "low"` — correct for cleanup, wrong here. Describing a window in two sentences
needs no reasoning at all, so the context call now sends **`"none"`**. `withReasoningEffort` takes the
level as a parameter; every other caller keeps `"low"`.

Worth keeping in mind as a general lesson: the budget helper prevents *truncation*, but a model that
reasons without limit needs to be told to stop reasoning. A bigger ceiling just buys a longer
monologue.

**Also recorded: metadata-only context cannot solve the Ayeesha case, and never could.** The window
title is "Great connecting during the Indian Delegation visit / Astrea IT Services — Gmail". The
recipient address and the greeting the user typed both live in the page body. `contextScreenshotEnabled`
has been `false` through every test so far, so nothing has ever read them.

**And a real limit of the feature, worth stating plainly:** context is good at choosing between
plausible spellings it can see. It is not reliable for reproducing an unusual string exactly — a model
reading `ayeesha@gmail.com` may still write the conventional `Ayesha`. For a spelling that must be
exact every time, the vocabulary list is the deterministic tool, and precedence guarantees it wins.

### 2026-09-09 — context works end to end, and the design was wrong

With `reasoning_effort: "none"` and the screenshot enabled, the pipeline finally ran clean:

```
context.screenshot.captured  chars: 45807
context.infer.success  463ms  usedScreenshot: true  summaryChars: 195
```

Screenshot captured, summary produced, 463ms — down from 2,474ms. Every part working. **And the
spelling was still wrong.**

So the plumbing was never the problem. **The design was.**

We asked the context model for a two-sentence prose summary. Prose is LOSSY for spellings: shown
`ayeesha@gmail.com`, a model writes "emailing Ayeesha" — normalising as it summarises. The cleanup
model then normalises again. **Two rewrites between the screen and the user's text**, and an unusual
spelling survives neither. No amount of prompt tuning on either end fixes that, because the
information is destroyed in the middle.

**The fix is to stop routing spellings through prose.** The context model now answers in two parts:

```
ACTIVITY: <two sentences, as before>
NAMES: Ayeesha, Astrea IT Services, Grafana
```

`NAMES` is collected under a copy-exactly instruction — "never correct, normalise, or standardise;
'Ayeesha' stays 'Ayeesha', never 'Ayesha'" — and reaches the cleanup prompt as its own block with its
own rule, never as prose. The parser is deliberately tolerant: a model that ignores the format still
yields a usable summary, because unlabelled output is treated as the activity line.

Precedence is unchanged: the user's vocabulary list still beats on-screen names.

**A robustness hole surfaced while wiring it.** Adding `visibleNames` to the snapshot made
`buildContextSection` throw on any snapshot that predated the field — including one restored from a
stored debug case. A crash there would have taken down a dictation over *missing context*, which is
the exact opposite of the "context is best-effort" rule this module is built on. Both readers now
tolerate the field being absent, with a test that says why.

Suite: **225 tests, all passing.**

## 7. Explanation

### What changed

Ten changes across the pipeline, in three groups: two live defects fixed, language and vocabulary
support added, and rate-limit handling rebuilt.

### Why it was needed

Two of these were bugs users could hit today — pasted silence artefacts, and pastes corrupted by
still-held modifier keys. The rest close gaps that made output worse than the same models could
produce: no way to spell anything correctly, English hardcoded into a multilingual product, and a
single model with no plan for when it is unavailable.

### How it works, step by step

**1. Silence artefacts are dropped instead of pasted.** Speech models emit "Thank you for watching"
and similar stock phrases when handed silence. The transcript is normalised to bare lowercase words
and compared against a list of known artefacts. A match alone never suppresses anything — a real
person saying "thank you" must survive — so suppression also requires the model's own
`no_speech_prob` to be at or above 0.5, meaning it agrees there was probably no speech. If the
provider sends no segment metadata we keep the text and log why. Suppression also switches off the
low-confidence retry, since asking again buys the same artefact for another round trip.

**2. Pastes wait for the user's fingers.** The hotkey listener now tracks which keys are physically
down, from raw key events rather than the ambiguous modifier flags. Before any synthetic shortcut
fires, the inserter polls that state every 25ms for up to 600ms. In the normal case the user let go
long ago, the loop never runs, and nothing is slower. If they are still holding at the deadline we
paste anyway — a possibly-mangled paste is recoverable from the clipboard, a dropped dictation is not.

**3. Language flows through instead of being hardcoded.** Two new settings: spoken language (default:
detect automatically) and paste language (default: same as spoken). When the spoken language is empty
the `language` parameter is omitted from the request entirely rather than sent as an empty string —
sending one forces the model to decode as that language. The paste language adds a translation
instruction to the cleanup prompt.

**4. Custom vocabulary reaches the models twice.** Terms are stored newline-separated, parsed in one
shared place, and used both as a recognition bias on the speech model — fixing the word before
cleanup ever sees it — and as a spelling reference during cleanup. The cleanup prompt carries an
explicit rule that a listed term may never be inserted if the speaker did not say it; without that
the model starts sprinkling names into unrelated sentences, which is worse than the misspelling.

**5. Rate limits are handled instead of fought.** A new cooldown store reads the provider's own 429
headers. The daily-quota check runs first, because providers send `retry-after` alongside it and
reading that first would misfile a short daily window as a per-minute one. Per-minute limits live in
memory; daily limits are written to disk so they survive a restart. Before each cleanup request the
provider asks which model is actually free and skips straight to the fallback if the primary is
cooling down. If both are cooling down it fails immediately with the wait time, having sent nothing.

### Files and functions changed

| File | What it now does |
|---|---|
| [groq-transcription-service.ts](../../src/transcription/groq-transcription-service.ts) | `suppressHallucination` drops silence artefacts; language omitted when auto-detecting; vocabulary flows into the prompt |
| [transcription-prompt.ts](../../src/transcription/transcription-prompt.ts) | Adapts to the configured language instead of asserting English; appends user vocabulary, capped at 40 terms |
| [hotkey-listener.ts](../../src/hotkey/hotkey-listener.ts) | Tracks physically-held keys; `areHotkeyModifiersDown()` exposes it; `stop()` clears state so the guard cannot stall |
| [hotkey-parser.ts](../../src/hotkey/hotkey-parser.ts) | `matchesGlobalKey` recognises right-hand Ctrl, Shift, Alt, and Meta |
| [text-inserter.ts](../../src/insertion/text-inserter.ts) | `waitForModifierRelease` guards every synthetic shortcut; `setModifierGuard` installs the check |
| [model-cooldown.ts](../../src/llm/model-cooldown.ts) | New. Two-tier cooldown store and `effectiveModel` routing |
| [rate-limit-headers.ts](../../src/llm/rate-limit-headers.ts) | New. Pure header and duration parsing, no Electron dependency |
| [groq-cleanup-provider.ts](../../src/cleanup/groq-cleanup-provider.ts) | Tries primary then fallback, records rate limits, skips models it knows are blocked |
| [cleanup-provider.ts](../../src/cleanup/cleanup-provider.ts) | Prompt carries vocabulary and output-language sections |
| [errors.ts](../../src/observability/errors.ts) | Rate limits are no longer retryable; `retryAfterSeconds` surfaces the wait in the message |
| [config-store.ts](../../src/config-store.ts) | Four new settings, validated; `parseVocabularyTerms` is the single source of truth |
| [main.ts](../../src/main.ts) | Wires the modifier guard, the cooldown store, and the new tray vocabulary action |
| [settings.html](../../src/renderer/settings.html) / [settings.js](../../src/renderer/settings.js) | Language and vocabulary card, backup model field |

### Important decisions

- **Suppression fails open.** No segment metadata means keep the text. A spurious "Thank you" is
  visible and recoverable; silently eating real words is neither.
- **The threshold is honest.** 0.5 is a starting point, not a tuned figure, and the comment says so.
  Tuning it needs captured samples, which is task 20.
- **Auto-detect is the default language.** Rejected defaulting to English: that is what caused this
  finding in the first place.
- **Rate limits are not retried.** Rejected waiting out `retry-after` inside the request, because the
  fallback model is faster and the cooldown store makes the next request cheaper too.
- **The paste guard lives in the lowest shared function.** Rejected guarding only the paste call.
- **The vocabulary action is in the tray.** Rejected Settings-only: the moment a user notices a wrong
  name is the only moment they will actually add it.

### Tests and verification

`npm test` — **150 tests, 150 passing, 0 failing** (was 115 before this work).

`npm run local:smoke` — passed: "Electron stayed alive for 8 seconds, wrote startup log, and painted
3 non-blank dock frame(s)."

Three pre-existing tests were updated rather than deleted, because they asserted behaviour this task
deliberately changed: two asserted the hardcoded English language, one asserted that a 429 is
retryable.

**Not verified end to end.** Everything above is unit tests plus a boot smoke test. The following
need a real manual run and have not had one: dictating in a non-English language, translation output,
vocabulary actually fixing a misspelled name, the paste guard against a genuinely held key in a real
app, and fallback behaviour against a real provider rate limit.

### Edge cases and limitations

- **Translation is coupled to polish.** Turning off "Polish transcripts with AI" also turns off
  translation, because translation rides in the cleanup prompt. Splitting them is task 17.
- **The artefact list is English-only.** A silence artefact in another language is not caught.
- **The vocabulary prompt cap is 40 terms** even though 100 can be stored; beyond that the list stops
  steering the speech model and starts crowding out the instructions.
- **The fallback model covers cleanup only** — not transcription, not rewrite. Rewrite still uses the
  single cleanup model.
- **A 429 on transcription now fails immediately** instead of retrying, since transcription has no
  fallback model. The message says how long to wait. A deliberate trade: one fast honest failure over
  three doomed requests.
- **Cooldowns are keyed per model id, not per account.** Two different ids sharing an underlying quota
  are tracked separately.

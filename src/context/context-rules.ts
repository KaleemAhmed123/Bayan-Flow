/**
 * The rules around app context capture.
 *
 * Everything here is pure and free of Electron, so the privacy decisions — the
 * ones that decide whether a picture of somebody's bank balance leaves their
 * machine — are unit-testable rather than buried in an async capture path.
 */

/**
 * Windows we never capture context from, matched case-insensitively as
 * substrings of the window title.
 *
 * Erring toward over-blocking is deliberate. A false positive costs one
 * dictation slightly worse spelling. A false negative sends a picture of
 * someone's password vault to a third party. Those are not comparable.
 *
 * Users can edit this list, including removing entries. "bank" in particular
 * will catch innocent titles; that is the trade, and it is theirs to change.
 */
export const DEFAULT_CONTEXT_BLOCKLIST = [
  // Password and secret managers
  "1password",
  "bitwarden",
  "lastpass",
  "keepass",
  "dashlane",
  "nordpass",
  "proton pass",
  "keeper password",
  "authenticator",
  // Private browsing, where the whole point is that nothing is recorded
  "incognito",
  "inprivate",
  "private browsing",
  // Money
  "bank",
  "wallet",
  "paypal",
  "stripe dashboard",
];

/** How many characters of window title we are willing to forward. */
const MAX_TITLE_CHARS = 300;

export function parseBlocklist(raw: string): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    const pattern = line.trim().toLowerCase();
    if (!pattern || seen.has(pattern)) {
      continue;
    }

    seen.add(pattern);
    patterns.push(pattern);
  }

  return patterns;
}

export function serializeBlocklist(patterns: string[]): string {
  return patterns.join("\n");
}

/**
 * True when this window must not be looked at in any way.
 *
 * A blocked window yields NO context at all — not even the title. This is
 * stricter than "skip the screenshot", and deliberately so: "Chase — Account
 * ending 4321" is sensitive on its own, and forwarding it while congratulating
 * ourselves for withholding the picture would be missing the point.
 */
export function isBlockedWindow(windowTitle: string, blocklist: string[]): boolean {
  const title = windowTitle.trim().toLowerCase();
  if (!title) {
    // An untitled window is one we cannot reason about. Do not capture it.
    return true;
  }

  // Lowercased here rather than trusting the caller to have run parseBlocklist.
  // This is the privacy gate: a pattern that silently fails to match because
  // somebody passed it capitalised is exactly the failure we cannot afford.
  return blocklist.some((pattern) => {
    const needle = pattern.trim().toLowerCase();
    return needle !== "" && title.includes(needle);
  });
}

/**
 * Trims a model's answer down to at most two sentences.
 *
 * The prompt asks for two. Models frequently give three, or add a preamble. The
 * summary is injected into another prompt, so an unbounded one is both a cost
 * and a chance for the model to wander off-task.
 */
export function normalizeActivitySummary(raw: string): string {
  const cleaned = stripThinkTags(raw).trim();
  if (!cleaned) {
    return "";
  }

  const sentences = cleaned
    .split(/(?<=[.!?。])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 2) {
    return cleaned;
  }

  return sentences.slice(0, 2).join(" ");
}

/**
 * Removes `<think>...</think>` blocks, including an unclosed one left behind
 * when a reasoning model runs out of output budget mid-thought.
 */
export function stripThinkTags(text: string): string {
  return text
    .replace(/^\s*(?:<think>[\s\S]*?<\/think>\s*)+/i, "")
    .replace(/^\s*<think>[\s\S]*$/i, "")
    .trim();
}

/**
 * Guesses the application from a window title.
 *
 * Windows apps overwhelmingly end their title with the app name after a dash:
 * "auth.ts - BayanFlow - Visual Studio Code", "Inbox (3) - Gmail - Google
 * Chrome". Taking the last dash-separated segment gets it right most of the
 * time, and the length guard rejects the case where the title is one long
 * sentence that happens to contain a dash.
 *
 * A guess is fine here. This is a hint for a language model, not an identifier,
 * and the window title is sent alongside it either way.
 */
export function appNameFromTitle(title: string): string {
  const segments = title
    .split(/\s+[-–—|]\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return "";
  }

  const candidate = segments[segments.length - 1] ?? "";
  return candidate.length <= 40 ? candidate : "";
}

export function truncateTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > MAX_TITLE_CHARS ? `${trimmed.slice(0, MAX_TITLE_CHARS)}…` : trimmed;
}

export type AppContextSnapshot = {
  /** Best-effort application name. Empty when unknown. */
  appName: string;
  /** Focused window title. Empty when blocked or unavailable. */
  windowTitle: string;
  /** Two-sentence description of what the user is doing. Empty when unavailable. */
  activity: string;
  /**
   * Proper nouns read off the screen, copied character for character.
   *
   * Separate from `activity` on purpose: prose normalises spellings, and these
   * exist precisely to survive that.
   */
  visibleNames: string[];
  /** True when a screenshot was captured and sent. Recorded for the debug panel. */
  usedScreenshot: boolean;
  /** True when the blocklist stopped us looking at this window. */
  blocked: boolean;
  /** Why context is thin, for diagnostics. Never contains user content. */
  reason?: string;
};

export const EMPTY_CONTEXT: AppContextSnapshot = {
  appName: "",
  windowTitle: "",
  activity: "",
  visibleNames: [],
  usedScreenshot: false,
  blocked: false,
};

/** True when this snapshot carries anything worth putting in a prompt. */
export function hasUsableContext(context: AppContextSnapshot | null | undefined): boolean {
  return Boolean(
    // `?? []` is not defensive padding: a snapshot can arrive from an older
    // stored debug case or any caller written before this field existed, and a
    // crash here would take a dictation down over missing context.
    context && !context.blocked && (context.windowTitle || context.activity || (context.visibleNames ?? []).length > 0),
  );
}

/**
 * The context block for the cleanup prompt.
 *
 * The "never introduce" rule carries the same weight it does for vocabulary, and
 * for a sharper reason: context is a description of what is on screen, so
 * without the rule the model will happily write ABOUT the screen instead of
 * cleaning up what the person said.
 */
export function buildContextSection(context: AppContextSnapshot | null | undefined): string {
  if (!hasUsableContext(context) || !context) {
    return "";
  }

  const lines: string[] = [];
  if (context.appName) {
    lines.push(`Application: ${context.appName}`);
  }

  if (context.windowTitle) {
    lines.push(`Window: ${context.windowTitle}`);
  }

  if (context.activity) {
    lines.push(`What the user appears to be doing: ${context.activity}`);
  }

  // Given its own block and its own rule, because this is the part that carries
  // an exact spelling and the surrounding prose is the part that destroys one.
  const visibleNames = context.visibleNames ?? [];
  const namesBlock = visibleNames.length
    ? `
Names currently visible on screen, spelled exactly as they appear:
${visibleNames.join(", ")}

- If the speaker said a name that sounds like one of these, use the EXACT spelling above, character for character.
- Do not "correct" it to a more common spelling. If the screen says "Ayeesha", write "Ayeesha", never "Ayesha".
- This applies only to names the speaker actually said.
`
    : "";

  return `
Context for this dictation:
${lines.join("\n")}
${namesBlock}
Context rules:
- Use the context ONLY as a hint for formatting and for the spelling of words the speaker already said.
- If a transcript word is a close phonetic match for a name visible in the context, correct it to the spelling shown there, unless a known-spellings list below gives a different spelling for that name, in which case the list wins.
- NEVER add a name, fact, or detail from the context that the speaker did not say.
- Do not describe, summarize, or answer anything about the context. It is background, not content.
`;
}

/**
 * The context model answers in two parts, and the second part is the important one.
 *
 * A prose summary is LOSSY for spellings. Asked to describe the screen, a model
 * reads "ayeesha@gmail.com" and writes "emailing Ayeesha" — normalising as it
 * summarises. Cleanup then normalises again. Two rewrites between the screen and
 * the user's text, and an unusual spelling survives neither.
 *
 * So NAMES is collected separately and under a copy-exactly instruction. It
 * never passes through prose, which is what lets `Ayeesha` reach the cleanup
 * prompt intact.
 */
export const CONTEXT_SYSTEM_PROMPT = [
  "You report what a computer user is doing right now, for a speech-to-text cleanup pipeline.",
  "Reply in exactly this format, two lines, nothing else:",
  "ACTIVITY: <two sentences: what the user is doing and what they are about to write>",
  "NAMES: <comma-separated list of proper nouns visible on screen, or the word NONE>",
  "",
  "Rules for NAMES:",
  "- Copy each name EXACTLY as it appears, character for character, including unusual spellings.",
  "- Never correct, normalise, or standardise a spelling. 'Ayeesha' stays 'Ayeesha', never 'Ayesha'.",
  "- Include people's names, recipient names taken from email addresses, company names, product names, and project names.",
  "- For an email address, give the name part as written, not the whole address.",
  "- List only what is actually visible. Never guess.",
  "",
  "Rules for ACTIVITY: describe only what you can see, and say you are unsure rather than inventing.",
  "No markdown, no commentary, no extra lines.",
].join("\n");

/** Longest a single visible name may be before we treat it as prose, not a name. */
const MAX_VISIBLE_NAME_CHARS = 60;
/** Cap on names forwarded, so a busy screen cannot flood the cleanup prompt. */
const MAX_VISIBLE_NAMES = 12;

/**
 * Splits the model's two-line answer into the summary and the exact names.
 *
 * Tolerant by design: an older or chattier model that ignores the format still
 * yields a usable summary, because unlabelled output is treated as the activity
 * line. Getting fewer names is a smaller loss than getting nothing.
 */
export function parseContextAnswer(raw: string): { activity: string; visibleNames: string[] } {
  const cleaned = stripThinkTags(raw).trim();
  if (!cleaned) {
    return { activity: "", visibleNames: [] };
  }

  const activityMatch = cleaned.match(/^\s*ACTIVITY\s*:\s*([\s\S]*?)(?=\n\s*NAMES\s*:|$)/i);
  const namesMatch = cleaned.match(/^\s*NAMES\s*:\s*(.*)$/im);

  // No labels at all means the model answered in plain prose. Keep it.
  const activitySource = activityMatch ? activityMatch[1] ?? "" : namesMatch ? "" : cleaned;

  return {
    activity: normalizeActivitySummary(activitySource),
    visibleNames: parseVisibleNames(namesMatch?.[1] ?? ""),
  };
}

function parseVisibleNames(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || /^none$/i.test(trimmed)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of trimmed.split(/[,;]/)) {
    // Strip quotes and stray list punctuation, but never letters: the whole
    // point of this list is that the spelling arrives untouched.
    const name = part.trim().replace(/^["'`*\-\s]+|["'`*\s]+$/g, "");
    if (!name || name.length > MAX_VISIBLE_NAME_CHARS || /^none$/i.test(name)) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(name);
    if (names.length >= MAX_VISIBLE_NAMES) {
      break;
    }
  }

  return names;
}

/** User message for the context model, from the signals we managed to gather. */
export function buildContextInferencePrompt(signals: { appName: string; windowTitle: string }): string {
  return [
    "Describe the current activity in exactly two sentences.",
    `Application: ${signals.appName || "Unknown"}`,
    `Window title: ${signals.windowTitle || "Unknown"}`,
  ].join("\n");
}

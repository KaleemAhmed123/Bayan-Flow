/**
 * Catching the cleanup model when it ANSWERS the transcript instead of cleaning it.
 *
 * Dictate "write a message to John saying I'm running late" and a small
 * instruction-tuned model will sometimes do exactly that — you get a drafted
 * message pasted instead of your own sentence. Same for "translate this to
 * Spanish" or "make a poem about the moon". The prompt forbids it; forbidding is
 * a request, not a guarantee, and the failure gets more likely the shorter and
 * more imperative the dictation is.
 *
 * This is a heuristic and it is honest about that. It runs only where it is
 * safe: no translation requested, and English markers present. When it trips we
 * discard the model's answer and insert the raw transcript, which is always
 * safe — the user's own words, slightly rougher.
 */

/**
 * Imperative verbs that make a dictation look like an instruction. Their
 * presence in the RAW transcript is what arms the check; on their own they mean
 * nothing, since "write" is an ordinary word.
 */
const INSTRUCTION_MARKERS = new Set([
  "ask", "answer", "compose", "create", "draft", "email", "generate", "make",
  "message", "prompt", "reply", "respond", "response", "summarize", "summarise",
  "tell", "translate", "write", "rewrite", "explain", "claude", "chatgpt", "gpt",
  "ai", "llm", "assistant",
]);

/** Openers a cleanup pass can never legitimately invent. */
const ASSISTANT_PREAMBLE = /^\s*(sure|certainly|absolutely|of course|here(?:'s| is)\b|i(?:'d| would) be happy to|i can\b|okay,? here)/i;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could",
  "for", "from", "had", "has", "have", "he", "her", "him", "his", "i", "if",
  "in", "into", "is", "it", "its", "just", "me", "my", "of", "on", "or", "our",
  "please", "she", "so", "that", "the", "their", "them", "then", "there", "this",
  "to", "um", "uh", "was", "we", "were", "what", "when", "where", "who", "with",
  "would", "you", "your",
]);

/**
 * Below this share of surviving content words, the output is a different text
 * rather than a tidied version of the same one.
 *
 * Cleanup removes filler and fixes spelling, so overlap is normally high. 0.35
 * is deliberately generous — a false trip costs the user a slightly rougher
 * transcript, which is a far smaller harm than pasting a chatbot's answer.
 */
const MIN_OVERLAP_RATIO = 0.35;

export function significantTokens(text: string): Set<string> {
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

  return new Set(parts);
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}

/**
 * True when the cleaned text looks like an answer to the transcript rather than
 * a cleaned-up version of it.
 *
 * `outputLanguage` disables the check: a translated result legitimately shares
 * almost no tokens with its source, so every translation would trip it.
 */
export function looksLikeExecutedInstruction(options: {
  rawTranscript: string;
  cleanedTranscript: string;
  outputLanguage?: string;
}): boolean {
  if (options.outputLanguage?.trim()) {
    return false;
  }

  const raw = options.rawTranscript.trim();
  const cleaned = options.cleanedTranscript.trim();
  if (!raw || !cleaned) {
    return false;
  }

  // Signal one: an opener the speaker did not say. A cleanup pass has nowhere
  // to get "Sure, here's" from except by answering.
  if (ASSISTANT_PREAMBLE.test(cleaned) && !ASSISTANT_PREAMBLE.test(raw)) {
    return true;
  }

  const rawTokens = significantTokens(raw);
  const cleanedTokens = significantTokens(cleaned);
  if (rawTokens.size === 0 || cleanedTokens.size === 0) {
    return false;
  }

  // Signal two: the transcript was imperative, and almost nothing of it survived.
  // Both halves are required. Low overlap alone happens on heavy filler removal;
  // an imperative alone is just an ordinary sentence about writing something.
  const rawMarkers = [...rawTokens].filter((token) => INSTRUCTION_MARKERS.has(token));
  if (rawMarkers.length === 0) {
    return false;
  }

  const markersSurvived = rawMarkers.some((marker) => cleanedTokens.has(marker));
  const overlapRatio = intersectionSize(rawTokens, cleanedTokens) / rawTokens.size;

  return !markersSurvived && overlapRatio < MIN_OVERLAP_RATIO;
}

const BASE_TERMS = ["BayanFlow", "Groq", "OpenRouter", "Whisper", "Llama", "Qwen", "Ctrl+Shift+Space"];

/**
 * Cap on user terms reaching the speech model.
 *
 * The prompt is a recognition bias, not a dictionary: past a few dozen terms it
 * stops steering the model and starts crowding out the instructions above it.
 * The config layer already caps the stored list; this is the narrower runtime cap.
 */
const MAX_PROMPT_TERMS = 40;

export type TranscriptionPromptOptions = {
  retry?: boolean;
  /** User vocabulary — names, jargon, product terms the model keeps getting wrong. */
  vocabulary?: string[];
  /** Empty means auto-detect, so the prompt must not claim a language. */
  language?: string;
};

export function buildTranscriptionPrompt(options: TranscriptionPromptOptions = {}): string {
  const language = options.language?.trim();
  const lines = [
    // Naming the language when we know it helps; asserting English when the user
    // is dictating Urdu actively hurts, so this line adapts instead of hardcoding.
    language ? `This is voice dictation in language code "${language}".` : "This is voice dictation.",
    "Use normal punctuation and sentence casing.",
    "Spell product and technical terms exactly when recognized.",
  ];

  const terms = [...BASE_TERMS, ...(options.vocabulary ?? [])].slice(0, MAX_PROMPT_TERMS);
  lines.push(`Preferred spellings: ${terms.join(", ")}.`);

  if (options.retry) {
    lines.push(
      "If audio is unclear, prefer minimal correction and preserve uncertain words rather than inventing replacements.",
    );
  }

  return lines.join(" ");
}

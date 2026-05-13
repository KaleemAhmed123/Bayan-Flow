const BASE_TERMS = ["BayanFlow", "Groq", "OpenRouter", "Whisper", "Llama", "Qwen", "Ctrl+Shift+Space"];

export type TranscriptionPromptOptions = {
  retry?: boolean;
};

export function buildTranscriptionPrompt(options: TranscriptionPromptOptions = {}): string {
  const lines = [
    "This is English voice dictation.",
    "Use normal punctuation and sentence casing.",
    "Spell product and technical terms exactly when recognized.",
    `Preferred spellings: ${BASE_TERMS.join(", ")}.`,
  ];

  if (options.retry) {
    lines.push("If audio is unclear, prefer minimal correction and preserve uncertain words rather than inventing replacements.");
  }

  return lines.join(" ");
}

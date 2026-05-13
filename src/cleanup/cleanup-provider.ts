import type { CleanupMode } from "../types.js";
import type { OperationContext } from "../types.js";

export type CleanupOptions = {
  mode: CleanupMode;
};

export interface CleanupProvider {
  clean(input: string, options: CleanupOptions, context?: OperationContext): Promise<string>;
}

export function buildCleanupPrompt(
  input: string,
  options: CleanupOptions,
): string {
  return `
Mode: ${options.mode}

You are a real-time dictation cleanup engine.

Your task is to clean speech-to-text transcripts for direct insertion into a user's text field.

Rules:
- Preserve the user's intended meaning.
- Correct likely speech recognition mistakes using surrounding context.
- Handle Indian English, technical vocabulary, and phonetic spellings naturally.
- Remove filler words, repeated words, and false starts only when clearly unintentional.
- Fix grammar, punctuation, spacing, and capitalization.
- Preserve intentional tone, commands, code terms, URLs, filenames, variables, and technical keywords.
- Do not rewrite heavily unless the meaning is unclear.
- Do not invent information.
- Do not answer questions.
- Do not summarize.
- Do not explain anything.
- Do not add quotation marks or markdown.
- Return plain cleaned text only.

If the transcript is incomplete, unclear, or low confidence:
- Prefer minimal correction over hallucination.
- Preserve uncertain words rather than inventing replacements.

If the transcript contains mostly silence, noise, or unintelligible speech:
- Return an empty string.

Transcript:
${input}
`.trim();
}

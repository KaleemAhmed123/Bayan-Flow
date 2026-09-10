import { buildContextSection, hasUsableContext, type AppContextSnapshot } from "../context/context-rules.js";
import type { CleanupMode } from "../types.js";
import type { OperationContext } from "../types.js";

export type CleanupOptions = {
  mode: CleanupMode;
  /** Names and jargon to spell correctly. A reference only — never content to insert. */
  vocabulary?: string[];
  /** Translate the cleaned text into this language. Empty or absent means keep the spoken language. */
  outputLanguage?: string;
  /** What the user was looking at while speaking. A spelling hint, never content. */
  appContext?: AppContextSnapshot | null;
};

export interface CleanupProvider {
  clean(input: string, options: CleanupOptions, context?: OperationContext): Promise<string>;
}

/**
 * The vocabulary block.
 *
 * The "never introduce" rule is not decoration. Given a bare list of names, a
 * model will start sprinkling them into sentences where the speaker never said
 * them — which is worse than the misspelling we were trying to fix, because a
 * wrong name that reads fluently gets sent without being noticed.
 */
function vocabularySection(vocabulary: string[] | undefined): string {
  if (!vocabulary?.length) {
    return "";
  }

  return `
Known spellings (names, jargon, product terms):
${vocabulary.join(", ")}

Vocabulary rules:
- Use this list ONLY to correct the spelling of a word the speaker already said.
- A transcript word that is a close phonetic or near-miss match for a listed term should be corrected to the listed spelling.
- NEVER insert a term from this list that the speaker did not say.
- Do not treat this list as subject matter, context, or content to write about.
`;
}

/**
 * Which spelling wins when the vocabulary list and the screen disagree.
 *
 * This block only exists when BOTH are present, which is the only time the
 * question arises. Without it the prompt carries two rules that each say "use my
 * spelling" and nothing that says which one loses, so the model picks
 * arbitrarily and can pick differently on the next run.
 *
 * Vocabulary wins, for three reasons:
 *
 *  1. It is an explicit instruction the user typed. Context is inferred from
 *     whatever happened to be on screen.
 *  2. On-screen evidence is often weak. An address like "ayeesha@example.com"
 *     is a mailbox name, not necessarily how the person spells their name.
 *  3. A list that only sometimes wins is not a setting, it is a lottery. If a
 *     user types "Aisha" and gets "Ayeesha", the feature is broken to them —
 *     and being predictably wrong is fixable, while being unpredictably right
 *     is not.
 *
 * Context still handles every name that is NOT in the list, which is the common
 * case and the reason context exists.
 */
function spellingPrecedenceSection(hasVocabulary: boolean, hasContext: boolean): string {
  if (!hasVocabulary || !hasContext) {
    return "";
  }

  return `
Spelling precedence:
- The known-spellings list is the final authority. If a name appears BOTH in that list AND on screen with a different spelling, use the spelling from the list.
- Use the screen's spelling only for names that are not in the list.
`;
}

/** Translation is a separate instruction so it cannot be confused with cleanup. */
function outputLanguageSection(outputLanguage: string | undefined): string {
  const language = outputLanguage?.trim();
  if (!language) {
    return "";
  }

  return `
Output language:
- After cleaning, translate the result into language code "${language}".
- Translate meaning and tone faithfully; do not summarize, expand, or explain.
- Preserve URLs, code, commands, filenames, IDs, and product names untranslated.
`;
}

/**
 * Verbatim mode: the user asked to keep their exact words, so the only job left
 * is translation. Reached only when an output language is set — with no
 * translation to do, the pipeline skips the model entirely rather than paying a
 * round trip to be handed its own input back.
 */
function buildVerbatimPrompt(input: string, options: CleanupOptions): string {
  return `
Mode: verbatim

You are a literal translator for dictated speech.

Rules:
- Translate the text below into language code "${options.outputLanguage?.trim()}".
- Preserve the speaker's exact meaning, tone, register, and level of detail.
- Do NOT clean up, tidy, shorten, expand, or reorganise anything.
- Keep filler words, false starts, and repetition if they are present.
- Preserve URLs, code, commands, filenames, IDs, and product names untranslated.
- Do not answer, explain, or comment. Return only the translated text.
${vocabularySection(options.vocabulary)}
Text:
${input}
`.trim();
}

export function buildCleanupPrompt(
  input: string,
  options: CleanupOptions,
): string {
  if (options.mode === "verbatim") {
    return buildVerbatimPrompt(input, options);
  }

  return `
Mode: ${options.mode}

You are a real-time dictation cleanup engine.

Your task is to clean speech-to-text transcripts for direct insertion into a user's text field.

Rules:
- Preserve the user's intended meaning.
- Fix punctuation, capitalization, spacing, and obvious speech recognition artifacts.
- Correct likely speech recognition mistakes only when the intended word is clear from surrounding context.
- Handle Indian English, technical vocabulary, and phonetic spellings conservatively.
- Remove filler words, repeated words, and false starts only when they are clearly unintentional.
- Preserve commands, code terms, URLs, filenames, variables, product names, and technical keywords exactly when they appear intentional.
- Keep fragmentary input fragmentary; do not expand partial thoughts into complete prose.
- Prefer minimal correction over stylistic rewriting.
- Do not invent information.
- Do not answer questions.
- Do not summarize.
- Do not explain anything.
- Do not paraphrase unless required to repair obvious ASR corruption.
- Do not add quotation marks or markdown.
- Return plain cleaned text only.

Self-corrections:
- When the speaker corrects themselves, keep ONLY the corrected version and delete both the correction marker and the abandoned wording.
- "Let's meet Thursday, no actually Wednesday, after lunch" becomes "Let's meet Wednesday after lunch."
- This applies in every language, including markers like "no wait", "sorry", "de fapt", "perdón", "non".

Spoken punctuation:
- Convert dictated punctuation words into punctuation marks.
- "hi dana comma" becomes "Hi Dana,". "that works period" becomes "That works."
- Only when clearly dictated as punctuation, not when the word is part of the sentence.

Spoken developer syntax:
- Convert spoken technical forms when the intent is clear: "underscore" to "_", "dash dash fix" to "--fix".
- Convert ONLY the span that was actually spoken that way. In "rename user id to user underscore id", the first "user id" stays as prose and only the second becomes "user_id".
- Keep acronyms such as API, CLI, JSON, OAuth capitalized.

Lists:
- An explicit request such as "numbered list" or "bullet list" produces a real list.
- "First... second... third..." spoken as ordinary prose stays prose.
- The word "bullet" inside a sentence is not a request for a list.

Email formatting:
- Only when the context clearly shows an email destination.
- Put a spoken greeting on its own line, then a blank line, then the body.
- Put a spoken closing such as "thanks" or "best regards" in its own final paragraph.
- NEVER invent a greeting or a closing that was not spoken.

If the transcript is incomplete, unclear, or low confidence:
- Prefer minimal correction over hallucination.
- Preserve uncertain words rather than inventing replacements.

If the transcript contains mostly silence, noise, or unintelligible speech:
- Return an empty string.
${buildContextSection(options.appContext)}${vocabularySection(options.vocabulary)}${spellingPrecedenceSection(
    Boolean(options.vocabulary?.length),
    hasUsableContext(options.appContext),
  )}${outputLanguageSection(options.outputLanguage)}
Transcript:
${input}
`.trim();
}

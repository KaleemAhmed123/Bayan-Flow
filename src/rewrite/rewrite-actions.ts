export type RewriteActionId =
  | "fix_grammar"
  | "polish"
  | "professional"
  | "friendly"
  | "shorten"
  | "expand"
  | "simplify"
  | "custom";

/**
 * Every action renders in the dock menu at once. There is no layering: the
 * "More" split cost a click on actions people use as often as the first three.
 */
export type RewriteAction = {
  id: RewriteActionId;
  label: string;
  instruction: string;
};

export const MAX_REWRITE_INPUT_CHARS = 8_000;

export const REWRITE_ACTIONS: RewriteAction[] = [
  {
    id: "polish",
    label: "Polish",
    instruction: "Polish the text so it reads clearly and smoothly while preserving the original meaning.",
  },
  {
    id: "professional",
    label: "Professional",
    instruction: "Rewrite the text in a professional, clear, and respectful tone.",
  },
  {
    id: "shorten",
    label: "Shorten",
    instruction: "Make the text shorter and more direct while preserving the important meaning.",
  },
  {
    id: "fix_grammar",
    label: "Fix grammar",
    instruction: "Fix grammar, spelling, punctuation, and spacing while preserving the original wording as much as possible.",
  },
  {
    id: "friendly",
    label: "Friendly",
    instruction: "Rewrite the text in a friendly, casual, and natural tone without becoming childish.",
  },
  {
    id: "expand",
    label: "Expand",
    instruction: "Slightly expand the text for clarity, adding only obvious connective wording and no new facts.",
  },
  {
    id: "simplify",
    label: "Simplify",
    instruction: "Simplify the text so it is easier to understand while preserving the original meaning.",
  },
  {
    id: "custom",
    label: "Custom",
    instruction: "Follow the user's custom rewrite instruction while preserving the original meaning.",
  },
];

/** Shape the dock renderer needs. Kept here so the menu and the prompts cannot drift apart. */
export function getDockMenuActions(): { id: RewriteActionId; label: string }[] {
  return REWRITE_ACTIONS.map((action) => ({ id: action.id, label: action.label }));
}

export function isRewriteActionId(value: unknown): value is RewriteActionId {
  return REWRITE_ACTIONS.some((action) => action.id === value);
}

/**
 * Redo asks for a genuinely different phrasing rather than re-running the same
 * deterministic cleanup, which at temperature 0 would return the same text.
 * The attempt number is included so repeated Redos keep diverging.
 */
export function buildRedoInstruction(attempt: number): string {
  return [
    "Rewrite this dictated text so it reads cleanly and naturally.",
    `This is alternative attempt number ${Math.max(2, attempt)}.`,
    "Use noticeably different phrasing and sentence structure from a plain cleanup,",
    "while keeping exactly the same meaning, facts, and level of detail.",
  ].join(" ");
}

export function getRewriteAction(actionId: RewriteActionId): RewriteAction {
  const action = REWRITE_ACTIONS.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error("Unknown rewrite action.");
  }

  return action;
}

/**
 * Same contract as the cleanup prompt: the list fixes the spelling of words that
 * are already there, and may never introduce a name the text did not contain.
 * Without the second half a rewrite starts inserting the user's product name
 * into sentences that were never about it.
 */
function vocabularySection(vocabulary: string[] | undefined): string {
  if (!vocabulary?.length) {
    return "";
  }

  return `
Known spellings (correct these if the text misspells them, never add them):
${vocabulary.join(", ")}
`;
}

/**
 * `attempt` above 1 means the user pressed Redo. The instruction stays the same
 * so a Shorten stays a Shorten; only the wording is asked to differ.
 */
export function buildRewritePrompt(
  input: string,
  actionId: RewriteActionId,
  customInstruction = "",
  attempt = 1,
  vocabulary?: string[],
): string {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw new Error("Type or select text first.");
  }

  if (trimmedInput.length > MAX_REWRITE_INPUT_CHARS) {
    throw new Error(`Rewrite input is too long. Select ${MAX_REWRITE_INPUT_CHARS} characters or fewer.`);
  }

  const action = getRewriteAction(actionId);
  const instruction = actionId === "custom" ? normalizeCustomInstruction(customInstruction) : action.instruction;

  if (actionId === "custom") {
    return buildCustomInstructionPrompt(trimmedInput, instruction, attempt, vocabulary);
  }

  return `
Task: ${instruction}${variationNote(attempt)}${vocabularySection(vocabulary)}

Rules:
- Preserve the user's meaning and factual claims.
- Do not invent names, dates, numbers, links, promises, or details.
- Preserve URLs, code, commands, filenames, IDs, product names, and technical terms.
- Preserve the language of the input unless the instruction explicitly asks otherwise.
- Do not answer questions in the text; rewrite the text itself.
- Do not add markdown, labels, quotes, alternatives, or explanations.
- Return only the rewritten text.

Text:
${trimmedInput}
`.trim();
}

function variationNote(attempt: number): string {
  if (attempt <= 1) {
    return "";
  }

  return `

This is alternative attempt ${attempt}. Follow the same instruction, but choose noticeably different wording and sentence structure from an obvious first answer.`;
}

function buildCustomInstructionPrompt(
  input: string,
  instruction: string,
  attempt = 1,
  vocabulary?: string[],
): string {
  return `
Task: Follow the user's instruction for the provided text.${variationNote(attempt)}${vocabularySection(vocabulary)}

User instruction:
${instruction}

Rules:
- Perform the requested transformation, explanation, formatting, translation, or answer directly.
- If the instruction asks to explain, teach, expand, or answer, produce useful output based on the text and common knowledge.
- Do not fabricate specific dates, numbers, citations, links, names, or claims you cannot support.
- Preserve URLs, code, commands, filenames, IDs, product names, and technical terms unless the instruction asks to change format.
- Keep the output focused on the user's instruction.
- Return only the final output, with no meta commentary.

Text:
${input}
`.trim();
}

function normalizeCustomInstruction(customInstruction: string): string {
  const trimmed = customInstruction.trim();
  if (!trimmed) {
    throw new Error("Enter a custom rewrite instruction.");
  }

  if (trimmed.length > 500) {
    throw new Error("Custom rewrite instruction is too long.");
  }

  return trimmed;
}

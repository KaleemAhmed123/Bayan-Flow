export type RewriteActionId =
  | "fix_grammar"
  | "polish"
  | "professional"
  | "friendly"
  | "shorten"
  | "expand"
  | "simplify"
  | "custom";

export type RewriteAction = {
  id: RewriteActionId;
  label: string;
  instruction: string;
};

export const MAX_REWRITE_INPUT_CHARS = 8_000;

export const REWRITE_ACTIONS: RewriteAction[] = [
  {
    id: "fix_grammar",
    label: "Fix grammar",
    instruction: "Fix grammar, spelling, punctuation, and spacing while preserving the original wording as much as possible.",
  },
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
    id: "friendly",
    label: "Friendly/Casual",
    instruction: "Rewrite the text in a friendly, casual, and natural tone without becoming childish.",
  },
  {
    id: "shorten",
    label: "Shorten",
    instruction: "Make the text shorter and more direct while preserving the important meaning.",
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

export function getRewriteAction(actionId: RewriteActionId): RewriteAction {
  const action = REWRITE_ACTIONS.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error("Unknown rewrite action.");
  }

  return action;
}

export function buildRewritePrompt(input: string, actionId: RewriteActionId, customInstruction = ""): string {
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
    return buildCustomInstructionPrompt(trimmedInput, instruction);
  }

  return `
Task: ${instruction}

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

function buildCustomInstructionPrompt(input: string, instruction: string): string {
  return `
Task: Follow the user's instruction for the provided text.

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

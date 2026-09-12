import { estimateOutputTokens } from "../llm/completion-budget.js";
import { GroqChatProvider } from "../llm/groq-chat-provider.js";
import { buildRewritePrompt, type RewriteActionId } from "./rewrite-actions.js";
import type { EndpointSettings } from "../llm/client-options.js";
import type { ModelCooldownManager } from "../llm/model-cooldown.js";
import type { OperationContext } from "../types.js";

const REWRITE_SYSTEM_PROMPT =
  "You are a careful writing assistant. Follow the user's requested text operation, avoid unsupported factual invention, and return only the final output.";

export type RewriteOptions = {
  actionId: RewriteActionId;
  customInstruction?: string;
  /** Above 1 when the user pressed Redo, so the model is asked to vary its wording. */
  attempt?: number;
  /**
   * User vocabulary. Rewrite needs this as much as dictation does: the names in
   * the text being rewritten are the same names the speech model gets wrong, and
   * a rewrite that "corrects" them back to the wrong spelling undoes the fix.
   */
  vocabulary?: string[];
};

export class GroqRewriteProvider extends GroqChatProvider {
  constructor(
    apiKey: string,
    model: string,
    fallbackModel = "",
    cooldown?: ModelCooldownManager,
    endpoint: EndpointSettings = {},
  ) {
    super(apiKey, model, fallbackModel, cooldown, endpoint, "rewrite");
  }

  async rewrite(input: string, options: RewriteOptions, context: OperationContext = {}): Promise<string> {
    const trimmed = input.trim();
    const attempt = options.attempt ?? 1;

    return this.complete(
      {
        input: trimmed,
        systemPrompt: REWRITE_SYSTEM_PROMPT,
        userPrompt: buildRewritePrompt(trimmed, options.actionId, options.customInstruction, attempt, options.vocabulary),
        // A custom instruction can legitimately produce far more than it was given.
        maxOutputTokens: (model) =>
          estimateOutputTokens(trimmed.length, model, options.actionId === "custom" ? 1_024 : 256),
        // Unlike cleanup, a rewrite that returns nothing has failed.
        onEmptyReply: "throw",
        logFields: { actionId: options.actionId, attempt },
      },
      context,
    );
  }
}

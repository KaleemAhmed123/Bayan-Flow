import { estimateOutputTokens } from "../llm/completion-budget.js";
import { GroqChatProvider } from "../llm/groq-chat-provider.js";
import { buildCleanupPrompt, type CleanupOptions, type CleanupProvider } from "./cleanup-provider.js";
import type { EndpointSettings } from "../llm/client-options.js";
import type { ModelCooldownManager } from "../llm/model-cooldown.js";
import type { OperationContext } from "../types.js";

const CLEANUP_SYSTEM_PROMPT =
  "You are a constrained transcript cleanup engine. Fix punctuation, spacing, capitalization, and obvious ASR artifacts while preserving meaning. Do not summarize, explain, answer, expand, or invent. Preserve commands, code-like tokens, filenames, URLs, and product names. Return only cleaned text.";

export class GroqCleanupProvider extends GroqChatProvider implements CleanupProvider {
  constructor(
    apiKey: string,
    model: string,
    fallbackModel = "",
    cooldown?: ModelCooldownManager,
    endpoint: EndpointSettings = {},
  ) {
    super(apiKey, model, fallbackModel, cooldown, endpoint, "cleanup");
  }

  async clean(input: string, options: CleanupOptions, context: OperationContext = {}): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      return "";
    }

    return this.complete(
      {
        input: trimmed,
        systemPrompt: CLEANUP_SYSTEM_PROMPT,
        userPrompt: buildCleanupPrompt(trimmed, options),
        // Cleanup never grows the text much; the headroom is for the thinking.
        maxOutputTokens: (model) => estimateOutputTokens(trimmed.length, model, 128),
        // An empty reply is legitimate: the prompt asks for one when the audio is
        // silence. Keep the transcript rather than losing the user's words.
        onEmptyReply: "return-input",
        logFields: {
          vocabularyTerms: options.vocabulary?.length ?? 0,
          outputLanguage: options.outputLanguage || undefined,
        },
      },
      context,
    );
  }
}

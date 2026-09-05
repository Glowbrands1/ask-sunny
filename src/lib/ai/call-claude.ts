import "server-only";

import { CLAUDE_EFFORT, CLAUDE_MODEL } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { getAnthropicClient } from "./anthropic";
import { AiError } from "./errors";

/**
 * ============================================================================
 * THE ONE PLACE THIS APPLICATION TALKS TO CLAUDE
 * ============================================================================
 *
 * Extracted from `server-ask.ts` unchanged so a second caller — the Sales
 * Totals report analyser — can reuse it instead of standing up a parallel
 * Anthropic configuration. That duplication is the thing being prevented here:
 * two call sites would mean two model ids, two effort settings, and two chances
 * to get the error handling wrong.
 *
 * `import "server-only"` is what keeps ANTHROPIC_API_KEY out of the browser: a
 * client component importing this file fails the build rather than shipping a
 * key. The key is never read here at all — `getAnthropicClient()` owns it.
 *
 * THE ERROR CONTRACT MATTERS AS MUCH AS THE HAPPY PATH. The SDK's error can
 * echo the request back, and the request carries whatever the caller put in the
 * grounding block — retrieved policy text, or report figures. So no SDK error
 * is ever rethrown or interpolated into a message. What escapes this function
 * is an `AiError` with wording written here, and nothing else.
 */

/** A prior conversation turn. Structural, so callers need not build ChatMessages. */
export interface ClaudeTurn {
  readonly role: string;
  readonly content: string;
}

export interface CallClaudeInput {
  readonly system: string;
  /**
   * Context prepended to the current turn. Rebuilt per question by the caller,
   * so it is appended to this turn rather than carried in history.
   */
  readonly grounding: string;
  readonly history: readonly ClaudeTurn[];
  readonly question: string;
  readonly maxTokens: number;
}

export async function callClaude(input: CallClaudeInput): Promise<string> {
  const client = getAnthropicClient();

  // Prior turns, trimmed. The grounding block is rebuilt per question, so it is
  // appended to the current turn rather than carried in history.
  const history = input.history
    .filter((message) => message.content.trim().length > 0)
    .slice(-10)
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));

  // The API requires the first message to be a user turn.
  while (history.length > 0 && history[0]!.role === "assistant") history.shift();

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: input.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: CLAUDE_EFFORT },
      system: input.system,
      messages: [
        ...history,
        {
          role: "user",
          content: `${input.grounding}\n\nQUESTION\n\n${input.question}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new AiError(
        "refused",
        "Sunny could not answer that question. Try rephrasing it, or ask a manager directly.",
        422,
      );
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new AiError("model_failed", "Sunny returned an empty answer.", 502);
    }

    return text;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof MissingConfigurationError) {
      throw new AiError("not_configured", error.message, 503, error.missing);
    }
    // The SDK error can echo the request, which carries confidential grounding
    // text. Only the class name is kept — never the body.
    throw new AiError(
      "model_failed",
      "Sunny could not reach the language model. No answer was generated.",
      502,
    );
  }
}

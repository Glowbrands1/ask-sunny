import "server-only";

import { CLAUDE_EFFORT, CLAUDE_MODEL } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { getAnthropicClient } from "./anthropic";
import { AiError } from "./errors";
import { selectLongContext } from "./long-context";
import { noteModelCall } from "./model-failure";
import { modelRequestOptions, modelUnavailable } from "./model-retry";
import { cachedSystem, cachedUserContent } from "./prompt-cache";

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
  /**
   * A SECOND context block, for report figures, or null when this turn has
   * none.
   *
   * Separate from `grounding` rather than concatenated into it by the caller,
   * because the two blocks are cited differently and the system prompt states
   * different rules for each: a knowledge chunk is cited by a server-assigned
   * marker, a report figure by its reporting period. Concatenating them here
   * would leave one caller deciding the order of blocks whose rules another
   * file wrote.
   */
  readonly reportData?: string | null;
  /**
   * A THIRD context block, for CURRENT EMPLOYEE-LEVEL figures, or null.
   *
   * Separate again, and for the same reason the report block is separate: these
   * are measurements about NAMED PEOPLE. They take no source marker, they are
   * not policy, and they are not the salon-level briefing either — a salon's
   * conversion rate is not an employee's. Four sources, four citation rules,
   * and merging any two is how a coaching guideline starts being quoted back as
   * somebody's measured result.
   */
  readonly employeeData?: string | null;
  /**
   * A FOURTH context block: the FORMS LIBRARY, or null.
   *
   * Separate for the same reason as the others, and the reason is sharpest
   * here. These are not documents to cite and not figures to read — they are
   * the templates that exist, which is a question of RECORD rather than of
   * evidence. A form named outside this block does not exist, and the system
   * prompt says so; folding the list into the knowledge block would make a
   * template name look like something retrieved and therefore citable.
   */
  readonly formsLibrary?: string | null;
  /**
   * A FIFTH context block: what this manager told Sunny before about the
   * people this conversation names, or null.
   *
   * Separate because it is a different kind of statement again — the
   * manager's own earlier account, not a document, a figure or a record — and
   * the system prompt says how it may be used. See `chat/person-memory.ts`.
   */
  readonly personMemory?: string | null;
  /**
   * A SIXTH context block: FORMS ON FILE, read from Form Monitoring under the
   * caller's own forms visibility, or null. Records that exist about named
   * people — not templates, not evidence — so it travels apart from the forms
   * library it would otherwise be confused with.
   */
  readonly formRecords?: string | null;
  readonly history: readonly ClaudeTurn[];
  /**
   * "budget" keeps the newest messages that fit in a token budget, up to 40.
   * Omitted, the last 10 non-empty messages are sent.
   */
  readonly historyPolicy?: "budget";
  /** Summary of turns outside that budget. Used only when historyPolicy is "budget". */
  readonly priorSummary?: string | null;
  readonly question: string;
  readonly maxTokens: number;
  /**
   * The pinned policy-manual block, cached on its own when prompt caching
   * is on. Omitted, it stays inside `grounding` and the request is unchanged.
   */
  readonly manualBlock?: string | null;
}

export async function callClaude(input: CallClaudeInput): Promise<string> {
  const client = getAnthropicClient();

  // Prior turns, trimmed. The grounding block is rebuilt per question, so it is
  // appended to the current turn rather than carried in history. The last 10
  // is the cost and latency cap. A budget window is used only when the caller
  // asks for it.
  const nonempty = input.history.filter((message) => message.content.trim().length > 0);
  const bounded = input.historyPolicy === "budget" ? selectLongContext(nonempty).kept : nonempty.slice(-10);
  const history = bounded.map((message) => ({
    role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: message.content,
  }));
  if (input.historyPolicy === "budget" && input.priorSummary?.trim()) {
    const note = `Earlier in this conversation:\n${input.priorSummary.trim()}`;
    if (history.length === 0 || history[0]!.role === "assistant") {
      history.unshift({ role: "user", content: note });
    } else {
      history[0] = { role: "user", content: `${note}\n\n${history[0]!.content}` };
    }
  }

  // The API requires the first message to be a user turn.
  while (history.length > 0 && history[0]!.role === "assistant") history.shift();

  const started = Date.now();
  const userText = [
    input.grounding,
    ...(input.reportData ? [input.reportData] : []),
    ...(input.employeeData ? [input.employeeData] : []),
    ...(input.personMemory ? [input.personMemory] : []),
    ...(input.formsLibrary ? [input.formsLibrary] : []),
    ...(input.formRecords ? [input.formRecords] : []),
    `QUESTION\n\n${input.question}`,
  ].join("\n\n");
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: input.maxTokens,
    thinking: { type: "adaptive" as const },
    output_config: { effort: CLAUDE_EFFORT },
    // Static rules take cache_control { type: "ephemeral" }. The tail after
    // ---DYNAMIC--- (name, salon, today) is not cached.
    system: cachedSystem(input.system),
    messages: [
      ...history,
      {
        role: "user" as const,
        // Every context block and then the question, in that order: the
        // question last is what keeps a long briefing from burying it.
        // The manual block is its own cached part only when that flag is on.
        content: cachedUserContent(userText, input.manualBlock),
      },
    ],
  };
  try {
    const options = modelRequestOptions();
    const response = options
      ? await client.messages.create(params, options)
      : await client.messages.create(params);

    const noted = {
      model: CLAUDE_MODEL,
      maxTokens: input.maxTokens,
      stopReason: response.stop_reason ?? null,
      latencyMs: Date.now() - started,
      usage: response.usage,
    };
    if (response.stop_reason === "refusal") {
      noteModelCall({ ...noted, subtype: "refused" });
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
      noteModelCall({ ...noted, subtype: "empty_answer" });
      throw new AiError("model_failed", "Sunny returned an empty answer.", 502);
    }

    noteModelCall(noted);
    return text;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof MissingConfigurationError) {
      throw new AiError("not_configured", error.message, 503, error.missing);
    }
    // The SDK error can echo the request, which carries confidential grounding
    // text. Only the class name is kept — never the body. The class, status,
    // and subtype are recorded for the trace before this object is discarded.
    noteModelCall({
      model: CLAUDE_MODEL,
      maxTokens: input.maxTokens,
      stopReason: null,
      latencyMs: Date.now() - started,
      usage: null,
      error,
    });
    throw modelUnavailable(error);
  }
}

/**
 * One forced tool call. Used by the flagged form reader and the flagged
 * query rewrite. The answering path stays on `callClaude`. A failure here
 * uses the same wording and never echoes the request.
 */
export async function callClaudeTool(input: {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly { role: "user" | "assistant"; content: string }[];
  readonly tool: {
    readonly name: string;
    readonly description: string;
    readonly input_schema: {
      readonly type: "object";
      readonly properties?: unknown;
      readonly required?: readonly string[];
      readonly additionalProperties?: boolean;
    };
  };
  readonly maxTokens: number;
}): Promise<unknown> {
  const client = getAnthropicClient();
  const messages = input.messages.filter((message) => message.content.trim() !== "");
  try {
    const toolParams = {
      model: input.model,
      max_tokens: input.maxTokens,
      system: cachedSystem(input.system),
      tools: [
        {
          name: input.tool.name,
          description: input.tool.description,
          input_schema: {
            type: "object" as const,
            properties: input.tool.input_schema.properties ?? {},
            required: input.tool.input_schema.required ? [...input.tool.input_schema.required] : undefined,
            additionalProperties: input.tool.input_schema.additionalProperties,
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: input.tool.name },
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
    const options = modelRequestOptions();
    const response = options
      ? await client.messages.create(toolParams, options)
      : await client.messages.create(toolParams);

    const block = response.content.find((item) => item.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new AiError(
        "model_failed",
        "Sunny could not reach the language model. No answer was generated.",
        502,
      );
    }
    return block.input;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof MissingConfigurationError) throw error;
    throw modelUnavailable(error);
  }
}

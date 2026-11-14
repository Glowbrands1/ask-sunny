import "server-only";

import { CLAUDE_EFFORT, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { mainAnswerTimeoutMs } from "@/lib/config/ai-timeouts";
import { chatTraceEnabled } from "@/lib/config/chat-quality-flags";
import { authorizedSalonIds } from "@/lib/forms/location-scope";
import type { ChatMessage } from "@/types";

import { getAnthropicClient } from "../anthropic";
import { finishChatTrace, openChatTrace } from "../chat-trace";
import { chatTraceDraft } from "../chat-trace-store";
import { AiError } from "../errors";
import { noteModelCall } from "../model-failure";
import { cachedSystem, DYNAMIC_MARKER } from "../prompt-cache";
import { AI_TIMEOUT_MESSAGE, isAiTimeLimitError, logAiFailure, withAiTimeLimit } from "../time-limit";
import type { AskResponse } from "../types";
import { agentLoopSystem, AGENT_LOOP_RULES } from "./prompt";
import { agentLoopStepLimit } from "./switch";
import {
  editForm,
  findPastForms,
  findStaff,
  manualFor,
  proposeForm,
  readForm,
  readPolicy,
  templateChoices,
  type ToolContext,
  type ToolEffects,
  type ToolResult,
} from "./tools";

/**
 * ============================================================================
 * THE HR CHAT'S TOOL LOOP (AGENT_LOOP_ENABLED)
 * ============================================================================
 *
 * The L10 assistant's pattern (`features/l10/assistant/assistant.server.ts`,
 * tools with `stopWhen: stepCountIs(n)`), on the app's own Anthropic client:
 * the model asks for a tool, the code runs it as the signed-in manager
 * (`tools.ts`), the result goes back to the model as a tool_result, and so on
 * until it writes the reply — which is returned AS WRITTEN: no reply rewrites,
 * no intent routing. The app's client, not the AI SDK: the AI SDK stays in the
 * form-patch call and the L10 tab (`form-patch-flags-off.test.ts`), and every
 * step is counted by the spend meter and bounded by the AI time limits like
 * any other call. The route keeps everything around it: authentication, the
 * rate limit, the spend guard and daily cap (checked before this is reached),
 * the turn record.
 *
 *   steps        AGENT_LOOP_MAX_STEPS, default 6, never more than 10
 *   time         each model step the main limit (45 s); the whole loop 100 s,
 *                under the route's 120 s
 *   limit/error  a clear reply, never an empty one, and a server log line
 *   trace        chat_traces `slots.agent_loop`: each step's tool, ms and
 *                result size — names and numbers only, never values
 *   spend        every step's usage into the request's spend meter; the
 *                trace row carries the model and the turn's totals, so the
 *                monthly budget and the daily cap count it
 */

export const AGENT_LOOP_TOTAL_MS = 100_000;

export const STEP_LIMIT_REPLY = "I couldn't finish that in the steps I have for one message. Could you tell me the one thing you want done first?";
export const LOOP_FAILED_REPLY = "Sunny could not finish that answer. Nothing was saved. Please send it again in a moment.";

export interface AgentLoopStep {
  readonly step: number;
  readonly tool: string;
  readonly ms: number;
  readonly resultChars: number;
  readonly ok: boolean;
}

export interface AgentTurnInput {
  readonly request: Request;
  readonly actor: ToolContext["actor"];
  readonly question: string;
  readonly questionMessageId?: string;
  readonly history: readonly ChatMessage[];
  readonly scopeId: string;
  readonly today: string;
  readonly conversationId?: string;
  readonly openFormId: string | null;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** The conversation as model messages: the manager's and Sunny's turns, newest 20, starting with the manager's. */
function conversationOf(history: readonly ChatMessage[], question: string): { role: "user" | "assistant"; content: unknown }[] {
  const turns = history
    .filter((message) => !message.error && typeof message.content === "string" && message.content.trim() !== "")
    .map((message) => ({ role: message.role === "assistant" ? ("assistant" as const) : ("user" as const), content: message.content as unknown }))
    .slice(-20);
  while (turns.length > 0 && turns[0]!.role === "assistant") turns.shift();
  // Two turns of one role in a row (a failed reply left out) are joined, as the API needs them to alternate.
  const merged: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const turn of [...turns, { role: "user" as const, content: question as unknown }]) {
    const previous = merged.at(-1);
    if (previous && previous.role === turn.role) previous.content = `${String(previous.content)}\n\n${String(turn.content)}`;
    else merged.push({ ...turn });
  }
  return merged;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });

export const AGENT_LOOP_TOOLS = [
  {
    name: "find_staff",
    description: "Search this manager's staff roster by name (any case, partial first or last name). Returns roster spellings and employee_ids; several when names are shared.",
    input_schema: object({ name: { type: "string" } }, ["name"]),
  },
  {
    name: "find_past_forms",
    description: "List the forms on file (Form Monitoring) for one employee, as this manager may see them.",
    input_schema: object({ employee_name: { type: "string" } }, ["employee_name"]),
  },
  {
    name: "read_form",
    description: "Read one form's current saved values and status.",
    input_schema: object({ instance_id: { type: "string" } }, ["instance_id"]),
  },
  {
    name: "read_policy",
    description: "Read one section of the JBA Policy Manual by its heading: its wording and printed page.",
    input_schema: object({ heading: { type: "string" } }, ["heading"]),
  },
  {
    name: "propose_form",
    description: "Show a draft form card for the manager to create. Nothing is saved until they press Create.",
    input_schema: object(
      {
        template_key: { type: "string" },
        employee_id: { type: "string", description: "From find_staff." },
        employee_name: { type: "string", description: "Only when find_staff said the roster cannot be searched." },
        policy: { type: "string", description: "One JBA Policy Manual heading, exactly." },
        what_happened: { type: "string", description: "What happened, in the manager's words." },
        incident_date: { type: "string", description: "YYYY-MM-DD, the salon's local date." },
        warning_level: { type: "string", enum: ["verbal", "written"] },
      },
      ["template_key"],
    ),
  },
  {
    name: "edit_form",
    description: "Change fields of a DRAFT form (field key to new text). Finalized forms cannot be edited.",
    input_schema: object({ instance_id: { type: "string" }, values: { type: "object", additionalProperties: { type: "string" } } }, ["instance_id", "values"]),
  },
];

type ContentBlock = { type?: string; text?: string; id?: string; name?: string; input?: unknown };
type ModelReply = { content?: ContentBlock[]; stop_reason?: string | null; usage?: Record<string, unknown> | null };

export async function runAgentTurn(input: AgentTurnInput): Promise<AskResponse> {
  if (!chatTraceEnabled()) return loop(input);
  const draft = openChatTrace({
    conversationId: input.conversationId ?? null,
    messageId: input.questionMessageId ?? null,
    userId: input.actor.subject,
    originalQuery: input.question,
    formInProgress: input.openFormId !== null,
  });
  draft.intent = "agent_loop";
  return finishChatTrace(draft, () => loop(input));
}

async function loop(input: AgentTurnInput): Promise<AskResponse> {
  const context: ToolContext = {
    request: input.request,
    actor: input.actor,
    question: input.question,
    questionMessageId: input.questionMessageId,
    history: input.history,
    scopeId: input.scopeId,
    today: input.today,
  };
  const effects: ToolEffects = { proposal: null, policyHeading: null, formUpdate: null };
  const steps: AgentLoopStep[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
    find_staff: (args) => findStaff(context, args),
    find_past_forms: (args) => findPastForms(context, args),
    read_form: (args) => readForm(context, args),
    read_policy: (args) => readPolicy(context, args),
    propose_form: (args) => proposeForm(context, effects, args),
    edit_form: (args) => editForm(context, effects, args),
  };

  /* One tool call, timed and counted for the trace: its name, ms and result size; never its values. */
  const runTool = async (step: number, name: string, args: unknown): Promise<ToolResult> => {
    const started = performance.now();
    let result: ToolResult;
    try {
      const handler = handlers[name];
      result = handler ? await handler((args && typeof args === "object" ? args : {}) as Record<string, unknown>) : { error: `There is no tool named ${name}.` };
    } catch {
      result = { error: "That lookup failed just now." };
    }
    steps.push({ step, tool: name, ms: Math.round(performance.now() - started), resultChars: JSON.stringify(result).length, ok: !("error" in result) });
    return result;
  };

  const [templates, manual] = await Promise.all([templateChoices(input.actor.role), manualFor(input.scopeId)]);
  const dynamic = agentLoopSystem({
    managerName: input.actor.displayName,
    role: input.actor.role,
    salons: authorizedSalonIds(input.actor.scope),
    today: input.today,
    templates,
    headings: manual?.headings ?? [],
    openFormId: input.openFormId,
  });
  // The rules are cached; the turn's facts after the marker are not (`prompt-cache.ts`).
  const system = cachedSystem(`${AGENT_LOOP_RULES}\n\n${DYNAMIC_MARKER}\n${dynamic}`);

  const limit = agentLoopStepLimit();
  const started = performance.now();
  const messages = conversationOf(input.history, input.question);
  let text = "";
  let stoppedAt = "step_limit" as "reply" | "step_limit" | "timeout" | "error";
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let modelCalls = 0;
  try {
    const client = getAnthropicClient();
    /*
     * AI TIME LIMITS: each model step ends by the main limit (45 s), the SDK's retries included; the whole loop by
     * AGENT_LOOP_TOTAL_MS, under the route's 120 s. Every step goes through the app's one client, so the spend meter
     * counts it (SPEND_GUARD_ALL_CALLS_ENABLED) as it counts every other call.
     */
    await withAiTimeLimit("agent_loop", AGENT_LOOP_TOTAL_MS, async () => {
      for (let step = 1; step <= limit; step += 1) {
        const reply = (await withAiTimeLimit("agent_loop_step", mainAnswerTimeoutMs(), (timed) =>
          client.messages.create(
            {
              model: CLAUDE_MODEL,
              max_tokens: CLAUDE_MAX_TOKENS.standard,
              thinking: { type: "adaptive" as const },
              output_config: { effort: CLAUDE_EFFORT },
              system,
              tools: AGENT_LOOP_TOOLS,
              messages,
            } as never,
            timed,
          ),
        )) as unknown as ModelReply;
        modelCalls += 1;
        for (const key of Object.keys(usage) as (keyof typeof usage)[]) usage[key] += count(reply.usage?.[key]);
        const content = reply.content ?? [];
        const calls = content.filter((block) => block.type === "tool_use" && typeof block.name === "string");
        text = content
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text ?? "")
          .join("\n")
          .trim();
        if (reply.stop_reason !== "tool_use" || calls.length === 0) {
          stoppedAt = "reply";
          return;
        }
        messages.push({ role: "assistant", content });
        const results = [];
        for (const call of calls) {
          const result = await runTool(step, call.name!, call.input);
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result), ...("error" in result ? { is_error: true } : {}) });
        }
        messages.push({ role: "user", content: results });
      }
    });
  } catch (error) {
    if (error instanceof MissingConfigurationError) throw new AiError("not_configured", error.message, 503, error.missing);
    // A timeout already wrote its log line (`withAiTimeLimit`).
    stoppedAt = isAiTimeLimitError(error) ? "timeout" : "error";
    if (stoppedAt === "error") logAiFailure("agent_loop", performance.now() - started, error);
  }

  const latencyMs = Math.round(performance.now() - started);
  noteModelCall({
    model: CLAUDE_MODEL,
    maxTokens: CLAUDE_MAX_TOKENS.standard,
    stopReason: stoppedAt === "reply" ? "end_turn" : stoppedAt,
    latencyMs,
    usage,
    ...(stoppedAt === "timeout" ? { subtype: "timeout" as const } : stoppedAt === "error" ? { subtype: "model_failed" as const } : {}),
  });
  const trace = chatTraceDraft();
  if (trace) {
    trace.slots = {
      ...(trace.slots ?? {}),
      agent_loop: { steps, model_calls: modelCalls, step_limit: limit, stopped: stoppedAt, ms: latencyMs },
    };
  }

  if (stoppedAt === "timeout") throw new AiError("model_failed", AI_TIMEOUT_MESSAGE, 504);
  if (stoppedAt === "error") throw new AiError("model_failed", LOOP_FAILED_REPLY, 502);

  let content = stoppedAt === "step_limit" ? STEP_LIMIT_REPLY : text;
  if (content === "") content = effects.proposal ? "Here is the form for you to review." : STEP_LIMIT_REPLY;
  /* The card's policy line, which the Create button sends to the draft (`card-policy.ts`): added only when the model left it out. */
  if (effects.proposal && effects.policyHeading && !/\*\*Policy:\*\*/.test(content)) {
    content = `${content}\n\n**Policy:** ${effects.policyHeading}`;
  }

  return {
    content,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    ...(effects.proposal ? { formProposal: effects.proposal } : {}),
    ...(effects.formUpdate ? { formUpdate: effects.formUpdate } : {}),
  };
}

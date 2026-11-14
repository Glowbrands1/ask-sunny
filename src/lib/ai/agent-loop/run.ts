import "server-only";

import { CLAUDE_EFFORT, CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from "@/lib/config/models";
import { MissingConfigurationError, requireEnv } from "@/lib/config/server-env";
import { mainAnswerTimeoutMs, streamGapTimeoutMs } from "@/lib/config/ai-timeouts";
import { chatTraceEnabled } from "@/lib/config/chat-quality-flags";
import { authorizedSalonIds } from "@/lib/forms/location-scope";
import { stillAsks } from "@/lib/forms/reply-guards";
import type { ChatMessage } from "@/types";

import { finishChatTrace, openChatTrace } from "../chat-trace";
import { chatTraceDraft } from "../chat-trace-store";
import { AiError } from "../errors";
import { noteModelCall } from "../model-failure";
import { activeSpendMeter } from "../spend-meter";
import { AI_TIMEOUT_MESSAGE, isAiTimeLimitError, logAiFailure, withStreamTimeLimit } from "../time-limit";
import type { AskResponse } from "../types";
import { withUnderPerformanceExplained } from "../under-performance-explained";
import { agentLoopSystem, AGENT_LOOP_RULES } from "./prompt";
import { agentLoopStepLimit } from "./switch";
import {
  appHelp,
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
 * The L10 assistant's stack and pattern (`features/l10/assistant/assistant.server.ts`):
 * the Vercel AI SDK's streamText with tools and `stopWhen: stepCountIs(n)`.
 * The model asks for a tool, the code runs it as the signed-in manager
 * (`tools.ts`), the result goes back to the model, and so on until it writes
 * the reply — which is returned AS WRITTEN: no reply rewrites, no intent
 * routing. The route keeps everything around it: authentication, the rate
 * limit, the spend guard and daily cap (checked before this is reached), the
 * turn record.
 *
 *   steps        AGENT_LOOP_MAX_STEPS, default 6, never more than 10
 *   time         Part 1's stream limits on each step (45 s to its first
 *                token, then 30 s between chunks: a long answer that keeps
 *                streaming is never cut); the whole loop 100 s, and never
 *                past the route's 120 s less 8 s from the request's start
 *                (`deadlineAwareTotalMs`, Part 1)
 *   limit/error  a clear reply, never an empty one, and a server log line
 *   trace        chat_traces `slots.agent_loop`: each tool call's name, ms and
 *                result size, and each model call's ms, stop reason and
 *                tokens — names and numbers only, never values
 *   spend        every step's usage into the request's spend meter
 *                (SPEND_GUARD_ALL_CALLS_ENABLED), as form-patch-call does; the
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
        policy: { type: "string", description: "One JBA Policy Manual heading, exactly, or \"Other\" (a cleaning or sanitation duty left undone is always Other)." },
        what_happened: { type: "string", description: "What happened, in the manager's words." },
        incident_date: { type: "string", description: "YYYY-MM-DD, the salon's local date." },
        warning_level: { type: "string", enum: ["verbal", "written"] },
        payroll_deduct: { type: "string", enum: ["yes", "no"], description: "Only when the manager said whether payroll deduct applies." },
        payroll_amount: { type: "string", description: "The deduction amount the manager stated, digits." },
      },
      ["template_key"],
    ),
  },
  {
    name: "edit_form",
    description:
      "Change a DRAFT form. Leave values out to have the form's own reviser apply the manager's latest message (dates, details, the policy line); give values (field key to exact text) only for text the manager dictated word for word. Finalized forms cannot be edited.",
    input_schema: object({ instance_id: { type: "string" }, values: { type: "object", additionalProperties: { type: "string" } } }, ["instance_id"]),
  },
  {
    name: "app_help",
    description: "This app's own help: how to sign in, reset or change your password, and what Sunny can do. Use it for any question about using this app; never send the manager to IT when this has the answer.",
    input_schema: object({ topic: { type: "string", enum: ["password", "sign_in", "what_sunny_does"] } }, ["topic"]),
  },
];

/** Test seam: the language model (AI SDK) the loop calls. Unset, Claude through @ai-sdk/anthropic. */
let modelForTests: unknown = null;
export function __setAgentLoopModelForTests(model: unknown): void {
  modelForTests = model;
}

type StepUsage = { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } };

/** An AI SDK step's usage in Anthropic's names: uncached input, output, cache reads, cache writes. */
function tokensOf(usage: StepUsage | undefined) {
  const cacheRead = count(usage?.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = count(usage?.inputTokenDetails?.cacheWriteTokens);
  const input = usage?.inputTokenDetails?.noCacheTokens ?? Math.max(0, count(usage?.inputTokens) - cacheRead - cacheWrite);
  return { input_tokens: count(input), output_tokens: count(usage?.outputTokens), cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite };
}

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
  const effects: ToolEffects = { proposal: null, policyLine: null, formUpdate: null };
  const steps: AgentLoopStep[] = [];
  /* Each model call's tokens and ms, for the trace (numbers only). */
  const modelSteps: { step: number; ms: number; stop: string | null; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
    find_staff: (args) => findStaff(context, args),
    find_past_forms: (args) => findPastForms(context, args),
    read_form: (args) => readForm(context, args),
    read_policy: (args) => readPolicy(context, args),
    propose_form: (args) => proposeForm(context, effects, args),
    edit_form: (args) => editForm(context, effects, args),
    app_help: (args) => appHelp(args),
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

  const { jsonSchema, stepCountIs, streamText, tool } = await import("ai");
  const model = modelForTests ?? (await import("@ai-sdk/anthropic")).createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") })(CLAUDE_MODEL);
  let stepNumber = 1;
  const tools = Object.fromEntries(
    AGENT_LOOP_TOOLS.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema<Record<string, unknown>>(definition.input_schema as never),
        execute: (args: Record<string, unknown>) => runTool(stepNumber, definition.name, args),
      }),
    ]),
  );

  const limit = agentLoopStepLimit();
  const started = performance.now();
  let text = "";
  let stoppedAt = "step_limit" as "reply" | "step_limit" | "timeout" | "error";
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let modelCalls = 0;
  try {
    /*
     * AI TIME LIMITS (Part 1): each step has 45 s to its first token, then 30 s between chunks, and the whole loop
     * AGENT_LOOP_TOTAL_MS, under the route's 120 s — through the abort signal. A long answer that keeps streaming is
     * never cut. Each step's usage goes into the request's spend meter, as every other call's does.
     */
    await withStreamTimeLimit("agent_loop", { firstTokenMs: mainAnswerTimeoutMs(), gapMs: streamGapTimeoutMs(), totalMs: AGENT_LOOP_TOTAL_MS }, async (timed, watch) => {
      let stepStarted = performance.now();
      const result = streamText({
        model: model as never,
        system: [
          { role: "system", content: AGENT_LOOP_RULES, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
          { role: "system", content: dynamic },
        ],
        messages: conversationOf(input.history, input.question) as never,
        tools,
        stopWhen: stepCountIs(limit),
        maxOutputTokens: CLAUDE_MAX_TOKENS.standard,
        maxRetries: timed.maxRetries,
        abortSignal: timed.signal,
        providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort: CLAUDE_EFFORT } } as never,
        onError: () => {},
        onChunk: ({ chunk }) => {
          watch.chunk();
          if (chunk.type === "text-delta" || chunk.type === "reasoning-delta" || chunk.type === "tool-input-start" || chunk.type === "tool-call") watch.firstToken();
        },
        onStepFinish: (step) => {
          const used = tokensOf(step.usage as StepUsage);
          for (const key of Object.keys(usage) as (keyof typeof usage)[]) usage[key] += used[key];
          activeSpendMeter()?.calls.push({
            model: CLAUDE_MODEL,
            inputTokens: used.input_tokens,
            outputTokens: used.output_tokens,
            cacheReadTokens: used.cache_read_input_tokens,
            cacheWriteTokens: used.cache_creation_input_tokens,
          });
          modelSteps.push({ step: stepNumber, ms: Math.round(performance.now() - stepStarted), stop: step.finishReason ?? null, ...used });
          modelCalls += 1;
          stepNumber += 1;
          stepStarted = performance.now();
          // The next step waits for its own first token.
          watch.attempt();
        },
      });
      const steps = await result.steps;
      const last = steps.at(-1);
      text = (last?.text ?? "").trim();
      stoppedAt = last && last.finishReason === "tool-calls" ? "step_limit" : "reply";
    });
  } catch (error) {
    if (error instanceof MissingConfigurationError) throw new AiError("not_configured", error.message, 503, error.missing);
    // A timeout already wrote its log line (`withStreamTimeLimit`).
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
      agent_loop: { steps, model_steps: modelSteps, model_calls: modelCalls, step_limit: limit, stopped: stoppedAt, ms: latencyMs },
    };
  }

  if (stoppedAt === "timeout") throw new AiError("model_failed", AI_TIMEOUT_MESSAGE, 504);
  if (stoppedAt === "error") throw new AiError("model_failed", LOOP_FAILED_REPLY, 502);

  let content = stoppedAt === "step_limit" ? STEP_LIMIT_REPLY : text;
  if (content === "") content = effects.proposal ? "Here is the form for you to review." : STEP_LIMIT_REPLY;
  /*
   * The card's policy line, which the Create button sends to the draft (`card-policy.ts`): the one propose_form decided
   * (a manual heading, or Other under the company's cleaning rule). A "**Policy:**" line the model wrote itself is
   * replaced by it, so the card and the draft never disagree.
   */
  if (effects.proposal && effects.policyLine) {
    content = `${content.split("\n").filter((line) => !/^\s*\*\*Policy:?\*\*/i.test(line)).join("\n").trim()}\n\n**Policy:** ${effects.policyLine}`;
  }
  /* CLOSE_SPELLING: a policy spelled too far off is asked about, never cited (the tool decided; the code says it). */
  if (effects.proposal && effects.confirmPolicy && !content.includes(effects.confirmPolicy)) {
    content = `${content.split("\n").filter((line) => !/^\s*\*\*Policy:?\*\*|did you mean/i.test(line)).join("\n").trim()}\n\n${effects.confirmPolicy}`;
  }

  /*
   * An edit the open-form reader wrote: its reply is what was saved, field by field (the realized diff today's chat
   * shows), so the reply never claims more or less than the draft now holds.
   */
  if (effects.revisedReply && effects.formUpdate && !effects.proposal) content = effects.revisedReply;

  /* EVERY REPLY (QA, 3 Nov 2026): "I still need …" only when the reply asks who, which location or which date. */
  if (/^I still need\b/m.test(content) && stillAsks(content) === null) content = content.replace(/^I still need\b/gm, "I need");

  const response: AskResponse = {
    content,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    ...(effects.proposal ? { formProposal: effects.proposal } : {}),
    ...(effects.formUpdate ? { formUpdate: effects.formUpdate } : {}),
  };
  /* Pau's line (UNDER_PERFORMANCE_EXPLAINED, the app's own finisher): Under Performance asked for, Standards of Conduct cited. */
  return withUnderPerformanceExplained(response, { question: input.question });
}

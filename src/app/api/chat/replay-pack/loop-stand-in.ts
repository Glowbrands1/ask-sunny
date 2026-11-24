/**
 * ============================================================================
 * A STAND-IN FOR THE TOOL LOOP'S MODEL (AGENT_LOOP_ENABLED), FOR THE REPLAY PACK
 * ============================================================================
 *
 * No live model runs offline, so a case scripts what the model decides at each
 * step — a tool call or the reply — from what it was shown: the system prompt,
 * the conversation and the tool results so far. Everything else is real: the
 * route, the tools (roster, Form Monitoring, the manual, the card, the one
 * writer), the step limit, the trace. So a case shows the CODE's side of the
 * loop (what the tools return, what reaches the card and the history), never a
 * live model's judgement; QA measures that on the test user.
 */

import { withoutMessageIdTags } from "@/lib/ai/agent-loop/evidence";

export interface LoopView {
  readonly system: string;
  /** The manager's and Sunny's turns as the model was given them, oldest first. */
  readonly turns: readonly { readonly role: "user" | "assistant"; readonly text: string; readonly messageIds?: readonly string[] }[];
  /** This turn's tool results so far, in order. */
  readonly results: readonly { readonly tool: string; readonly output: Record<string, unknown> }[];
  /** The model call within this turn, from 0. */
  readonly step: number;
}

export type LoopDecision =
  | { readonly tool: string; readonly input: Record<string, unknown> }
  /** Several tool calls in ONE step, as a live model makes them; the AI SDK runs them together (QA, 16 Nov 2026, item B). */
  | { readonly tools: ReadonlyArray<{ readonly tool: string; readonly input: Record<string, unknown> }> }
  | { readonly text: string; readonly cut?: boolean }
  /** The request is accepted and nothing more arrives, until the call is aborted (a stalled model). */
  | { readonly stall: true }
  /** The model call fails outright (batch F1: an error after a tool already saved). */
  | { readonly fail: true };

export interface LoopStandIn {
  /** The AI SDK language model the loop is given (`__setAgentLoopModelForTests`). */
  readonly model: unknown;
  readonly views: LoopView[];
  /** Each step's prompt exactly as the model received it (the provider's view, cache markers included). */
  readonly prompts: unknown[];
  /** Batch J8: each call's provider options (thinking, effort), to see a hand-back asks as the turn's first call did. */
  readonly providerOptions: unknown[];
  calls: number;
}

type Part = { type?: string; text?: string; toolName?: string; toolCallId?: string; output?: { type?: string; value?: unknown } };
type Message = { role: string; content: string | Part[] };

/** What the model was shown, from an AI SDK (v3) prompt: system, the conversation, this turn's tool results. */
function viewOf(prompt: readonly Message[]): LoopView {
  const system = prompt
    .filter((message) => message.role === "system")
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n\n");
  // The turn begins at the last user message (the manager's words; tool results are "tool" messages).
  let start = -1;
  prompt.forEach((message, index) => {
    if (message.role === "user") start = index;
  });
  const turns: { role: "user" | "assistant"; text: string; messageIds?: string[] }[] = [];
  for (const message of prompt.slice(0, start + 1)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const shown = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
    // The evidence tags (`[message_id: <id>]`, evidence.ts) are kept apart, so a case reads the manager's words as typed.
    const messageIds = [...shown.matchAll(/\[message_id:\s*([^\]\n]+)\]/g)].map((found) => found[1]!.trim());
    const text = withoutMessageIdTags(shown);
    if (text !== "") turns.push({ role: message.role, text, ...(messageIds.length > 0 ? { messageIds } : {}) });
  }
  const results: { tool: string; output: Record<string, unknown> }[] = [];
  let step = 0;
  for (const message of prompt.slice(start + 1)) {
    if (message.role === "assistant") step += 1;
    if (message.role !== "tool" || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") results.push({ tool: part.toolName ?? "", output: (part.output?.value ?? {}) as Record<string, unknown> });
    }
  }
  return { system, turns, results, step };
}

const USAGE = {
  inputTokens: { total: 1200, noCache: 200, cacheRead: 1000, cacheWrite: 0 },
  outputTokens: { total: 60, text: 60, reasoning: 0 },
};

function streamOf(parts: readonly Record<string, unknown>[]): ReadableStream<Record<string, unknown>> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** A language model (AI SDK v3, streamed) that answers each step with `decide`'s choice. */
type ToolCall = { readonly tool: string; readonly input: Record<string, unknown> };

/*
 * Changed on purpose (QA's review of #1137, 20 Nov 2026; QA agreed to updating the older Attendance cases): the rules book
 * now requires `attendance` on a Corrective Action card citing Attendance, and propose_form refuses one without it
 * (`attendance_not_given`). A scripted model written before the rule follows it here, in one place rather than in each
 * of the 46 older cases: a "dpoa" propose_form whose policy names Attendance (never Late Opening) and that has no
 * `attendance` key gets "lateness", quoting the request message it already cites (see below). "lateness" changes nothing
 * those cards saved before (only "absence" does). A case that omits the field ON PURPOSE sets `attendance: undefined`
 * (nov20-write-up-attendance-omitted-tool-asks), and is left as written.
 */
function followsAttendanceRule(view: LoopView, decision: LoopDecision): LoopDecision {
  const fill = (call: ToolCall): ToolCall => {
    if (call.tool !== "propose_form" || call.input.template_key !== "dpoa" || "attendance" in call.input) return call;
    const policy = typeof call.input.policy === "string" ? call.input.policy : "";
    if (!/\battendance\b/i.test(policy) || /\blate\s+open/i.test(policy)) return call;
    /*
     * The quote is from the request message the card already cites for the person (or the level), so an answer turn
     * ("25" to the payroll question) is never quoted as the account; else the message being answered.
     */
    const cited = [call.input.person_evidence, call.input.level_evidence].find((evidence) => typeof (evidence as { message_id?: unknown } | undefined)?.message_id === "string");
    return { ...call, input: { ...call.input, attendance: "lateness", attendance_evidence: cited ?? evidenceFrom(view) } };
  };
  if ("tools" in decision) return { tools: decision.tools.map(fill) };
  if ("tool" in decision) return fill(decision);
  return decision;
}

/** `decide` may return a promise (PR 6 item 5: a case that takes real time per step, so the route's stream starts). */
export function loopStandIn(decide: (view: LoopView) => LoopDecision | Promise<LoopDecision>): LoopStandIn {
  const standIn: LoopStandIn = {
    views: [],
    prompts: [],
    providerOptions: [],
    calls: 0,
    model: {
      specificationVersion: "v3",
      provider: "stand-in",
      modelId: "claude-stand-in",
      supportedUrls: {},
      async doGenerate() {
        throw new Error("the stand-in only streams");
      },
      async doStream(options: { prompt: Message[]; abortSignal?: AbortSignal; providerOptions?: unknown }) {
        standIn.calls += 1;
        standIn.prompts.push(options.prompt);
        standIn.providerOptions.push(options.providerOptions ?? null);
        const view = viewOf(options.prompt);
        standIn.views.push(view);
        const decision = followsAttendanceRule(view, await decide(view));
        if ("fail" in decision) throw new Error("the stand-in model failed");
        if ("stall" in decision) {
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "stream-start", warnings: [] });
                options.abortSignal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
              },
            }),
          };
        }
        const parts: Record<string, unknown>[] =
          "tools" in decision
            ? [
                { type: "stream-start", warnings: [] },
                ...decision.tools.map((call, index) => ({ type: "tool-call", toolCallId: `call-${standIn.calls}-${index}`, toolName: call.tool, input: JSON.stringify(call.input) })),
                { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
              ]
            : "tool" in decision
            ? [
                { type: "stream-start", warnings: [] },
                { type: "tool-call", toolCallId: `call-${standIn.calls}`, toolName: decision.tool, input: JSON.stringify(decision.input) },
                { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
              ]
            : [
                { type: "stream-start", warnings: [] },
                { type: "text-start", id: "t" },
                { type: "text-delta", id: "t", delta: decision.text },
                { type: "text-end", id: "t" },
                { type: "finish", finishReason: decision.cut ? { unified: "length", raw: "max_tokens" } : { unified: "stop", raw: "end_turn" }, usage: USAGE },
              ];
        return { stream: streamOf(parts) };
      },
    },
  };
  return standIn;
}

/** The last result of a tool this turn, if any. */
export function lastResult(view: LoopView, tool: string): Record<string, unknown> | null {
  return [...view.results].reverse().find((result) => result.tool === tool)?.output ?? null;
}

/** The first roster match find_staff returned this turn. */
export function firstMatch(view: LoopView): { employee_id: string; name: string } | null {
  const matches = (lastResult(view, "find_staff")?.matches ?? []) as { employee_id: string; name: string }[];
  return matches[0] ?? null;
}

/** The manual heading the system prompt lists that contains `word`. */
export function headingWith(view: LoopView, word: RegExp): string | null {
  const block = view.system.split("JBA Policy Manual headings")[1] ?? "";
  return block.split("\n").map((line) => line.replace(/^- /, "").trim()).find((line) => word.test(line)) ?? null;
}

/**
 * AGENT_LOOP_LIVE (dev, opt-in; nothing changes when unset): the real model in place of the stand-in, wrapped so a
 * case still sees what it was shown (`views`, `calls`). Needs ANTHROPIC_API_KEY; never runs in CI.
 */
export function liveRecording(standIn: LoopStandIn, real: unknown): unknown {
  const model = real as { doStream: (options: { prompt: Message[] }) => Promise<unknown>; doGenerate: (options: { prompt: Message[] }) => Promise<unknown> };
  const record = (options: { prompt: Message[] }) => {
    standIn.calls += 1;
    standIn.views.push(viewOf(options.prompt));
  };
  return new Proxy(model as object, {
    get(target, prop, receiver) {
      if (prop === "doStream") return async (options: { prompt: Message[] }) => (record(options), model.doStream(options));
      if (prop === "doGenerate") return async (options: { prompt: Message[] }) => (record(options), model.doGenerate(options));
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Evidence for a tool (the rebuild plan, `evidence.ts`): the id of the manager message this turn answers (or the one
 * `back` manager messages before it) and a quote from it (by default its first whole words, about 40 characters), as a model would pass it.
 */
export function evidenceFrom(view: LoopView, quote?: string, back = 0): { message_id: string; quote: string } {
  const manager = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  const turn = manager[manager.length - 1 - back] ?? manager.at(-1);
  // The default quote is the message's first words, whole (evidence.ts matches whole words only).
  // Contiguous: it stops at the first word that does not fit (a later short word is never added after a gap).
  const opening = (turn?.text ?? "").split(/\s+/).reduce((kept, word) => (kept.full || (kept.text !== "" && kept.text.length + word.length + 1 > 40) ? { ...kept, full: true } : { text: `${kept.text} ${word}`.trim(), full: false }), { text: "", full: false }).text;
  return { message_id: turn?.messageIds?.at(-1) ?? "current", quote: quote ?? opening };
}

/**
 * A setup that files a second form for the same person and incident date (to have both on file) now meets the
 * same-incident question (Pau's Failure 2 review, 23-24 Nov 2026: `same_incident_on_file`). The setup answers it as a
 * manager would: SEPARATE_INCIDENT, and the stand-in proposes again with that answer as its evidence.
 */
export const SEPARATE_INCIDENT = "it's a separate incident";
export function separateIfSaid(view: LoopView): Record<string, unknown> {
  return view.turns.filter((turn) => turn.role === "user").at(-1)?.text === SEPARATE_INCIDENT ? { separate_incident_evidence: evidenceFrom(view, SEPARATE_INCIDENT) } : {};
}


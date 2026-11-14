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

export interface LoopView {
  readonly system: string;
  /** The manager's and Sunny's turns as the model was given them, oldest first. */
  readonly turns: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  /** This turn's tool results so far, in order. */
  readonly results: readonly { readonly tool: string; readonly output: Record<string, unknown> }[];
  /** The model call within this turn, from 0. */
  readonly step: number;
}

export type LoopDecision =
  | { readonly tool: string; readonly input: Record<string, unknown> }
  | { readonly text: string; readonly cut?: boolean }
  /** The request is accepted and nothing more arrives, until the call is aborted (a stalled model). */
  | { readonly stall: true };

export interface LoopStandIn {
  /** The AI SDK language model the loop is given (`__setAgentLoopModelForTests`). */
  readonly model: unknown;
  readonly views: LoopView[];
  /** Each step's prompt exactly as the model received it (the provider's view, cache markers included). */
  readonly prompts: unknown[];
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
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const message of prompt.slice(0, start + 1)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
    if (text !== "") turns.push({ role: message.role, text });
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
export function loopStandIn(decide: (view: LoopView) => LoopDecision): LoopStandIn {
  const standIn: LoopStandIn = {
    views: [],
    prompts: [],
    calls: 0,
    model: {
      specificationVersion: "v3",
      provider: "stand-in",
      modelId: "claude-stand-in",
      supportedUrls: {},
      async doGenerate() {
        throw new Error("the stand-in only streams");
      },
      async doStream(options: { prompt: Message[]; abortSignal?: AbortSignal }) {
        standIn.calls += 1;
        standIn.prompts.push(options.prompt);
        const view = viewOf(options.prompt);
        standIn.views.push(view);
        const decision = decide(view);
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
          "tool" in decision
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

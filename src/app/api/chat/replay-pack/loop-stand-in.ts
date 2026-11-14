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

export type LoopDecision = { readonly tool: string; readonly input: Record<string, unknown> } | { readonly text: string };

export interface LoopStandIn {
  /** The answer to one loop call (`messages.create` with the loop's tools). */
  readonly respond: (request: unknown) => Promise<unknown>;
  readonly views: LoopView[];
  calls: number;
}

type Block = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; content?: unknown };
type Message = { role: string; content: string | Block[] };
type Request = { system?: string | { text?: string }[]; messages?: Message[] };

function viewOf(request: Request): LoopView {
  const system = typeof request.system === "string" ? request.system : (request.system ?? []).map((block) => block.text ?? "").join("\n\n");
  const messages = request.messages ?? [];
  // The turn begins at the last user message that is the manager's words (not tool results).
  let start = -1;
  messages.forEach((message, index) => {
    if (message.role === "user" && (typeof message.content === "string" || message.content.some((block) => block.type === "text"))) start = index;
  });
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const message of messages.slice(0, start + 1)) {
    const text = typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    if (text !== "") turns.push({ role: message.role === "assistant" ? "assistant" : "user", text });
  }
  /* This turn's tool calls and their results, paired by id. */
  const names = new Map<string, string>();
  const results: { tool: string; output: Record<string, unknown> }[] = [];
  let step = 0;
  for (const message of messages.slice(start + 1)) {
    if (typeof message.content === "string") continue;
    if (message.role === "assistant") {
      step += 1;
      for (const block of message.content) if (block.type === "tool_use") names.set(block.id ?? "", block.name ?? "");
    } else {
      for (const block of message.content) {
        if (block.type === "tool_result") results.push({ tool: names.get(block.tool_use_id ?? "") ?? "", output: JSON.parse(String(block.content ?? "{}")) as Record<string, unknown> });
      }
    }
  }
  return { system, turns, results, step };
}

const USAGE = { input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };

/** The loop's model, answering each step with `decide`'s choice, in the Anthropic Messages shape. */
export function loopStandIn(decide: (view: LoopView) => LoopDecision): LoopStandIn {
  const standIn: LoopStandIn = {
    views: [],
    calls: 0,
    respond: async (request: unknown) => {
      standIn.calls += 1;
      const view = viewOf(request as Request);
      standIn.views.push(view);
      const decision = decide(view);
      if ("tool" in decision) {
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `call-${standIn.calls}`, name: decision.tool, input: decision.input }], usage: USAGE };
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: decision.text }], usage: USAGE };
    },
  };
  return standIn;
}

/** A loop call: the request offers the loop's tools. */
export function isLoopRequest(request: unknown): boolean {
  const tools = (request as { tools?: { name?: string }[] } | null)?.tools ?? [];
  return tools.some((tool) => tool.name === "find_staff") && tools.some((tool) => tool.name === "propose_form");
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

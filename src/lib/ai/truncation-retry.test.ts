import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * A CUT-OFF ANSWER IS NEVER SHOWN CUT OFF (TRUNCATION_RETRY_ENABLED)
 * ============================================================================
 *
 * QA, live, 1 Nov 2026: "Show me the most recent Daily Stats and what I need
 * to focus on today." got an answer that stopped mid-sentence — it ends "keep
 * an eye on whether new-customer counts (strong on Oct 30" — because the model
 * reached max_tokens (2048, of which 1242 were thinking) and the text was sent
 * as it was.
 */

const replies = vi.hoisted(() => ({ queue: [] as { text: string; stop: string }[], budgets: [] as number[] }));

vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { max_tokens: number }) => {
        replies.budgets.push(params.max_tokens);
        const next = replies.queue.shift()!;
        return { content: [{ type: "text", text: next.text }], stop_reason: next.stop, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  }),
}));

const CUT = "Using the most recent Daily Stats … keep an eye on whether new-customer counts (strong on Oct 30";
const WHOLE = "Using the most recent Daily Stats … keep an eye on whether new-customer counts (strong on Oct 30) hold through the weekend.";

async function ask(on: boolean, queue: { text: string; stop: string }[]) {
  if (on) process.env.TRUNCATION_RETRY_ENABLED = "true";
  replies.queue = [...queue];
  replies.budgets = [];
  const { callClaude } = await import("./call-claude");
  return callClaude({
    system: "system",
    grounding: "grounding",
    question: "Show me the most recent Daily Stats and what I need to focus on today.",
    history: [],
    maxTokens: 2048,
  } as never);
}

afterEach(() => {
  delete process.env.TRUNCATION_RETRY_ENABLED;
  vi.resetModules();
});

describe('"Show me the most recent Daily Stats and what I need to focus on today."', () => {
  it("off (production today): the cut-off answer is sent as it is", async () => {
    await expect(ask(false, [{ text: CUT, stop: "max_tokens" }])).resolves.toBe(CUT);
    expect(replies.budgets).toEqual([2048]);
  });

  it("TRUNCATION_RETRY: asked once more with twice the room, and the whole answer is sent", async () => {
    await expect(ask(true, [{ text: CUT, stop: "max_tokens" }, { text: WHOLE, stop: "end_turn" }])).resolves.toBe(WHOLE);
    expect(replies.budgets).toEqual([2048, 4096]);
  });

  it("TRUNCATION_RETRY: cut off twice, nothing from it is sent — a plain error says so", async () => {
    await expect(
      ask(true, [
        { text: CUT, stop: "max_tokens" },
        { text: CUT, stop: "max_tokens" },
      ]),
    ).rejects.toMatchObject({ code: "truncated", message: expect.stringContaining("ran out of room before finishing that answer") });
  });

  it("TRUNCATION_RETRY: a finished answer is asked once, as before", async () => {
    await expect(ask(true, [{ text: WHOLE, stop: "end_turn" }])).resolves.toBe(WHOLE);
    expect(replies.budgets).toEqual([2048]);
  });
});

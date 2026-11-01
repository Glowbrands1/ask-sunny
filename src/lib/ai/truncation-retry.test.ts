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

const replies = vi.hoisted(() => ({ queue: [] as { text: string; stop: string; takesMs?: number }[], budgets: [] as number[] }));

vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (params: { max_tokens: number }) => {
        replies.budgets.push(params.max_tokens);
        const next = replies.queue.shift()!;
        // How long this attempt took, on the faked clock.
        if (next.takesMs) vi.setSystemTime(Date.now() + next.takesMs);
        return { content: [{ type: "text", text: next.text }], stop_reason: next.stop, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  }),
}));

const CUT = "Using the most recent Daily Stats … keep an eye on whether new-customer counts (strong on Oct 30";
const WHOLE = "Using the most recent Daily Stats … keep an eye on whether new-customer counts (strong on Oct 30) hold through the weekend.";

async function ask(on: boolean, queue: { text: string; stop: string; takesMs?: number }[]) {
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

/*
 * QA, live, 1 Nov 2026: a cut-off Daily Stats briefing took about 31 s and its
 * retry 36 s — 67 s for one turn. TRUNCATION_RETRY_BUDGET_ENABLED: a first
 * attempt that already took over 50 s starts no retry, so a turn never stacks
 * two long attempts past the route's 120 s ceiling.
 */
describe("TRUNCATION_RETRY_BUDGET: a slow first attempt starts no retry", () => {
  afterEach(() => {
    delete process.env.TRUNCATION_RETRY_BUDGET_ENABLED;
    vi.useRealTimers();
  });

  async function slow(budget: boolean, takesMs: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:16:02Z"));
    if (budget) process.env.TRUNCATION_RETRY_BUDGET_ENABLED = "true";
    return ask(true, [
      { text: CUT, stop: "max_tokens", takesMs },
      { text: WHOLE, stop: "end_turn" },
    ]);
  }

  it("off: a first attempt of 55 s is still retried", async () => {
    await expect(slow(false, 55_000)).resolves.toBe(WHOLE);
    expect(replies.budgets).toEqual([2048, 4096]);
  });

  it("on: a first attempt of 55 s is not retried — the plain error, nothing cut off shown", async () => {
    await expect(slow(true, 55_000)).rejects.toMatchObject({ code: "truncated" });
    expect(replies.budgets).toEqual([2048]);
  });

  it("on: the live 31 s first attempt is still retried", async () => {
    await expect(slow(true, 31_000)).resolves.toBe(WHOLE);
    expect(replies.budgets).toEqual([2048, 4096]);
  });
});

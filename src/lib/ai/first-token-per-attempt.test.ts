import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * QA, 1 Nov 2026: with TRUNCATION_RETRY on, three retried Daily Stats answers
 * recorded a first token at 31–43 s. The first token was timed from the start
 * of the whole call, so it included the entire cut-off first attempt (~30 s).
 * It is timed per attempt now, as Ask Bubbles already does. Trace-only.
 */

const noted = vi.hoisted(() => ({ calls: [] as { firstTokenMs?: number | null }[] }));
const plan = vi.hoisted(() => ({ attempts: [] as { thinkMs: number; stop: string }[] }));

vi.mock("./model-failure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model-failure")>()),
  noteModelCall: (input: { firstTokenMs?: number | null }) => {
    noted.calls.push(input);
  },
}));

vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => {
        const next = plan.attempts.shift()!;
        return (async function* () {
          yield { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } };
          // The model thinks this long before its first text.
          vi.setSystemTime(Date.now() + next.thinkMs);
          yield { type: "content_block_delta", delta: { type: "text_delta", text: "Using the most recent Daily Stats …" } };
          vi.setSystemTime(Date.now() + 20_000);
          yield { type: "message_delta", delta: { stop_reason: next.stop }, usage: { output_tokens: 2048 } };
        })();
      },
    },
  }),
}));

afterEach(() => {
  delete process.env.TRUNCATION_RETRY_ENABLED;
  vi.useRealTimers();
  vi.resetModules();
  noted.calls = [];
});

describe('"Show me the most recent Daily Stats and what I need to focus on today.", cut off once and retried', () => {
  it("records the retry's own first token (10 s), not the time since the first attempt began (~40 s)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:16:02Z"));
    process.env.TRUNCATION_RETRY_ENABLED = "true";
    plan.attempts = [
      { thinkMs: 10_000, stop: "max_tokens" },
      { thinkMs: 10_000, stop: "end_turn" },
    ];
    const { callClaude } = await import("./call-claude");
    await callClaude({
      system: "system",
      grounding: "grounding",
      question: "Show me the most recent Daily Stats and what I need to focus on today.",
      history: [],
      maxTokens: 2048,
    } as never);
    expect(noted.calls.at(-1)?.firstTokenMs).toBe(10_000);
  });
});

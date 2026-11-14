import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * The fake client: `create` stalls the way production did — the request is
 * accepted (headers back, for a stream) and then nothing more arrives. A
 * stalled stream ends only when its signal aborts, and then ends QUIETLY, as
 * the SDK's stream does; the other stall ignores the signal and never settles.
 */
const client = vi.hoisted(() => ({ mode: "ok" as "ok" | "fail" | "stall-stream" | "stall-ignore-signal" | "stall-tool" | "slow-long" | "stall-midway" | "endless", calls: [] as unknown[][] }));
vi.mock("./anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: (...args: unknown[]) => {
        client.calls.push(args);
        const options = args[1] as { signal?: AbortSignal } | undefined;
        if (client.mode === "stall-stream") {
          return Promise.resolve({
            async *[Symbol.asyncIterator]() {
              yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
              await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve()));
              // Aborted: the SDK's stream returns without throwing.
            },
          });
        }
        if (client.mode === "slow-long" || client.mode === "stall-midway" || client.mode === "endless") {
          const mode = client.mode;
          const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
          return Promise.resolve({
            async *[Symbol.asyncIterator]() {
              yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
              // The first token at 40 s (production's long answers: 15–43 s).
              await wait(40_000);
              yield { type: "content_block_delta", delta: { type: "text_delta", text: "A long" } };
              if (mode === "stall-midway") {
                await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve()));
                return;
              }
              // Then a chunk every 5 s: to 60 s, or (endless) for as long as it is read.
              for (let at = 45_000; mode === "endless" || at <= 60_000; at += 5_000) {
                await wait(5_000);
                if (options?.signal?.aborted) return;
                yield { type: "content_block_delta", delta: { type: "text_delta", text: " answer" } };
              }
              yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3000 } };
            },
          });
        }
        if (client.mode === "stall-ignore-signal") return new Promise(() => {});
        if (client.mode === "fail") {
          return Promise.reject(Object.assign(new Error("echo of the request: dress code"), { status: 529, error: { type: "overloaded_error" } }));
        }
        if (client.mode === "stall-tool") {
          return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("Request was aborted."))));
        }
        return Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: "An answer." }], usage: { input_tokens: 1, output_tokens: 1 } });
      },
    },
  }),
}));

const traced = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("./chat-trace-store", () => ({
  chatRequestReceivedAt: () => Date.now(),
  updateChatTrace: (update: Record<string, unknown>) => traced.push(update),
}));

import { AiError } from "./errors";
import { callClaude, callClaudeTool } from "./call-claude";
import { readFormRequest } from "./reader/read";
import { AI_TIMEOUT_MESSAGE, AiTimeLimitError, withAiTimeLimit } from "./time-limit";
import { runInAiRoute } from "./ai-route";
import { errorResponse } from "@/lib/api/respond";
import { toChatTurnError } from "@/features/chat/chat-error";

/**
 * AI TIME LIMITS (QA, 14 Nov 2026). A slow model call ends at its limit with a
 * short message to show, one server log line (route, call, duration — no
 * text), and never an empty answer: for the main answer, the helper calls and
 * the reader. Drafting and chat revision are driven through their routes in
 * `src/lib/forms/ai-time-limits-e2e.test.ts`.
 */

const input = { system: "s", grounding: "g", history: [], question: "What is the dress code?", maxTokens: 100 };
let errors: { mock: { calls: unknown[][] } };

beforeEach(() => {
  client.mode = "ok";
  client.calls = [];
  traced.length = 0;
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.AI_MAIN_TIMEOUT_MS;
  delete process.env.AI_HELPER_TIMEOUT_MS;
  delete process.env.MODEL_RETRY_ENABLED;
});

function loggedLines(): string[] {
  return errors.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe("the main answer (callClaude)", () => {
  it("a stream that stalls after its headers ends at 45 s with the friendly message, a log line, and no empty answer", async () => {
    client.mode = "stall-stream";
    vi.useFakeTimers();
    const pending = runInAiRoute("chat", () => callClaude(input));
    const settled = pending.then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(errors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;

    expect(error).toBeInstanceOf(AiTimeLimitError);
    expect((error as AiError).message).toBe(AI_TIMEOUT_MESSAGE);
    expect((error as AiError).status).toBe(504);
    expect(loggedLines()).toEqual([expect.stringMatching(/^\[ai\.timeout\] route=chat call=main_answer duration_ms=\d+ limit_ms=45000 limit=first_token$/)]);
    // No question, grounding or answer text in the log line.
    expect(loggedLines().join("\n")).not.toContain("dress code");
    // On the trace as a timeout.
    expect(traced.at(-1)).toMatchObject({ errorSubtype: "timeout" });

    // What the manager sees: the route's reply and the chat card both carry the message; never empty.
    const response = errorResponse(error, "POST /api/chat");
    expect(response.status).toBe(504);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.error).toBe(AI_TIMEOUT_MESSAGE);
    const card = toChatTurnError(new AiError(body.code as AiError["code"], body.error, response.status), "What is the dress code?");
    expect(card.message).toBe(AI_TIMEOUT_MESSAGE);
    expect(card.retryable).toBe(true);
  });

  it("holds when MODEL_RETRY_ENABLED is off (production) and on", async () => {
    for (const flag of ["false", "true"]) {
      process.env.MODEL_RETRY_ENABLED = flag;
      client.mode = "stall-ignore-signal";
      client.calls = [];
      vi.useFakeTimers();
      const settled = callClaude(input).then(() => null, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await settled, flag).toBeInstanceOf(AiTimeLimitError);
      const options = client.calls[0]![1] as { timeout: number; maxRetries: number; signal: AbortSignal };
      expect(options.timeout).toBe(45_000);
      expect(options.maxRetries).toBe(2);
      expect(options.signal.aborted).toBe(true);
      vi.useRealTimers();
    }
  });

  it("QA's long answer: first token at 40 s, done at 60 s — it succeeds, nothing is logged", async () => {
    client.mode = "slow-long";
    vi.useFakeTimers();
    const settled = callClaude(input).then((text) => text, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await settled).toBe("A long answer answer answer answer");
    expect(errors).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an answer that begins and then goes quiet ends 30 s after its last chunk (limit=gap)", async () => {
    client.mode = "stall-midway";
    vi.useFakeTimers();
    const settled = callClaude(input).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(40_000 + 29_999);
    expect(errors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toBeInstanceOf(AiTimeLimitError);
    expect((error as AiError).message).toBe(AI_TIMEOUT_MESSAGE);
    expect(loggedLines()).toEqual([expect.stringMatching(/call=main_answer duration_ms=\d+ limit_ms=30000 limit=gap$/)]);
  });

  it("a stream that never ends is stopped at the 110 s cap, under the route's 120 s (limit=total)", async () => {
    client.mode = "endless";
    vi.useFakeTimers();
    const settled = callClaude(input).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(109_999);
    expect(errors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBeInstanceOf(AiTimeLimitError);
    expect(loggedLines()).toEqual([expect.stringMatching(/limit_ms=110000 limit=total$/)]);
  });

  it("AI_MAIN_TIMEOUT_MS sets the first-token limit", async () => {
    process.env.AI_MAIN_TIMEOUT_MS = "6000";
    client.mode = "stall-stream";
    vi.useFakeTimers();
    const settled = callClaude(input).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await settled).toBeInstanceOf(AiTimeLimitError);
    expect(loggedLines()[0]).toContain("limit_ms=6000");
  });

  it("an answer in time is returned unchanged", async () => {
    expect(await callClaude(input)).toBe("An answer.");
    expect(errors).not.toHaveBeenCalled();
  });

  it("a main-call failure is on the server log as well as the trace (status and type only)", async () => {
    client.mode = "fail";
    const settled = runInAiRoute("chat", () => callClaude(input)).then(() => null, (error: unknown) => error);
    const error = await settled;
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).message).not.toBe("");
    expect(loggedLines()).toEqual([expect.stringMatching(/^\[ai\.failure\] route=chat call=main_answer duration_ms=\d+ error=HTTP 529 overloaded_error Error$/)]);
    expect(loggedLines().join("\n")).not.toContain("dress code");
    expect(traced.at(-1)).toMatchObject({ errorSubtype: "overloaded" });
  });
});

describe("a helper call (callClaudeTool)", () => {
  it("ends at the helper limit (30 s) with the friendly message and a log line", async () => {
    client.mode = "stall-tool";
    vi.useFakeTimers();
    const settled = callClaudeTool({
      model: "m",
      system: "s",
      maxTokens: 10,
      tool: { name: "record_intent_slots", description: "d", input_schema: { type: "object" } },
      messages: [{ role: "user", content: "x" }],
    }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await settled;
    expect(error).toBeInstanceOf(AiTimeLimitError);
    expect((error as AiError).message).toBe(AI_TIMEOUT_MESSAGE);
    expect(loggedLines()).toEqual([expect.stringMatching(/^\[ai\.timeout\] route=unknown call=record_intent_slots duration_ms=\d+ limit_ms=30000$/)]);
  });
});

describe("the AI reader", () => {
  it("a stalled reader ends at its limit: the turn runs on today's readers (no empty answer) and the log says so", async () => {
    client.mode = "stall-ignore-signal";
    vi.useFakeTimers();
    const pending = runInAiRoute("chat", () =>
      readFormRequest({
        turns: [{ role: "user", content: "create a ca for quinn marlowe" }],
        context: { managerTurns: ["create a ca for quinn marlowe"], people: [], locations: [], headings: [], today: "2026-10-27" } as never,
      }),
    );
    await vi.advanceTimersByTimeAsync(3_500);
    expect(await pending).toEqual({ fallback: "timeout" });
    expect(loggedLines()).toEqual([expect.stringMatching(/^\[ai\.timeout\] route=chat call=reader duration_ms=\d+ limit_ms=3500$/)]);
    expect(loggedLines().join("\n")).not.toContain("quinn");
  });
});

describe("withAiTimeLimit", () => {
  it("a call that ignores its signal is no longer waited on", async () => {
    vi.useFakeTimers();
    const settled = withAiTimeLimit("x", 1_000, () => new Promise(() => {})).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toBeInstanceOf(AiTimeLimitError);
  });

  it("a call in time returns its value, logs nothing, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    expect(await withAiTimeLimit("x", 1_000, async () => 7)).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});

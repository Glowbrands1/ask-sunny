import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const create = vi.fn();
vi.mock("../anthropic", () => ({ getAnthropicClient: () => ({ messages: { create } }) }));

import { callClaudeToolTimed } from "../call-claude";
import { readFormRequest, READER_TIMEOUT_MS } from "./read";

/*
 * AI_READS_CODE_CHECKS_ENABLED: a stalled reader runs the turn on today's
 * readers. The limit is the SDK's own timeout (no retry), and the fallback
 * is classed "timeout" from a clock the variation report cannot freeze.
 */
const context = { managerTurns: ["create a ca for quinn marlowe"], people: [], locations: [], headings: [], today: "2026-10-27" };
const turns = [{ role: "user", content: "create a ca for quinn marlowe" }];

afterEach(() => {
  vi.useRealTimers();
  create.mockReset();
});

describe("a stalled reader", () => {
  it("asks the SDK for the reader's limit and no retry", async () => {
    create.mockResolvedValue({ content: [{ type: "tool_use", name: "t", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } });
    await callClaudeToolTimed({ model: "m", system: "s", maxTokens: 5, timeoutMs: READER_TIMEOUT_MS, tool: { name: "t", description: "d", input_schema: { type: "object" } }, messages: [{ role: "user", content: "x" }] });
    expect(create.mock.calls[0]![1]).toEqual({ timeout: READER_TIMEOUT_MS, maxRetries: 0 });
  });

  it("falls back as a timeout when the call stalls past the limit, with Date frozen as the report freezes it", async () => {
    // The report fakes only Date, so the wait is real; Date.now would read 0 ms elapsed and class this "error".
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:30:00Z"));
    create.mockImplementation((_body: unknown, options: { timeout: number }) => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), options.timeout)));
    expect(await readFormRequest({ turns, context })).toEqual({ fallback: "timeout" });
  }, 10_000);

  it("falls back as an error when the call fails at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    create.mockRejectedValue(new Error("boom"));
    expect(await readFormRequest({ turns, context })).toEqual({ fallback: "error" });
  });

  it("a model the key cannot call (401 / 404) falls back to today's readers and says why in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    create.mockRejectedValue(Object.assign(new Error("authentication_error: invalid x-api-key"), { status: 401, error: { type: "authentication_error" } }));
    expect(await readFormRequest({ turns, context })).toEqual({ fallback: "error" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ai.reader: the model call failed (HTTP 401 authentication_error)"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("x-api-key");
    warn.mockRestore();
  });
});

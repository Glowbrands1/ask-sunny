import { describe, expect, it } from "vitest";

import { priceFor, usageCostUsd } from "./model-prices";
import { readerUsageRow } from "./spend-guard-reader";

/*
 * Pau, 27 Oct 2026 (via QA): the monthly budget counted only the answering
 * call; the AI reader's call, in the trace's slots.reader, was invisible to it.
 */
const usage = { inputTokens: 3500, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("the AI reader in the monthly budget", () => {
  it("counts a reader call at its own model's price", () => {
    const row = readerUsageRow({ model: "claude-haiku-5-5", usage })!;
    expect(row.model).toBe("claude-haiku-5-5");
    // 3,500 in at $0.10 and 400 out at $0.50 per million.
    expect(usageCostUsd(row)).toBeCloseTo(0.00055, 6);
  });

  it("prices a trace with no reader model as Haiku 4.5, the dearer Haiku", () => {
    const row = readerUsageRow({ usage })!;
    expect(row.model).toBe("claude-haiku-4-5");
    expect(usageCostUsd(row)).toBeCloseTo(0.0055, 6);
  });

  it("counts nothing for a fallback, an empty usage, or no reader at all", () => {
    expect(readerUsageRow({ fallback: "timeout" } as never)).toBeNull();
    expect(readerUsageRow({ usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })).toBeNull();
    expect(readerUsageRow(null)).toBeNull();
    expect(readerUsageRow({ usage: { inputTokens: "9" } as never })).toBeNull();
  });

  it("Claude Haiku 5.5 has its own price, not the Opus fallback for an unknown model", () => {
    expect(priceFor("claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 });
    expect(priceFor("claude-haiku-4-5").input).toBe(1);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { usageCostUsd, type TokenUsage } from "./model-prices";
import { spendUsageRows } from "./spend-guard-store";

/*
 * VOICE_INPUT_ENABLED: a voice entry in `slots.spend` (`{ source: "voice", audio_seconds, usd_per_hour }`) is priced by
 * the hour of audio and never as a model; token entries are priced exactly as before.
 */

describe("voice spend", () => {
  it("an hour of audio at $0.35 an hour is $0.35, with no model and no tokens", () => {
    const [voice] = spendUsageRows([{ source: "voice", audio_seconds: 3600, usd_per_hour: 0.35 }])!;
    expect(voice).toEqual({ model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, audioSeconds: 3600, usdPerHour: 0.35 });
    expect(usageCostUsd(voice!)).toBeCloseTo(0.35, 10);
  });

  it("a voice entry is never priced as a model (an unknown model would be priced as the dearest)", () => {
    const voice: TokenUsage = { model: null, inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, audioSeconds: 60, usdPerHour: 0.35 };
    expect(usageCostUsd(voice)).toBeCloseTo((60 / 3600) * 0.35, 10);
  });

  it("a voice entry without its hourly price is counted at the budget buffer, never free", () => {
    const [voice] = spendUsageRows([{ source: "voice", audio_seconds: 3600 }])!;
    expect(usageCostUsd(voice!)).toBeCloseTo(0.35, 10);
  });

  it("token entries are unchanged", () => {
    const rows = spendUsageRows([{ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }])!;
    expect(rows).toEqual([{ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }]);
    expect(usageCostUsd(rows[0]!)).toBe(2);
    expect(usageCostUsd({ model: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(5);
  });

  it("a mixed row: the voice entry and the model calls each priced their own way", () => {
    const rows = spendUsageRows([
      { model: "claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { source: "voice", audio_seconds: 1800, usd_per_hour: 0.35 },
    ])!;
    expect(rows.reduce((sum, row) => sum + usageCostUsd(row), 0)).toBeCloseTo(0.1 + 0.175, 10);
  });
});

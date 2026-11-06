import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";
import { statesMetricShortfall } from "./metric-shortfall";

/**
 * SALES_SHORTFALL_OBJECT_ENABLED (QA, 6 Nov 2026, after the Sunny flip). The
 * real history wording "Not meeting sales requirements for the month of
 * October" got a Corrective Action with no policy, while "her sales are low"
 * cites the Standards of Conduct: "sales" was a named metric only as "sales
 * are / is". With the flag on, "sales" is named where a shortfall verb of the
 * judged list governs it, with only determiners or possessives between. The
 * person is invented.
 */
const EXACT = "I need a verbal corrective action for Odalys Fenmarrow. Not meeting sales requirements for the month of October";

function on() {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
  vi.stubEnv("SALES_SHORTFALL_OBJECT_ENABLED", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SALES_SHORTFALL_OBJECT_ENABLED", () => {
  it("off (main): the exact wording names no shortfall, so the CA reads no policy (the bug)", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    expect(statesMetricShortfall(EXACT)).toBe(false);
    expect(readCaPolicy(EXACT).suggestion).toBeNull();
  });

  it("on: the exact wording is a sales shortfall, read as the Standards of Conduct", () => {
    on();
    expect(statesMetricShortfall(EXACT)).toBe(true);
    expect(readCaPolicy(EXACT)).toMatchObject({ suggestion: "standards_of_conduct", source: "sales_performance" });
  });

  it.each([
    "Not meeting sales requirements for the month of October",
    "she is not meeting her sales goals",
    "missing the store's sales targets again",
    "not hitting his sales numbers",
    "below sales expectations this month",
  ])("on: %s is a sales shortfall", (text) => {
    on();
    expect(statesMetricShortfall(text)).toBe(true);
  });

  it.each([
    "she was missing from the sales floor for an hour",
    "she was not on the sales floor",
    "he left his phone below the sales counter",
    "she was missing on the sales floor during the rush",
    "the sales floor was busy",
  ])("on, negative: %s names no sales shortfall", (text) => {
    on();
    expect(statesMetricShortfall(text)).toBe(false);
  });

  it("on: \"her sales are low\" is read as before", () => {
    on();
    expect(statesMetricShortfall("her sales are low")).toBe(true);
  });
});

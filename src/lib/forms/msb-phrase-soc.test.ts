import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";

/**
 * MSB_PHRASE_SOC_ENABLED (Pau via QA, 7 Nov 2026). "create a ca for must see behaviors for <name>" cited no
 * policy, while "create a ca for MSB for <name>" cited the Standards of Conduct (CA_SALES_POLICY_ENABLED, live).
 */
const SPELLED = "create a ca for must see behaviors for Wrenna Calloway";

const reading = (text: string) => {
  const r = readCaPolicy(text);
  return { suggestion: r.suggestion, source: r.source };
};

describe("MSB_PHRASE_SOC_ENABLED", () => {
  beforeEach(() => vi.stubEnv("CA_SALES_POLICY_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("off: the spelled-out phrase reads as no policy (the reported failure)", () => {
    expect(reading(SPELLED)).toEqual({ suggestion: null, source: null });
  });

  it.each([SPELLED, "create a ca for must-see behaviors for Wrenna Calloway", "Wrenna's Must See Behavior was not followed, write her up"])(
    'on: "%s" is the Standards of Conduct, as MSB',
    (text) => {
      vi.stubEnv("MSB_PHRASE_SOC_ENABLED", "true");
      expect(reading(text)).toEqual({ suggestion: "standards_of_conduct", source: "msb" });
    },
  );

  it("on: the card line names the Standards of Conduct and never says \"as you said\"", () => {
    vi.stubEnv("MSB_PHRASE_SOC_ENABLED", "true");
    const line = caPolicyProposalLine(readCaPolicy(SPELLED)) ?? "";
    expect(line).toMatch(/Standards of Conduct/);
    expect(line).not.toMatch(/as you said/i);
  });

  it.each(["create a ca for MSB for Wrenna Calloway", "create a ca for Wrenna Calloway, she must see the manager first", "create a ca for Wrenna Calloway for being late"])(
    '"%s" reads the same on and off',
    (text) => {
      const off = reading(text);
      vi.stubEnv("MSB_PHRASE_SOC_ENABLED", "true");
      expect(reading(text)).toEqual(off);
    },
  );

  it("on, without CA_SALES_POLICY_ENABLED: nothing changes", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "false");
    vi.stubEnv("MSB_PHRASE_SOC_ENABLED", "true");
    expect(reading(SPELLED)).toEqual({ suggestion: null, source: null });
  });
});

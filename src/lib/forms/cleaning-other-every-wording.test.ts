import { afterEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, cleaningUndonePhrase, readCaPolicy } from "./ca-policy";

/* CLEANING_OTHER_EVERY_WORDING_ENABLED (QA, 6 Nov 2026; the person invented). */
const GERUND = "create a verbal ca for Ansgar Whitlowe for not completing his daily cleaning duties on 11-2-26";
const CLOSING = "CA for Ansgar Whitlowe for not completing closing cleaning tasks";

afterEach(() => vi.unstubAllEnvs());

describe("CLEANING_OTHER_EVERY_WORDING_ENABLED", () => {
  it("off: \"not completing … cleaning\" is not read, and the card names no policy", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    expect(cleaningUndonePhrase(GERUND)).toBeNull();
    expect(caPolicyProposalLine(readCaPolicy(GERUND))).toBeNull();
  });

  it("on: read, and Other", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CLEANING_OTHER_EVERY_WORDING_ENABLED", "true");
    expect(cleaningUndonePhrase(GERUND)).toBe("not completing his daily cleaning");
    for (const said of [GERUND, CLOSING, "write a CA for Ansgar Whitlowe, he did not clean the beds after each session"]) {
      expect(readCaPolicy(said).other, said).toBe("cleaning");
      expect(caPolicyProposalLine(readCaPolicy(said)), said).toMatch(/^\*\*Policy:\*\* Other\b/);
    }
  });

  it("on: a denial or another policy is not Other", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CLEANING_OTHER_EVERY_WORDING_ENABLED", "true");
    expect(cleaningUndonePhrase("this is not about completing the cleaning, she was late")).toBeNull();
    expect(readCaPolicy(`${GERUND}. use the attendance policy`).other).toBeUndefined();
    expect(readCaPolicy("CA for Ansgar Whitlowe for not completing his woven training").other).toBeUndefined();
  });

  it("on, CA_SALES off: unchanged (the draft's Other rule is CA_SALES's)", () => {
    vi.stubEnv("CLEANING_OTHER_EVERY_WORDING_ENABLED", "true");
    expect(readCaPolicy(GERUND).other).toBeUndefined();
  });
});

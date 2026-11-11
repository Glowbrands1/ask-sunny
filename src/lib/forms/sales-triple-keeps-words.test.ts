import { afterEach, describe, expect, it, vi } from "vitest";

import { observationAccount, readCaPolicy } from "./ca-policy";

/**
 * QA's Sunny round-4 gate (8 Nov 2026) dropped the sales triple. With SALES_SHORTFALL_OBJECT, SALES_OBSERVATION_ACCOUNT
 * and CA_PERFORMANCE_REASON on together:
 * (a) the reason was cut wherever it stood in the Observation ("This is for Under Performance on PPTA, …" → "This is on
 *     PPTA, …");
 * (b) so was a payroll answer ("which will be payroll deducted from <name>'s check" → "which will be from …");
 * (c) "… for her performance review" and "… for a performance improvement plan" read as sales performance.
 * Only the request clause may be cut. The production wording, the people invented.
 */
function triple() {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
  vi.stubEnv("SALES_SHORTFALL_OBJECT_ENABLED", "true");
  vi.stubEnv("SALES_OBSERVATION_ACCOUNT_ENABLED", "true");
  vi.stubEnv("CA_PERFORMANCE_REASON_ENABLED", "true");
}

afterEach(() => vi.unstubAllEnvs());

describe("the sales triple keeps the manager's words", () => {
  it.each([
    "This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.",
    "I need a CA for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.".replace(/^I need a CA for /, ""),
    "which will be payroll deducted from Marnie's check.",
    "payroll deduct applies and $3.25 will be deducted from check.",
    "on 11-1-26 the register was off $20 which will be payroll deducted from Marnie's check",
  ])("(a, b) %j is kept whole", (sentence) => {
    triple();
    expect(observationAccount(sentence, "Remy Calder")).toBe(sentence.replace(/[\s,;:-]+$/, ""));
  });

  it.each([
    ["Remy Calder on performance", ""],
    ["performance for october not pay roll deductable", ""],
    ["can you write me a Ca for remy calder for performance for october", ""],
    ["can you write me a Ca for remy calder on performance, she missed PPTA and Spa %", "she missed PPTA and Spa %"],
  ])("only the request clause is cut: %j → %j", (sentence, account) => {
    triple();
    expect(observationAccount(sentence, "Remy Calder")).toBe(account);
  });

  it.each(["CA for Odalys Fenmarrow for her performance review", "CA for Odalys Fenmarrow for a performance improvement plan"])(
    "(c) %j is not sales performance with CA_PERFORMANCE_REASON on",
    (text) => {
      triple();
      expect(readCaPolicy(text).source).not.toBe("sales_performance");
    },
  );

  it("(c) the request CA_PERFORMANCE_REASON was for still is", () => {
    triple();
    expect(readCaPolicy("can you write me a Ca for Odalys Fenmarrow for performance for october")).toMatchObject({ source: "sales_performance" });
  });
});

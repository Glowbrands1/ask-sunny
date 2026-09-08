import { describe, expect, it } from "vitest";

import { isReportingQuestion, REPORTING_QUESTION_TERMS } from "./question-gate";

/**
 * THE GATE'S TWO FAILURE MODES ARE NOT SYMMETRIC, so the tests are not either.
 *
 * A false negative is the bug that matters — Sunny saying the knowledge base
 * does not cover a figure that is loaded — so the questions below are the ones
 * a manager would actually type, in their own words, and every one must open
 * the gate. The negative cases are only the ones where the cost of a false
 * positive is real: the ordinary policy and coaching questions that make up
 * most of the product's traffic.
 */
describe("isReportingQuestion", () => {
  const OPENS = [
    "Which salons have the lowest spa conversion?",
    "which salons have the lowest spa conversion",
    "How are our beds performing against the chain?",
    "Are we outperforming the chain on per bed usage?",
    "What was our total tans last month?",
    "Which equipment is underperforming its peers?",
    "How many spa sessions did Kansas City Liberty do?",
    "Is our Hydromassage getting competitive usage?",
    "Where should the next spa equipment dollar go?",
    "Show me tans per bed by level",
    "What is our spa conversion rate?",
    "How many unique tanners did we have?",
    "Which store has the best spa engagement?",
    "Did the FASTEST units absorb the demand?",
    "How does our sunless usage compare?",
    "Which salons are ranked highest?",
    "Do we have the traffic to justify another unit?",
    "Is this a capital expansion opportunity?",
    "Which of my beds is underutilized?",
    "how much wellness usage are we getting",
  ];

  for (const question of OPENS) {
    it(`opens for: ${question}`, () => {
      expect(isReportingQuestion(question)).toBe(true);
    });
  }

  const STAYS_CLOSED = [
    "How do I write up an employee for being late?",
    "What is the dress code?",
    "Can I approve time off for next week?",
    "How do I handle an angry customer?",
    "What does the handbook say about breaks?",
    "Draft a coaching conversation about attitude",
    "Who do I call when the POS is down?",
    "What is the refund policy on memberships?",
  ];

  for (const question of STAYS_CLOSED) {
    it(`stays closed for: ${question}`, () => {
      expect(isReportingQuestion(question)).toBe(false);
    });
  }

  it("does not open on the word salon, store or location", () => {
    // The judgement recorded in the module: these are in nearly every question
    // a manager asks, so gating on them is the same as no gate at all.
    expect(isReportingQuestion("Who covers my salon when I am out?")).toBe(false);
    expect(isReportingQuestion("Can I close the store early?")).toBe(false);
    expect(isReportingQuestion("Is this location on the new schedule?")).toBe(false);
    expect(REPORTING_QUESTION_TERMS).not.toContain("salon");
    expect(REPORTING_QUESTION_TERMS).not.toContain("store");
    expect(REPORTING_QUESTION_TERMS).not.toContain("location");
  });

  it("matches on word boundaries, so a term inside a longer word does not fire", () => {
    expect(isReportingQuestion("What are the constants in this formula?")).toBe(false);
    expect(isReportingQuestion("Do we have a spare key?")).toBe(false);
    expect(isReportingQuestion("Is the franchise expanding?")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isReportingQuestion("SPA CONVERSION")).toBe(true);
    expect(isReportingQuestion("Spa Conversion")).toBe(true);
  });

  it("reads the question only, never the history", () => {
    // The signature makes this structural rather than a convention: there is
    // no parameter a previous turn could arrive through.
    expect(isReportingQuestion.length).toBe(1);
  });

  it("holds no term that could match everything", () => {
    // A regex metacharacter added to the list unescaped would silently turn the
    // gate always-true, which is the one way this file could fail invisibly.
    for (const term of REPORTING_QUESTION_TERMS) {
      expect(term).toMatch(/^[a-z ]+$/);
      expect(term.length).toBeGreaterThan(2);
    }
    expect(isReportingQuestion("")).toBe(false);
    expect(isReportingQuestion("hello")).toBe(false);
  });
});

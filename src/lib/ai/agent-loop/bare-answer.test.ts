import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { oneWord } = await import("./tools");
const { cardTurns } = await import("./card-record");

/*
 * Fix batch item 7 (QA's targeted re-run, c163, 16 Nov 2026): a one-word message is a format fact (how many words), never
 * a reading of which word. The propose_form side is the replay case nov16-fix-batch-bare-yes-payroll-cases.ts.
 */
describe("oneWord", () => {
  it("is true for one word, with punctuation or spaces around it", () => {
    for (const said of ["yes", "Yes.", "  no!  ", "yes 👍", "ok"]) expect(oneWord(said), said).toBe(true);
  });
  it("is false for an answer that says more", () => {
    for (const said of ["yes payroll deduct", "verbal, no payroll", "yes they do", "", "!!"]) expect(oneWord(said), said).toBe(false);
  });
});

describe("the card record keeps what the card asked", () => {
  it("cardTurns hands back the record's asked fields with the reply that showed the card", () => {
    const history = [
      { id: "m1", role: "user" as const, content: "ca for remy calder, late on 11/12", timestamp: new Date() },
      { id: "a1", role: "assistant" as const, content: "Here's the card.", timestamp: new Date() },
    ];
    const record = { proposalId: "p1", employeeKey: "k", nameKey: "n", templateKey: "dpoa", templateName: null, messageId: "m1", asked: ["payroll_deduct", "warning_level"] };
    expect(cardTurns(history as never, [record]).get(1)?.asked).toEqual(["payroll_deduct", "warning_level"]);
  });
});

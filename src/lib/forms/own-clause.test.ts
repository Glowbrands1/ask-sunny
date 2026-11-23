import { describe, expect, it } from "vitest";

import { ownClauseHolding } from "./own-clause";

/** QA's live L6 (22 Nov 2026), invented name for the tester's "Test Testy". */
const L6 = "exit form for Rowan Kestrel, terminated for job abandonment, not eligible for rehire";

describe("ownClauseHolding (L6)", () => {
  it("L6: \"job abandonment\" is the manager's \"terminated for job abandonment\"", () => {
    expect(ownClauseHolding("job abandonment", L6)).toBe("terminated for job abandonment");
    expect(ownClauseHolding("Job abandonment.", L6)).toBe("terminated for job abandonment.");
  });
  it("the model's account that is already a whole clause, or in no clause, is kept", () => {
    expect(ownClauseHolding("terminated for job abandonment", L6)).toBeNull();
    expect(ownClauseHolding("left without notice", L6)).toBeNull();
  });
  it("an account of several clauses is kept", () => {
    expect(ownClauseHolding("Terminated for job abandonment; not eligible for rehire.", L6)).toBeNull();
  });
  it("part of a word is not the clause", () => {
    expect(ownClauseHolding("abandon", L6)).toBeNull();
  });
  it("words in two different clauses: kept as the model wrote it", () => {
    expect(ownClauseHolding("late", "she was late on 11/20, late again on 11/21")).toBeNull();
  });
});

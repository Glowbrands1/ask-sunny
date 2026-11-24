import { describe, expect, it } from "vitest";

import { reasonFromQuote } from "./exit-reason-said";

/* Port of Ask Bubbles #1047 (its QA's live round 3, 22 Nov 2026, B6): T6 "she is resigning due to second job I'm ready for the draft". */
describe("reasonFromQuote (B6)", () => {
  it("keeps the reason when every word of it is in the manager's quote", () => {
    expect(reasonFromQuote("second job", "she is resigning due to second job")).toBe("Second job.");
    expect(reasonFromQuote("Found a better paying job elsewhere.", "she found a better paying job elsewhere")).toBe("Found a better paying job elsewhere.");
  });

  it("refuses a reason with a word the manager never said", () => {
    expect(reasonFromQuote("Better pay at a second job", "she is resigning due to second job")).toBeNull();
    expect(reasonFromQuote("Higher pay", "she found a better paying job elsewhere")).toBeNull();
  });

  it("refuses an empty reason or quote", () => {
    expect(reasonFromQuote("", "she is resigning due to second job")).toBeNull();
    expect(reasonFromQuote("second job", "  ")).toBeNull();
    expect(reasonFromQuote("to a", "she is moving to a new city")).toBeNull();
  });
});

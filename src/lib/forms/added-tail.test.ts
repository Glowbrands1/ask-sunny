import { describe, expect, it } from "vitest";

import { addedTail } from "./added-tail";

const OLD = "Observed:\nMarnie Holloway was late on 11/5/26.\n\nExpectation:\nMarnie is expected to arrive on time.";

describe("addedTail (ADD_NOT_REPEATED, QA's live round 15 in Ask Bubbles)", () => {
  it("the field's text run onto one line, then the new sentence: only the new sentence", () => {
    expect(addedTail(OLD, "Observed: Marnie Holloway was late on 11/5/26. Expectation: Marnie is expected to arrive on time. Marnie was reminded of the policy.")).toBe(
      "Marnie was reminded of the policy.",
    );
  });
  it("the field's text as it is, then the new sentence", () => {
    expect(addedTail(OLD, `${OLD}\nMarnie was reminded of the policy.`)).toBe("Marnie was reminded of the policy.");
  });
  it("a new sentence alone is not a repeat", () => {
    expect(addedTail(OLD, "Marnie was reminded of the policy.")).toBeNull();
  });
  it("the field's text changed on the way is not a repeat", () => {
    expect(addedTail(OLD, "Observed: Marnie Holloway was late on 11/6/26. Expectation: on time. Reminded.")).toBeNull();
  });
  it("the field's text alone adds nothing", () => {
    expect(addedTail(OLD, OLD.replace(/\n/g, " "))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { asksForSameForm, requestTurn } from "./same-form-copy";

/** QA, 30–31 Oct 2026: the manager's own wording, and the review's. Names are invented. */
describe("asksForSameForm", () => {
  it.each([
    "Do the same coaching form for remy calder",
    "can you create the same draft that we did with marnie holloway by changing the name and position?",
    "copy Marnie's form for remy calder",
    "make the same form as the one for Marnie",
  ])("asks for a copy: %s", (said) => {
    expect(asksForSameForm(said)).toBe(true);
  });

  it.each([
    "create a coaching form for remy calder",
    "ok, create the draft, but include the details of rolling rack.",
    "is this the same policy as last year?",
    // Independent review, 31 Oct 2026: ordinary accounts that the first reading took for a copy.
    "She was late again today, same thing as last week",
    "Add that she did the same thing as Remy Calder last week",
    "same details as before, she left the register open",
    // A copy request that also gives this person's own account is the manager's account, not a copy.
    "Do the same coaching form for Remy, he was late again today",
    // Changed on purpose (review, 31 Oct): no "form"/"draft" said, so not a copy request any more.
    "do the same for remy",
  ])("does not: %s", (said) => {
    expect(asksForSameForm(said)).toBe(false);
  });
});

describe("requestTurn", () => {
  it("the card's own request is the last turn of the notes", () => {
    expect(requestTurn("Do the same coaching form for remy calder\n\ncreate a coaching form for remy calder")).toBe(
      "create a coaching form for remy calder",
    );
  });
});

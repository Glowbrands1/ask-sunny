import { describe, expect, it } from "vitest";

import { asksForWholeStaff } from "./staff-picker";

/** Ported from Ask Bubbles (QA, 30–31 Oct 2026): the managers' own wording, and the independent review's. */
describe("asksForWholeStaff", () => {
  it.each(["can you create a coaching form for my whole staff?", "a coaching form for all associates", "I need a coaching form for everyone"])(
    "a form for the whole staff: %s",
    (said) => expect(asksForWholeStaff(said)).toBe(true),
  );

  it.each(["for whole staff - associates", "the whole team", "everyone"])("answering \"Who is this form for?\": %s", (said) => {
    expect(asksForWholeStaff(said, true)).toBe(true);
  });

  it.each([
    "create a coaching form for Remy Calder",
    "my staff keeps leaving early",
    // Independent review, 31 Oct 2026: the whole store / team is in the account, not who the form is for.
    "Coaching form for Jordan, he yelled at customers in front of the whole salon",
    "update the draft: he told the whole team he was quitting",
    "write-up for Jordan for yelling at everyone",
  ])("not: %s", (said) => {
    expect(asksForWholeStaff(said)).toBe(false);
    expect(asksForWholeStaff(said, true)).toBe(false);
  });
});

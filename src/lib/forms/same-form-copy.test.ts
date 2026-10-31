import { describe, expect, it } from "vitest";

import { asksForSameForm } from "./same-form-copy";

/** QA, 30 Oct 2026: the manager's own wording. Names are invented. */
describe("asksForSameForm", () => {
  it.each([
    "Do the same coaching form for remy calder",
    "can you create the same draft that we did with marnie holloway by changing the name and position?",
    "do the same for remy",
    "copy that form for remy calder",
  ])("asks for a copy: %s", (said) => {
    expect(asksForSameForm(said)).toBe(true);
  });

  it.each([
    "create a coaching form for remy calder",
    "ok, create the draft, but include the details of rolling rack.",
    "is this the same policy as last year?",
  ])("does not: %s", (said) => {
    expect(asksForSameForm(said)).toBe(false);
  });
});

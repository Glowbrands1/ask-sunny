import { describe, expect, it } from "vitest";

import { asksForWholeStaff } from "./staff-picker";

/** Ported from Ask Bubbles (QA, 30 Oct 2026): the managers' own wording. */
describe("asksForWholeStaff", () => {
  it.each(["for whole staff - associates", "can you create a coaching form for my whole staff?", "a coaching form for all associates", "everyone on the team"])(
    "whole staff: %s",
    (said) => expect(asksForWholeStaff(said)).toBe(true),
  );
  it.each(["create a coaching form for Remy Calder", "my staff keeps leaving early", "the team did well today"])("not: %s", (said) =>
    expect(asksForWholeStaff(said)).toBe(false),
  );
});

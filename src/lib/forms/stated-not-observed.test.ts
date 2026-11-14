import { describe, expect, it } from "vitest";

import { withoutUnstatedObservation } from "./evidence-basis";

/* REPORTED_NOT_OBSERVED (QA's Bubbles Create check, ported, 14 Nov 2026); the person is invented. */
describe("withoutUnstatedObservation", () => {
  const notes = "Marnie Holloway was late on 11/3/26\nshe yelled at a guest and she maybe forgot";

  it("the live draft: \"was also observed yelling\" → \"was also yelling\"", () => {
    expect(withoutUnstatedObservation("Observed:\nMarnie Holloway was late to work on November 3, 2026. Marnie Holloway was also observed yelling at a guest.", notes)).toBe(
      "Observed:\nMarnie Holloway was late to work on November 3, 2026. Marnie Holloway was also yelling at a guest.",
    );
  });

  it("\"It was observed that …\" and \"was seen to be …\"", () => {
    expect(withoutUnstatedObservation("It was observed that Marnie Holloway left the register open.", notes)).toBe("Marnie Holloway left the register open.");
    expect(withoutUnstatedObservation("Marnie Holloway was seen to be on her phone.", notes)).toBe("Marnie Holloway was on her phone.");
    expect(withoutUnstatedObservation("Marnie Holloway was witnessed arguing with a coworker.", notes)).toBe("Marnie Holloway was arguing with a coworker.");
  });

  it("keeps what the manager saw herself", () => {
    expect(withoutUnstatedObservation("Marnie Holloway was observed yelling at a guest.", "I saw her yelling at a guest")).toBe("Marnie Holloway was observed yelling at a guest.");
  });

  it("leaves the section label and other wording alone", () => {
    expect(withoutUnstatedObservation("Observed:\nMarnie Holloway yelled at a guest.", notes)).toBe("Observed:\nMarnie Holloway yelled at a guest.");
    expect(withoutUnstatedObservation("A guest reported that Marnie Holloway yelled.", notes)).toBe("A guest reported that Marnie Holloway yelled.");
  });
});

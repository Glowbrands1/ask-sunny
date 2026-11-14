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

/*
 * QA's rulings on the sibling app's Gate-Bubbles-5 #911 probes (14 Nov 2026), in its wordings with this app's words
 * (guest) and an invented person: the manager's request, what the draft model wrote, what is saved.
 */
describe("withoutUnstatedObservation: the #911 probes, ported", () => {
  const P = "Pia Wexcombe";
  it.each([
    ["manager-said-observed", `create a CA for ${P}, she was observed sleeping in the back room on 11/3/26`, `Observed:\n${P} was observed sleeping in the back room on November 3, 2026.`, `Observed:\n${P} was observed sleeping in the back room on November 3, 2026.`],
    ["seen-word", `create a CA for ${P}, she was on her phone on 11/3/26`, `Observed:\n${P} was seen on her phone on November 3, 2026.`, `Observed:\n${P} was on her phone on November 3, 2026.`],
    ["witnessed-word", `create a CA for ${P}, she yelled at a guest on 11/3/26`, `Observed:\n${P} was witnessed yelling at a guest on November 3, 2026.`, `Observed:\n${P} was yelling at a guest on November 3, 2026.`],
    ["two-sentences-mixed", `create a CA for ${P}, I saw her yelling at a guest on 11/3/26 and she was also late`, `Observed:\n${P} was observed yelling at a guest on November 3, 2026. ${P} was also observed arriving late.`, `Observed:\n${P} was observed yelling at a guest on November 3, 2026. ${P} was also arriving late.`],
    ["stated-plain", `create a CA for ${P}, she yelled at a guest on 11/3/26`, `Observed:\n${P} was observed yelling at a guest on November 3, 2026.`, `Observed:\n${P} was yelling at a guest on November 3, 2026.`],
    ["first-hand-i-saw", `create a CA for ${P}, I saw her yelling at a guest on 11/3/26`, `Observed:\n${P} was observed yelling at a guest on November 3, 2026.`, `Observed:\n${P} was observed yelling at a guest on November 3, 2026.`],
    ["first-hand-i-witnessed", `create a CA for ${P}, I witnessed her on her phone the whole shift on 11/3/26`, `Observed:\n${P} was observed on the phone the whole shift on November 3, 2026.`, `Observed:\n${P} was observed on the phone the whole shift on November 3, 2026.`],
    ["camera", `create a CA for ${P}, the camera showed her taking cash from the drawer on 11/3/26`, `Observed:\n${P} was observed on camera taking cash from the drawer on November 3, 2026.`, `Observed:\n${P} was observed on camera taking cash from the drawer on November 3, 2026.`],
    ["observed-heading-only", `create a CA for ${P}, she was late on 11/3/26`, `Observed:\n${P} arrived late on November 3, 2026.`, `Observed:\n${P} arrived late on November 3, 2026.`],
  ])("%s", (_key, said, written, saved) => {
    expect(withoutUnstatedObservation(written, said)).toBe(saved);
  });

  it("\"seen by\" names who saw it and stays", () => {
    expect(withoutUnstatedObservation(`${P} was seen by a guest leaving early.`, "she left early")).toBe(`${P} was seen by a guest leaving early.`);
  });
});


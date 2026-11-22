import { describe, expect, it } from "vitest";

import { exitDetailLines, exitReadBack, exitReadBackMismatch, withoutUnsavedExitLines } from "./exit-read-back";

/* U22 (port of Ask Bubbles #1034, its QA's round 2, 22 Nov 2026): an exit reply reads back only the lines Create saves. */
describe("exit read-back", () => {
  const readBack = exitReadBack({ dateLines: [], account: "Perpetua messaged back that she was quitting effective immediately.", termination: false });

  it("flags a stated date nobody gave and the account under another field's label", () => {
    const reply = "**Date that notice was given:** 11/14/2026\n\n**Reason for Resignation:** Perpetua messaged back that she was quitting effective immediately.";
    expect(exitReadBackMismatch(reply, readBack)).toHaveLength(2);
    expect(withoutUnsavedExitLines(reply, readBack)).toBe("");
  });

  it("keeps the saved lines, and a date line that states no date", () => {
    const reply = "**Additional Details:** Perpetua messaged back that she was quitting effective immediately.\n\n**Last Day Worked:** not set — you said TBD.";
    expect(exitReadBackMismatch(reply, readBack)).toEqual([]);
  });

  it("on a termination the account is the Reason for Resignation", () => {
    const termination = exitReadBack({ dateLines: ["**Last Day Worked:** November 20, 2026"], account: "No call no show three times.", termination: true });
    expect(exitReadBackMismatch("**Reason for Resignation:** No call no show three times.\n**Last Day Worked:** November 20, 2026", termination)).toEqual([]);
  });
});

/* B6 (port of Ask Bubbles #1036, its QA's live re-run 2, 22 Nov 2026). */
describe("exit read-back: the Details reader's lines, and a turn with no card", () => {
  it("lists the reader's reason and rehire answer under the form's own labels; payroll is left to the card's own check", () => {
    const lines = exitDetailLines({ values: { resignation_reason: "Second job." }, checked: { eligible_for_rehire: ["yes"], payroll_deduction_applicable: ["no"] } }, false);
    expect(lines).toEqual(["**Reason for Resignation:** Second job.", "**Is this employee eligible for rehire?** Yes"]);
  });

  it("reads a rehire answer said as the Details line, with more words, as the saved one", () => {
    const readBack = exitReadBack({ dateLines: [], account: null, termination: false, detailLines: ["**Is this employee eligible for rehire?** Yes"] });
    expect(exitReadBackMismatch("- **Eligible for Rehire:** Yes, as you said.", readBack)).toEqual([]);
    expect(exitReadBackMismatch("- **Eligible for Rehire:** No", readBack)).toHaveLength(1);
  });

  it("with no card this turn, a label anywhere in the line is checked, and the card's date lines are not", () => {
    const reply = "Noted the reason — **Reason for Resignation:** Second job.\n\n- **Last Day Worked:** November 23, 2026\n\nPress **Create draft** when it looks right.";
    expect(exitReadBackMismatch(reply, [], true)).toEqual(['exit field "Reason for Resignation" (Second job.)']);
    expect(withoutUnsavedExitLines(reply, [], true)).toBe("- **Last Day Worked:** November 23, 2026\n\nPress **Create draft** when it looks right.");
  });
});

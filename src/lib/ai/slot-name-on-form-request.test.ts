import { describe, expect, it } from "vitest";

import { withSlotEmployeeLine } from "./intent-slots";

/**
 * SLOT_NAME_ON_FORM_REQUEST_ENABLED — QA live check, 3 Nov 2026 (16:27 UTC).
 * The tester's exact wording; the person is invented.
 */
const QA = "Corrective action for the primary salon manager: on Monday 10/05/2026 corin bellweather was working a shift at the front desk and was rude to a guest";

describe("the slot reading's name goes in front of a form request the code reads nobody in", () => {
  it("QA's words: the lower-case name the slot reading holds is put in front, capitalised", () => {
    expect(withSlotEmployeeLine(QA, "corin bellweather")).toBe(`The employee is Corin Bellweather.\n${QA}`);
  });

  it("the name typed capitalised is read by the code already: nothing added", () => {
    const typed = QA.replace("corin bellweather", "Corin Bellweather");
    expect(withSlotEmployeeLine(typed, "Corin Bellweather")).toBe(typed);
  });

  it("a name the manager did not type in this turn: nothing added", () => {
    expect(withSlotEmployeeLine(QA, "rowan kestrel")).toBe(QA);
  });

  it("the role the turn opens with is not a name: nothing added", () => {
    expect(withSlotEmployeeLine(QA, "primary salon manager")).toBe(QA);
  });

  it("no slot name: nothing added", () => {
    expect(withSlotEmployeeLine(QA, null)).toBe(QA);
  });
});

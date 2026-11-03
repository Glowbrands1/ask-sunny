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

  /*
   * QA live check, 17:50 UTC: on a Corrective Action turn the slot model named nobody, and the AI reader quoted
   * the name (off the roster). The line goes in front of the question the turn sends ("The form is the …").
   */
  it("QA's 17:50 words: the line goes in front of the form turn's question", () => {
    const turn = "Corrective action: corin bellweather was rude to a guest at the front desk on Monday";
    const base = `The form is the Corrective Action Form.\n${turn}`;
    expect(withSlotEmployeeLine(turn, "corin bellweather", base)).toBe(`The employee is Corin Bellweather.\n${base}`);
    expect(withSlotEmployeeLine(turn, null, base)).toBe(base);
  });
});

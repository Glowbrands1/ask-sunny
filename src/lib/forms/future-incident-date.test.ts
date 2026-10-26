import { afterEach, describe, expect, it } from "vitest";

import { decideFormDate, FUTURE_DATE_TAG } from "./incident-dates";

/**
 * QA, 26 Oct 2026 (U4, the sibling tester; invented names): a written CA for
 * "not attending the monthly meeting on 12-20-26", written on 10/25, was
 * accepted in the full wording and challenged only in the terse typo version.
 * FUTURE_INCIDENT_DATE_ASK_ENABLED asks once, in every register.
 */
const TODAY = "2026-10-25";
const FLAG = "FUTURE_INCIDENT_DATE_ASK_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

function decide(text: string, history: { role: string; content: string }[] = []) {
  return decideFormDate({ text, templateKey: "dpoa", history, conversation: [{ role: "user", content: text }], today: TODAY });
}

const SENTENCE = "write up ava pellmore, written warning, for not attending the monthly meeting on 12-20-26";
const REGISTERS: [string, string][] = [
  ["all lowercase", SENTENCE],
  ["sentence case", "Write up Ava Pellmore, written warning, for not attending the monthly meeting on 12-20-26"],
  [
    "full and polite",
    "Hi, could you please create a written corrective action for Ava Pellmore for not attending the monthly meeting on 12-20-26? Thank you.",
  ],
  ["terse typo", "writen ca ava pellmore not atending monthly meeting 12-20-26"],
];

describe.each(REGISTERS)("FUTURE_INCIDENT_DATE_ASK_ENABLED (%s)", (_register, text) => {
  it("off: the future date is dropped silently, as before", () => {
    expect(decide(text).question ?? "").not.toContain(FUTURE_DATE_TAG);
  });

  it("on: the future date is asked about, and the form is not dated by it", () => {
    process.env[FLAG] = "true";
    const decided = decide(text);
    expect(decided.question).toContain("12/20/2026");
    expect(decided.question).toContain(FUTURE_DATE_TAG);
    expect(decided.formDate).toBeNull();
  });

  it("on: asked once — the next turn is not asked again", () => {
    process.env[FLAG] = "true";
    const asked = decide(text).question!;
    const next = decide(`${text}\n\nit was 10/20`, [{ role: "assistant", content: asked }]);
    expect(next.question ?? "").not.toContain(FUTURE_DATE_TAG);
  });
});

describe("FUTURE_INCIDENT_DATE_ASK_ENABLED: NEVER-BREAK", () => {
  for (const on of [false, true]) {
    it(`flag ${on ? "on" : "off"}: a future deadline or follow-up is not challenged; a past date dates the form as before`, () => {
      if (on) process.env[FLAG] = "true";
      expect(decide("write up ava pellmore, she has to finish the training by 12-20-26").question ?? "").not.toContain(
        FUTURE_DATE_TAG,
      );
      expect(decide("write up ava pellmore, late on 10-20-26, follow up on 11-15-26").question ?? "").not.toContain(
        FUTURE_DATE_TAG,
      );
      expect(decide("Write up Ava Pellmore, she was late on 10/5/26 and 10/15/26").question).toContain("Which date goes on the form?");
      expect(decide("write up ava pellmore, she was late on 10-20-26")).toEqual({});
    });
  }
});

describe("FUTURE_INCIDENT_DATE_ASK_ENABLED: a date given to the form itself", () => {
  for (const on of [false, true]) {
    it(`flag ${on ? "on" : "off"}: "dated 10/2" dates the form and is not challenged`, () => {
      if (on) process.env[FLAG] = "true";
      const decided = decideFormDate({
        text: "coaching form for ava pellmore dated 10/2",
        templateKey: "coaching",
        history: [],
        conversation: [],
        today: "2026-09-25",
      });
      expect(decided).toEqual({ formDate: "2026-10-02" });
    });
  }
});

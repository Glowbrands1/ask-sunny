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
    delete process.env[FLAG];
    // Main decides nothing here: no question, no date (the card keeps the reader's date).
    expect(decide(text)).toEqual({});
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
      else delete process.env[FLAG];
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
      else delete process.env[FLAG];
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

/* QA-4 / coordinator, 26 Oct 2026: asked only when no past incident date was stated. Lowercase and sentence case. */
const TWO_CLAUSE: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  ["sentence case", (text) => {
    const named = text.toLowerCase().split("ava pellmore").join("Ava Pellmore");
    return named.charAt(0).toUpperCase() + named.slice(1);
  }],
];

describe.each(TWO_CLAUSE)("FUTURE_INCIDENT_DATE_ASK_ENABLED, a past incident and a future date (%s)", (_register, as) => {
  it("on: the past incident dates the form and nothing is asked", () => {
    process.env[FLAG] = "true";
    for (const text of [
      "write up ava pellmore, late on 10-20-26, meeting is on 12-20-26",
      "write up ava pellmore, meeting on 12-20-26 and late on 10-20-26",
    ]) {
      const decided = decide(as(text));
      expect(decided.question ?? "", text).not.toContain(FUTURE_DATE_TAG);
      expect(decided.formDate, text).toBe("2026-10-20");
    }
  });

  /*
   * PINNED (QA-4): a negated future date is asked about all the same. A
   * form records something that happened; the manager answers with the date.
   */
  it("on: a negated future date is still asked about", () => {
    process.env[FLAG] = "true";
    for (const text of [
      "write up ava pellmore, the meeting was not on 12-20-26",
      "write up ava pellmore, she did not come to the meeting on 12-20-26",
      "write up ava pellmore, she was not late on 12-20-26",
    ]) {
      expect(decide(as(text)).question ?? "", text).toContain(FUTURE_DATE_TAG);
    }
  });
});

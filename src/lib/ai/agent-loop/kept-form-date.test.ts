import { describe, expect, it } from "vitest";

import { keptFormDate } from "./kept-form-date";

/*
 * Port from the sibling app (its QA's live re-test, 21 Nov 2026) and QA2's Sunny live R3 (21 Nov 2026): "She was late on
 * 10/5 and 10/15" put 2026-10-15 on the card; a later turn's card had no date, the reply asked "Which date goes on the
 * form?", and Create (pressed unanswered) saved today.
 */
const BASE = { accountForm: true, date: null, asksNewForm: false, latestDates: [], datesGiven: ["10/5", "10/15"], today: "2026-11-21", ownCardDate: "2026-10-15" } as const;

describe("keptFormDate (once set, the card's date stays until the manager changes it)", () => {
  it("a later turn with no date keeps the card's 10/15, one of the dates the manager gave", () => {
    expect(keptFormDate(BASE)).toBe("2026-10-15");
    expect(keptFormDate({ ...BASE, datesGiven: [] })).toBe("2026-10-15");
  });
  it("a date the model gives, or one the manager states now, wins; a new form starts fresh", () => {
    expect(keptFormDate({ ...BASE, date: "2026-10-05" })).toBeNull();
    expect(keptFormDate({ ...BASE, latestDates: ["10/5"] })).toBeNull();
    expect(keptFormDate({ ...BASE, asksNewForm: true })).toBeNull();
  });
  it("never a date that is none of this request's dates, never on a form with no account, never with no earlier card", () => {
    expect(keptFormDate({ ...BASE, datesGiven: ["11/17", "11/18"] })).toBeNull();
    expect(keptFormDate({ ...BASE, accountForm: false })).toBeNull();
    expect(keptFormDate({ ...BASE, ownCardDate: null })).toBeNull();
  });
});

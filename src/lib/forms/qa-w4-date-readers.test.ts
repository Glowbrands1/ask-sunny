import { describe, expect, it } from "vitest";

import { explicitFormDate, extractFormDate, heldCoachingDates, listFormDates, listIncidentDates } from "./form-date-answer";
import { decideFormDate, incidentDates } from "./incident-dates";

/**
 * QA, 22 Oct 2026 (F-03): the date readers behind `decideFormDate`, one at a
 * time. The conversations that exercise them end to end are in
 * `src/lib/ai/qa-w4-date-and-prior-coaching.test.ts`.
 */
const TODAY = "2026-10-21";
const asked = (dates: string) => ({
  role: "assistant",
  content: `You mentioned more than one date (${dates}). Which date goes on the form? Say "most recent"…`,
});

describe("explicitFormDate: a date given to the form", () => {
  it.each([
    ["create verbal ca for pat rivera dated 10/20. she was late on 10/5", "2026-10-20"],
    ["she was late on 10/5, date the form 10/20", "2026-10-20"],
    ["form date: 10/20, she was late 10/5", "2026-10-20"],
    ["the form should be dated 10/20", "2026-10-20"],
    ["dated 10/19 … actually date it 10/20", "2026-10-20"],
  ])("%s", (text, iso) => {
    expect(explicitFormDate(text, TODAY)).toBe(iso);
    expect(extractFormDate(text, TODAY)).toBe(iso);
    expect(incidentDates(text, TODAY)).not.toContain(iso);
  });

  it.each([
    "her written warning dated 9/21, late again on 10/15",
    "she got a warning dated 9/21",
    "previous coaching dated 9/1",
    "she was late on 10/15",
  ])("is never an earlier step's date, or an incident: %s", (text) => {
    expect(explicitFormDate(text, TODAY)).toBeNull();
  });

  it("leads the list of form dates, so an employment change form dated 10/20 keeps it", () => {
    expect(listFormDates("demotion effective 11/1, she stepped down on 10/12, dated 10/20", TODAY)[0]?.iso).toBe("2026-10-20");
  });
});

describe("a conversation held with her is an earlier step, not an incident", () => {
  it.each([
    "we had a talk with her about tardiness on 10/1",
    "we discussed attendance with her on 10/1",
    "I talked to pat about tardiness on 10/1",
    "I had a coaching conversation with her on 10/1",
    "this is after her coaching on 10/1",
    "I coached her on 10/1 for being late",
  ])("%s", (text) => {
    expect(incidentDates(`she was late again today. ${text}`, TODAY)).not.toContain("2026-10-01");
  });

  it.each([
    ["she was late on 10/15 after I talked to her", "2026-10-15"],
    ["I talked to pat about being late on 10/1", "2026-10-01"],
    ["I spoke to the manager about her being late on 10/15", "2026-10-15"],
  ])("but what SHE did keeps its date: %s", (text, iso) => {
    expect(incidentDates(text, TODAY)).toContain(iso);
  });
});

describe("heldCoachingDates: the coaching the manager held", () => {
  it.each([
    ["I coached her on 10/16", ["2026-10-16"]],
    ["we had a coaching conversation with him on 10/16", ["2026-10-16"]],
    ["I sat down with Pat on 10/16", ["2026-10-16"]],
    ["I coached her on 10/6 and again on 10/16", ["2026-10-06", "2026-10-16"]],
  ])("%s", (text, dates) => {
    expect(heldCoachingDates(text, TODAY)).toEqual(dates);
  });

  it.each(["previous coaching 9/1", "I already coached her on 9/1", "I coached her before, on 9/1", "I will coach her on 10/30"])(
    "not an earlier or future one: %s",
    (text) => {
      expect(heldCoachingDates(text, TODAY)).toEqual([]);
    },
  );
});

describe("decideFormDate", () => {
  const decide = (text: string, templateKey: string, history: { role: string; content: string }[] = [], reply?: string) =>
    decideFormDate({
      text,
      templateKey,
      history,
      conversation: [...history, ...(reply ? [{ role: "user", content: reply }] : [])],
      today: TODAY,
    });

  it("asks once among several incident dates, and dates the form the day it is created meanwhile", () => {
    const decided = decide("verbal ca for pat rivera, late on 10/5 and 10/15", "dpoa");
    expect(decided.formDate).toBeNull();
    expect(decided.candidates).toEqual(["2026-10-05", "2026-10-15"]);
    expect(decided.question).toMatch(/Which date goes on the form\?/);
    expect(decide("verbal ca for pat rivera, late on 10/5 and 10/15", "dpoa", [{ role: "user", content: "x" }, asked("10/5, 10/15")]).question).toBeUndefined();
  });

  it("takes the answer", () => {
    const history = [{ role: "user", content: "verbal ca for pat rivera, late on 10/5 and 10/15" }, asked("10/5, 10/15")];
    expect(decide("verbal ca for pat rivera, late on 10/5 and 10/15", "dpoa", history, "most recent").formDate).toBe("2026-10-15");
    expect(decide("verbal ca for pat rivera, late on 10/5 and 10/15", "dpoa", history, "today").formDate).toBeNull();
  });

  it("decides nothing with one date or none, or on a form that is not dated by incidents", () => {
    expect(decide("verbal ca for pat rivera, late on 10/15", "dpoa")).toEqual({});
    expect(decide("verbal ca for pat rivera, late today", "dpoa")).toEqual({});
    expect(decide("demotion for pat rivera, late on 10/5 and 10/15", "demotion")).toEqual({});
  });

  it("a date given to the form wins, with no question", () => {
    expect(decide("verbal ca for pat rivera dated 10/20, late on 10/5 and 10/15", "dpoa")).toEqual({ formDate: "2026-10-20" });
  });

  it("on a Coaching Form the coaching held after what she did is the date; on a Corrective Action it is history", () => {
    expect(decide("coaching for pat rivera, late on 10/5 and 10/15, I coached her on 10/16", "coaching")).toEqual({ formDate: "2026-10-16" });
    expect(decide("coaching for pat rivera. I coached her on 9/1 and she was late again on 10/15", "coaching")).toEqual({});
    expect(decide("verbal ca for pat rivera, late on 10/5 and 10/15, I coached her on 10/16", "dpoa").candidates).toEqual(["2026-10-05", "2026-10-15"]);
  });
});

describe("a deadline is neither an incident nor the form's date — but stays one of the manager's dates", () => {
  const D1 =
    "create corrective action for tess varga for violating standards of conduct policy on 10-20-26. tess failed to acknowledge policies in woven by the 10-15-26 deadline.";

  it("by the 10-15-26 deadline", () => {
    expect(incidentDates(D1, TODAY)).toEqual(["2026-10-20"]);
    expect(extractFormDate(D1, TODAY)).toBe("2026-10-20");
    expect(listFormDates(D1, TODAY).map((found) => found.iso)).toEqual(["2026-10-20", "2026-10-15"]);
  });

  it.each([
    "she was supposed to finish her training by 10/15",
    "the deadline was 10/15",
    "her training was due 10/15",
    "the due date: 10/15",
  ])("%s", (text) => {
    expect(listIncidentDates(text, TODAY)).toEqual([]);
  });

  it.each([
    ["she left by the back door on 10/15", "2026-10-15"],
    ["she was late by 20 minutes on 10/15", "2026-10-15"],
  ])("\"by\" that is not a deadline keeps the date: %s", (text, iso) => {
    expect(incidentDates(text, TODAY)).toEqual([iso]);
  });
});

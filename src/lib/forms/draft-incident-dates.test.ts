import { afterEach, describe, expect, it } from "vitest";

import { withStatedIncidentDates } from "./draft-incident-dates";

/**
 * Coordinator, 26 Oct 2026 (live card test, sibling app; invented names): with
 * FORM_DATE_INCIDENT_ONLY_ENABLED on, the draft of "late to open on 10-5 and
 * 10-15. i coached her on 10-16 about being late" read "On October 16, 2026,
 * <name> was coached regarding these instances of lateness" — both late dates
 * gone. Lowercase, sentence case and ALL CAPS.
 */
const TODAY = "2026-10-26";
const FLAG = "FORM_DATE_INCIDENT_ONLY_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

const NOTES = "create a ca for thessaly ironwood at kearney, she was late to open on 10-5 and 10-15. i coached her on 10-16 about being late";
const DROPPED = {
  observation:
    "Observed:\nOn October 16, 2026, Thessaly was coached regarding these instances of lateness.\n\nExpectation:\nThessaly is expected to arrive on time.",
};
const KEPT = {
  observation:
    "Observed:\nThessaly was late to open on 10-5 and again on 10-15. On October 16, 2026, Thessaly was coached about being late.\n\nExpectation:\nThessaly is expected to arrive on time.",
};

const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const named = text.toLowerCase().split("thessaly ironwood").join("Thessaly Ironwood").split("kearney").join("Kearney");
      return named.charAt(0).toUpperCase() + named.slice(1);
    },
  ],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

describe.each(REGISTERS)("the Observation keeps every stated incident date (%s)", (_register, as) => {
  it("off: the draft is unchanged, dates dropped or not", () => {
    delete process.env[FLAG];
    expect(withStatedIncidentDates(DROPPED, as(NOTES), TODAY)).toBe(DROPPED);
  });

  it("on: the dropped late dates come back in the manager's own clause, under Observed:", () => {
    process.env[FLAG] = "true";
    const next = withStatedIncidentDates(DROPPED, as(NOTES), TODAY).observation!;
    expect(next.toLowerCase()).toContain("observed:\nshe was late to open on 10-5 and 10-15. on october 16, 2026");
    // The coaching held is an earlier step: it is not added again.
    expect(next.match(/10-16/g) ?? []).toHaveLength(0);
  });

  it("on, NEVER-BREAK: an Observation that already holds every incident date is untouched", () => {
    process.env[FLAG] = "true";
    expect(withStatedIncidentDates(KEPT, as(NOTES), TODAY)).toBe(KEPT);
    const written = { observation: "Observed:\nThessaly was late to open on October 5, 2026 and October 15, 2026." };
    expect(withStatedIncidentDates(written, as(NOTES), TODAY)).toBe(written);
    // No stated incident date, nothing to keep.
    const none = { observation: "Observed:\nThessaly was rude to a guest." };
    expect(withStatedIncidentDates(none, as("ca for thessaly ironwood, she was rude to a guest"), TODAY)).toBe(none);
    // A deadline is not an incident date.
    const deadline = { observation: "Observed:\nThessaly missed the Woven deadline." };
    expect(
      withStatedIncidentDates(deadline, as("ca for thessaly ironwood for missing the woven deadline of 11-1-26"), TODAY),
    ).toBe(deadline);
  });
});

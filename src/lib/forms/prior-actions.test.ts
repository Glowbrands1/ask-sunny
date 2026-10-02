import { describe, expect, it } from "vitest";

import {
  NO_PRIOR_ACTION,
  groundPriorActions,
  legacyPriorActions,
  priorActionLine,
  signedDate,
} from "./prior-actions";

/**
 * "List previously received coaching and/or corrective action with date
 * signed" — the Corrective Action Form's history line from revision 5.
 */

const TODAY = "2026-10-03";

describe("the list holds several entries, each with its date", () => {
  it("keeps every entry the draft wrote from the manager's words", () => {
    const drafted = "Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026\nWritten warning — signed 09/28/2026";
    const result = groundPriorActions({
      drafted,
      notes: "Jessica was coached on 9/2, got a verbal warning on 9/21 and was given a written warning on 9/28. She was late again today.",
      today: TODAY,
    });
    expect(result.value).toBe(drafted);
    expect(result.value.split("\n")).toHaveLength(3);
    expect(result.removed).toEqual([]);
  });

  it("adds a step the manager dated that the draft left out", () => {
    const result = groundPriorActions({
      drafted: "Coaching — signed 09/02/2026",
      notes: "she was coached on 9/2 and got a verbal warning on september 21",
      today: TODAY,
    });
    expect(result.value).toBe("Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026");
    expect(result.added).toEqual(["Verbal warning — signed 09/21/2026"]);
  });

  it("lists the manager's dated steps when the draft wrote nothing", () => {
    const result = groundPriorActions({
      drafted: "",
      notes: "create ca for Paulyne Test she was late today, got verbal warning on september 21",
      today: TODAY,
    });
    expect(result.value).toBe("Verbal warning — signed 09/21/2026");
  });

  it("removes a line whose date the manager never gave", () => {
    const result = groundPriorActions({
      drafted: "Verbal warning — signed 08/15/2026\nCoaching on attendance (date not given)",
      notes: "she was coached on attendance before and is late again",
      today: TODAY,
    });
    expect(result.value).toBe("Coaching on attendance (date not given)");
    expect(result.removed).toEqual(["Verbal warning — signed 08/15/2026"]);
  });

  it("says None — first occurrence when the manager said so", () => {
    const result = groundPriorActions({ drafted: "", notes: "late today, verbal warning, first time", today: TODAY });
    expect(result.value).toBe(NO_PRIOR_ACTION);
  });

  it("never reads a repeated behaviour as a history", () => {
    const result = groundPriorActions({ drafted: "", notes: "she was late again today", today: TODAY });
    expect(result.value).toBe("");
  });

  it("lets a dated step win over a None the draft also wrote", () => {
    const result = groundPriorActions({
      drafted: "None — first occurrence",
      notes: "got a verbal warning on 9/21",
      today: TODAY,
    });
    expect(result.value).toBe("Verbal warning — signed 09/21/2026");
  });
});

describe("the two revision-4 lines, read as one entry", () => {
  it("combines what was recorded with the date", () => {
    expect(legacyPriorActions("Verbal warning for tardiness", "2026-09-21")).toBe(
      "Verbal warning for tardiness — signed 09/21/2026",
    );
  });

  it("keeps either half alone", () => {
    expect(legacyPriorActions("None — first occurrence", "")).toBe("None — first occurrence");
    expect(legacyPriorActions("", "2026-09-21")).toBe("Previous corrective action — signed 09/21/2026");
  });

  it("is nothing when the original recorded nothing", () => {
    expect(legacyPriorActions(null, null)).toBeNull();
    expect(legacyPriorActions("  ", "")).toBeNull();
  });

  it("writes dates the way the business writes them", () => {
    expect(signedDate("2026-09-02")).toBe("09/02/2026");
    expect(priorActionLine("Coaching", "2026-09-02")).toBe("Coaching — signed 09/02/2026");
  });
});

import { describe, expect, it } from "vitest";

import {
  assignmentTrackerEmails,
  assignmentTrackerText,
  canSeeAssignmentTracker,
  currentHalfSummary,
  halfLabel,
  halfOf,
  halvesThrough,
  markMap,
  nextMarkState,
  personTotals,
  sortPeople,
  statusOf,
  type AssignmentPerson,
} from "./assignments";

/*
 * AI Training -> Assignments (Pau, 23 Nov 2026): the rules of the standalone tracker it replaces, kept. The people and
 * emails are invented.
 */

const person = (id: string, name: string, extra: Partial<AssignmentPerson> = {}): AssignmentPerson => ({ id, name, group: null, startDate: null, sortOrder: null, ...extra });
const ASH = person("a", "Ash Fernwell");
const BRAM = person("b", "Bram Tolliver", { startDate: "2026-11-03" });

describe("halves", () => {
  it("the 1st to 15th is the first half, the 16th to month end the second", () => {
    expect(halfOf("2026-11-15")).toEqual({ month: "2026-11", half: 0 });
    expect(halfOf("2026-11-16")).toEqual({ month: "2026-11", half: 1 });
    expect(halfLabel("2026-11", 1)).toBe("Nov 16–30, 2026");
    expect(halfLabel("2027-02", 1)).toBe("Feb 16–28, 2027");
    expect(halfLabel("2026-12", 0)).toBe("Dec 1–15, 2026");
  });

  it("the halves counted run from October 2026 through the current one", () => {
    expect(halvesThrough("2026-11-23")).toEqual([
      { month: "2026-10", half: 0 },
      { month: "2026-10", half: 1 },
      { month: "2026-11", half: 0 },
      { month: "2026-11", half: 1 },
    ]);
  });
});

describe("a half's status", () => {
  const marks = markMap([
    { personId: "a", month: "2026-10", half: 0, state: "done" },
    { personId: "a", month: "2026-11", half: 0, state: "extended" },
  ]);
  const today = "2026-11-23";

  it("a mark wins; unmarked is Missing once ended, Due while it runs, Upcoming before it starts", () => {
    expect(statusOf(ASH, "2026-10", 0, marks, today)).toBe("done");
    expect(statusOf(ASH, "2026-11", 0, marks, today)).toBe("extended");
    expect(statusOf(ASH, "2026-10", 1, marks, today)).toBe("missing");
    expect(statusOf(ASH, "2026-11", 1, marks, today)).toBe("due");
    expect(statusOf(ASH, "2026-12", 0, marks, today)).toBe("upcoming");
  });

  it("a half that ended before someone's start date is not theirs; the half they started in is", () => {
    expect(statusOf(BRAM, "2026-10", 1, marks, today)).toBe("not_started");
    expect(statusOf(BRAM, "2026-11", 0, marks, today)).toBe("missing");
  });

  it("totals: done and missing since tracking began; More time is neither", () => {
    expect(personTotals(ASH, marks, today)).toEqual({ done: 1, extended: 1, missing: 1 });
    expect(personTotals(BRAM, marks, today)).toEqual({ done: 0, extended: 0, missing: 1 });
  });

  it("a box cycles: Due → Done → More time → Due", () => {
    expect(nextMarkState(undefined)).toBe("done");
    expect(nextMarkState("done")).toBe("extended");
    expect(nextMarkState("extended")).toBeNull();
  });
});

describe("order and this half", () => {
  it("ungrouped first, then groups A–Z, then by name", () => {
    const people = [person("1", "Zed", { group: "Ops" }), person("2", "Amy", { group: "HR" }), person("3", "Bo"), person("4", "Al", { group: "HR" })];
    expect(sortPeople(people).map((p) => p.name)).toEqual(["Bo", "Al", "Amy", "Zed"]);
  });

  it("this half: done, due and more time", () => {
    const tracker = {
      people: [ASH, BRAM, person("c", "Cass Lindqvist")],
      marks: [
        { personId: "a", month: "2026-11", half: 1 as const, state: "done" as const },
        { personId: "c", month: "2026-11", half: 1 as const, state: "extended" as const },
      ],
    };
    const now = currentHalfSummary(tracker, "2026-11-23");
    expect(now.label).toBe("Nov 16–30, 2026");
    expect(now.done.map((p) => p.name)).toEqual(["Ash Fernwell"]);
    expect(now.due.map((p) => p.name)).toEqual(["Bram Tolliver"]);
    expect(now.extended.map((p) => p.name)).toEqual(["Cass Lindqvist"]);
  });
});

describe("the AI's read", () => {
  it("names the current half and each person's halves with the grid's labels", () => {
    const text = assignmentTrackerText({ people: [ASH, BRAM], marks: [{ personId: "a", month: "2026-11", half: 1, state: "done" }] }, "2026-11-23");
    expect(text).toContain("The current half is Nov 16–30, 2026.");
    expect(text).toContain("This half: 1 of 2 done.");
    expect(text).toContain("Still due this half: Bram Tolliver.");
    expect(text).toContain("- Ash Fernwell: 1 done, 3 missing, 0 with more time. Oct 1–15, 2026: Missing; Oct 16–31, 2026: Missing; Nov 1–15, 2026: Missing; Nov 16–30, 2026: Done.");
    expect(text).toContain("- Bram Tolliver (started Nov 3, 2026): 0 done, 1 missing, 0 with more time. Nov 1–15, 2026: Missing; Nov 16–30, 2026: Due.");
  });

  it("an empty tracker says so", () => {
    expect(assignmentTrackerText({ people: [], marks: [] }, "2026-11-23")).toContain("Nobody is on the tracker yet.");
  });
});

describe("who may see it", () => {
  it("the named list, any case; unset, the AI Training editors; neither, nobody", () => {
    const list = assignmentTrackerEmails("One@Example.test; two@example.test", () => ["editor@example.test"]);
    expect(list).toEqual(["one@example.test", "two@example.test"]);
    expect(canSeeAssignmentTracker({ email: " ONE@example.test " }, list)).toBe(true);
    expect(canSeeAssignmentTracker({ email: "editor@example.test" }, list)).toBe(false);
    expect(assignmentTrackerEmails("", () => ["editor@example.test"])).toEqual(["editor@example.test"]);
    expect(assignmentTrackerEmails(undefined, () => [])).toEqual([]);
    expect(canSeeAssignmentTracker({ email: "one@example.test" }, [])).toBe(false);
    expect(canSeeAssignmentTracker(null, list)).toBe(false);
  });
});

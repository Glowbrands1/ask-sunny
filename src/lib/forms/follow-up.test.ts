import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  attentionSentence,
  attentionSummary,
  followUpCounts,
  followUpState,
  FOLLOW_UP_FILTERS,
  matchesFollowUpFilter,
  needsFollowUp,
  parseFollowUpFilter,
  relativeBusinessDay,
  type FollowUpFacts,
} from "./follow-up";

/**
 * THE DERIVATION IS THE FEATURE.
 *
 * Nothing stores "overdue": a form is overdue because its date is behind
 * today's business date, which means the state is correct the moment the clock
 * passes midnight with nothing running. These tests pin the rules and, more
 * importantly, pin the boundaries — the day a follow-up is due is NOT late, and
 * the day after is.
 */

const TODAY = "2026-09-04"; // a Friday

function form(overrides: Partial<FollowUpFacts> = {}): FollowUpFacts {
  return {
    status: "finalized",
    followUpDate: null,
    followedUpAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("what state a follow-up is in", () => {
  it("is untracked when no date was ever set", () => {
    expect(followUpState(form(), TODAY)).toBe("untracked");
  });

  it("is drafted for an unfinished form nobody has scheduled", () => {
    expect(followUpState(form({ status: "draft" }), TODAY)).toBe("drafted");
  });

  it("is open when the date is in the future", () => {
    expect(followUpState(form({ followUpDate: "2026-09-10" }), TODAY)).toBe("open");
  });

  it("is open ON the day it is due — due today is not late", () => {
    expect(followUpState(form({ followUpDate: TODAY }), TODAY)).toBe("open");
  });

  it("is overdue the day after, and not one moment before", () => {
    expect(followUpState(form({ followUpDate: "2026-09-03" }), TODAY)).toBe("overdue");
    expect(followUpState(form({ followUpDate: "2026-09-05" }), TODAY)).toBe("open");
  });

  it("is followed up once it has been marked done, however late it was", () => {
    const done = form({ followUpDate: "2026-08-01", followedUpAt: "2026-09-04T14:00:00Z" });
    expect(followUpState(done, TODAY)).toBe("followed_up");
  });

  it("is archived before anything else, so a hidden form is nobody's work", () => {
    const archived = form({ followUpDate: "2026-08-01", archivedAt: "2026-09-01T00:00:00Z" });
    expect(followUpState(archived, TODAY)).toBe("archived");
    expect(needsFollowUp(archived, TODAY)).toBe(false);
  });

  /*
   * THE OVERLAP THE BRIEF LEFT OPEN. A draft with a date in the past satisfies
   * both DRAFTED and OVERDUE as the rules were written. It resolves to overdue,
   * because somebody deliberately started tracking it and labelling it
   * "drafted" would drop it out of the count that exists to chase it.
   */
  it("calls a TRACKED draft by its follow-up state, not 'drafted'", () => {
    expect(followUpState(form({ status: "draft", followUpDate: "2026-09-03" }), TODAY)).toBe(
      "overdue",
    );
    expect(followUpState(form({ status: "draft", followUpDate: "2026-09-30" }), TODAY)).toBe(
      "open",
    );
  });
});

describe("the counts behind the pills", () => {
  const forms = [
    form({ status: "draft" }), // drafted
    form({ status: "draft" }), // drafted
    form({ followUpDate: "2026-09-10" }), // open
    form({ followUpDate: TODAY }), // open
    form({ followUpDate: "2026-09-01" }), // overdue
    form({ followUpDate: "2026-08-20", followedUpAt: "2026-08-21T10:00:00Z" }), // followed up
    form({ followUpDate: "2026-08-20", archivedAt: "2026-08-25T10:00:00Z" }), // archived
    form(), // untracked finalized
  ];

  it("counts each state once, and only once", () => {
    expect(followUpCounts(forms, TODAY)).toEqual({
      all: 8,
      drafted: 2,
      open: 2,
      overdue: 1,
      followed_up: 1,
    });
  });

  it("adds up: the states are disjoint, so no form is counted twice", () => {
    const counts = followUpCounts(forms, TODAY);
    const accounted = counts.drafted + counts.open + counts.overdue + counts.followed_up;
    // The remainder is the untracked finalized form and the archived one.
    expect(counts.all - accounted).toBe(2);
  });

  it("filters to exactly what each pill counts", () => {
    for (const filter of FOLLOW_UP_FILTERS) {
      const matched = forms.filter((entry) => matchesFollowUpFilter(entry, filter, TODAY));
      const counts = followUpCounts(forms, TODAY);
      expect(matched.length, filter).toBe(filter === "all" ? counts.all : counts[filter]);
    }
  });

  it("narrows an untrusted ?followup= to a known filter", () => {
    expect(parseFollowUpFilter("overdue")).toBe("overdue");
    expect(parseFollowUpFilter("followed_up")).toBe("followed_up");
    expect(parseFollowUpFilter("nonsense")).toBe("all");
    expect(parseFollowUpFilter(null)).toBe("all");
  });
});

describe("what needs attention", () => {
  it("counts overdue plus what is due before the weekend", () => {
    // TODAY is a Friday, so the business week ends Saturday the 5th.
    const summary = attentionSummary(
      [
        form({ followUpDate: "2026-09-01" }), // overdue
        form({ followUpDate: "2026-09-02" }), // overdue
        form({ followUpDate: TODAY }), // due today -> this week
        form({ followUpDate: "2026-09-05" }), // Saturday -> this week
        form({ followUpDate: "2026-09-07" }), // next Monday -> NOT this week
      ],
      TODAY,
    );
    expect(summary).toEqual({ overdue: 2, dueThisWeek: 2, needsAttention: 4 });
  });

  it("ignores everything that is not somebody's outstanding work", () => {
    const summary = attentionSummary(
      [
        form({ followUpDate: "2026-08-01", followedUpAt: "2026-08-02T09:00:00Z" }),
        form({ followUpDate: "2026-08-01", archivedAt: "2026-08-02T09:00:00Z" }),
        form({ status: "draft" }),
        form(),
      ],
      TODAY,
    );
    expect(summary).toEqual({ overdue: 0, dueThisWeek: 0, needsAttention: 0 });
  });

  it("says nothing at all when nothing needs attention", () => {
    expect(attentionSentence({ overdue: 0, dueThisWeek: 0, needsAttention: 0 })).toBeNull();
  });

  it("states the total and its parts, and no number is hard-coded", () => {
    expect(attentionSentence({ overdue: 8, dueThisWeek: 4, needsAttention: 12 })).toBe(
      "12 follow-ups need attention — 8 overdue · 4 due this week",
    );
    expect(attentionSentence({ overdue: 1, dueThisWeek: 0, needsAttention: 1 })).toBe(
      "1 follow-up needs attention — 1 overdue",
    );
  });
});

describe("how a date is described", () => {
  it("uses the words somebody chasing a follow-up would use", () => {
    expect(relativeBusinessDay(TODAY, TODAY)).toBe("Today");
    expect(relativeBusinessDay("2026-09-05", TODAY)).toBe("Tomorrow");
    expect(relativeBusinessDay("2026-09-03", TODAY)).toBe("Yesterday");
    expect(relativeBusinessDay("2026-09-08", TODAY)).toBe("in 4 days");
    // "3 days late", not "3 days ago": one is outstanding, the other sounds
    // finished.
    expect(relativeBusinessDay("2026-09-01", TODAY)).toBe("3 days late");
  });
});

describe("the module's own boundaries", () => {
  const SOURCE = readFileSync(new URL("./follow-up.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("never measures against the demo anchor", () => {
    /*
     * THE LOAD-BEARING ASSERTION. `@/lib/utils/date` measures everything from
     * DEMO_ANCHOR, a fixed instant in August, so a real follow-up judged
     * against it would be permanently mis-stated. Importing it here is the way
     * that would happen by accident.
     */
    expect(SOURCE).not.toMatch(/utils\/date/);
    expect(SOURCE).not.toMatch(/demoNow|DEMO_ANCHOR|daysFromNow|relativeDay\b/);
  });

  it("is readable from both the server and the browser", () => {
    // Both screens derive state from this module, one on the server and one
    // after hydration, so it may carry neither directive.
    expect(SOURCE).not.toMatch(/^\s*["']use client["']/m);
    expect(SOURCE).not.toMatch(/import\s+["']server-only["']/);
  });
});

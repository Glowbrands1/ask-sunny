import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildInsights, type InsightInput } from "./insights";
import type { AnalyticsTotals } from "./queries";
import type { FeedbackSummary } from "./feedback-queries";

/**
 * "WHAT THE NUMBERS SAY" — the arithmetic.
 *
 * EVERY SENTENCE IS A SUBTRACTION, A DIVISION OR A MAXIMUM over figures the
 * dashboard is already showing. No model is involved, which is what makes these
 * testable at all: a generated summary could be wrong about the numbers printed
 * directly above it and would differ on every load, so nobody could quote it
 * twice.
 */

const TOTALS: AnalyticsTotals = {
  events: 120,
  activeUsers: 10,
  activeSalons: 5,
  forms: 20,
  documents: 3,
  reports: 7,
  chatEvents: 90,
  failures: 6,
};

const FEEDBACK: FeedbackSummary = {
  responses: 20,
  averageRating: 4.2,
  distribution: { 1: 1, 2: 1, 3: 2, 4: 6, 5: 10 },
  outcomes: { yes: 12, partially: 5, no: 3 },
  queue: { pending: 4, in_review: 1, resolved: 14, dismissed: 1 },
  hidden: 0,
};

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    totals: TOTALS,
    previous: { ...TOTALS, events: 60, activeUsers: 6 },
    trend: [
      { date: "2026-09-01", events: 30, activeUsers: 5 },
      { date: "2026-09-02", events: 70, activeUsers: 8 },
      { date: "2026-09-03", events: 20, activeUsers: 4 },
    ],
    when: [
      { dayOfWeek: 1, hourOfDay: 10, events: 50 },
      { dayOfWeek: 1, hourOfDay: 14, events: 20 },
      { dayOfWeek: 3, hourOfDay: 10, events: 30 },
      { dayOfWeek: 5, hourOfDay: 9, events: 20 },
    ],
    topics: [
      { category: "policy_question", events: 60, activeUsers: 8, acknowledgements: 4, lastAsked: "2026-09-14T12:00:00Z" },
      { category: "coaching_guidance", events: 40, activeUsers: 6, acknowledgements: 2, lastAsked: "2026-09-13T12:00:00Z" },
      { category: "daily_stats", events: 20, activeUsers: 3, acknowledgements: 0, lastAsked: "2026-09-12T12:00:00Z" },
    ],
    previousTopics: [
      { category: "policy_question", events: 50, activeUsers: 7, acknowledgements: 0, lastAsked: null },
      { category: "coaching_guidance", events: 10, activeUsers: 2, acknowledgements: 0, lastAsked: null },
    ],
    feedback: FEEDBACK,
    periodLabel: "Last 30 days",
    previousLabel: "prior 30 days",
    timezoneLabel: "Eastern",
    ...overrides,
  };
}

function find(insights: ReturnType<typeof buildInsights>, key: string) {
  return insights.find((insight) => insight.key === key);
}

/* ------------------------------------------------------------- growth ---- */

describe("is usage growing?", () => {
  it("states the change and names the busiest day", () => {
    const growth = find(buildInsights(input()), "growth");
    expect(growth?.value).toBe("+100%");
    expect(growth?.detail).toContain("120 inquiries");
    expect(growth?.detail).toContain("Busiest day was Sep 2 with 70");
  });

  it("says \"New\" rather than dividing by zero", () => {
    /*
     * Going from 0 to 7 is not "+700%" — it is the first week of use, and
     * dividing by zero to say otherwise turns a real beginning into a fake
     * trend. The rule lives in `changeAgainst` and is respected here rather
     * than worked around.
     */
    const growth = find(
      buildInsights(input({ previous: { ...TOTALS, events: 0, activeUsers: 0 } })),
      "growth",
    );
    expect(growth?.value).toBe("New");
    expect(growth?.detail).toContain("had none");
    expect(growth?.detail).not.toContain("%");
  });

  it("reports a fall as a fall", () => {
    const growth = find(
      buildInsights(input({ previous: { ...TOTALS, events: 240 } })),
      "growth",
    );
    expect(growth?.value).toBe("-50%");
  });

  it("is omitted entirely when nothing happened", () => {
    /*
     * AN INSIGHT WITH NO BASIS IS OMITTED, NOT SOFTENED. "Usage may be growing"
     * is not an insight and takes up the same space as one.
     */
    const insights = buildInsights(
      input({ totals: { ...TOTALS, events: 0, activeUsers: 0 } }),
    );
    expect(find(insights, "growth")).toBeUndefined();
    expect(find(insights, "reliance")).toBeUndefined();
    expect(find(insights, "landing")).toBeUndefined();
  });
});

/* --------------------------------------------------------------- when ---- */

describe("when do leaders use it most?", () => {
  it("names the busiest day and hour with their shares", () => {
    const when = find(buildInsights(input()), "when");
    expect(when?.value).toBe("Mon");
    expect(when?.detail).toContain("Mondays carry 58%");
    expect(when?.detail).toContain("10am–11am");
    expect(when?.detail).toContain("Eastern");
  });

  it("breaks a tie toward the earlier day, stably", () => {
    /*
     * Arbitrary but STABLE. `Map` iteration is insertion order, so without a
     * deterministic tie-break the "busiest day" could change between two
     * renders of identical data purely because the rows arrived differently.
     */
    const rows = [
      { dayOfWeek: 4, hourOfDay: 9, events: 10 },
      { dayOfWeek: 2, hourOfDay: 9, events: 10 },
    ];
    expect(find(buildInsights(input({ when: rows })), "when")?.value).toBe("Tue");
    expect(
      find(buildInsights(input({ when: [...rows].reverse() })), "when")?.value,
    ).toBe("Tue");
  });

  it("is omitted when there is no activity to describe", () => {
    expect(find(buildInsights(input({ when: [] })), "when")).toBeUndefined();
  });
});

/* -------------------------------------------------------------- needs ---- */

describe("what do leaders need most?", () => {
  it("leads with the biggest topic and names the fastest riser", () => {
    const needs = find(buildInsights(input()), "needs");
    expect(needs?.value).toBe("50%");
    expect(needs?.detail).toContain("Policy & compliance questions leads with 60");
    /* coaching_guidance: 10 -> 40 is +300%; policy: 50 -> 60 is +20%. */
    expect(needs?.detail).toContain("Coaching & performance guidance, up 300%");
  });

  it("never calls a topic with no baseline the fastest riser", () => {
    /*
     * A category that went from nothing to four is not the fastest-growing
     * thing leaders need; it is a category that did not exist last month.
     * Including it would put a rounding error at the top of the card every
     * period.
     */
    const needs = find(
      buildInsights(
        input({
          topics: [
            { category: "policy_question", events: 60, activeUsers: 8, acknowledgements: 0, lastAsked: null },
            { category: "safety_hr", events: 4, activeUsers: 1, acknowledgements: 0, lastAsked: null },
          ],
          previousTopics: [
            { category: "policy_question", events: 50, activeUsers: 7, acknowledgements: 0, lastAsked: null },
          ],
        }),
      ),
      "needs",
    );
    expect(needs?.detail).toContain("Policy & compliance questions");
    expect(needs?.detail).not.toContain("Safety");
  });

  it("says so when nothing has a baseline yet", () => {
    const needs = find(buildInsights(input({ previousTopics: [] })), "needs");
    expect(needs?.detail).toContain("No topic has a prior-period baseline");
  });

  it("is omitted when nothing was asked", () => {
    expect(find(buildInsights(input({ topics: [] })), "needs")).toBeUndefined();
  });
});

/* ------------------------------------------------------------ landing ---- */

describe("are the answers landing?", () => {
  it("separates the answer rate from what people thought of the answers", () => {
    /*
     * TWO DIFFERENT MEASURES, AND THE CARD SAYS SO. The answer rate is "did the
     * request succeed", known about every turn. "Got what they needed" is "was
     * it any use", known only about the turns somebody rated. Presenting the
     * second as though it described the first — a 9% beside a 100% — invites
     * the reading that 91% of everything failed.
     */
    const landing = find(buildInsights(input()), "landing");
    expect(landing?.value).toBe("95%");
    expect(landing?.detail).toContain("114 of 120 inquiries were answered");
    expect(landing?.detail).toContain("Of the 20 answers rated, 60% said they got what they needed");
    expect(landing?.detail).toContain("averaging 4.2 stars");
  });

  it("says nothing has been rated rather than printing a zero", () => {
    /*
     * "0% got what they needed" for a period nobody rated is a catastrophe that
     * did not happen, and it is the kind of figure somebody screenshots.
     */
    const landing = find(
      buildInsights(
        input({
          feedback: {
            ...FEEDBACK,
            responses: 0,
            averageRating: null,
            outcomes: { yes: 0, partially: 0, no: 0 },
          },
        }),
      ),
      "landing",
    );
    expect(landing?.detail).toContain("Nothing has been rated yet");
    expect(landing?.detail).not.toContain("0%");
  });
});

/* ---------------------------------------------------------- reliance ----- */

describe("how many leaders rely on it?", () => {
  it("counts the leaders and the average each", () => {
    const reliance = find(buildInsights(input()), "reliance");
    expect(reliance?.value).toBe("10");
    expect(reliance?.detail).toContain("10 leaders used Ask Sunny at least once");
    expect(reliance?.detail).toContain("averaging 12.0 inquiries each");
    expect(reliance?.detail).toContain("4 more than the prior period");
  });

  it("does not claim a change when the prior period had nobody", () => {
    const reliance = find(
      buildInsights(input({ previous: { ...TOTALS, activeUsers: 0 } })),
      "reliance",
    );
    expect(reliance?.detail).toContain("None were active in the prior period");
  });
});

/* ---------------------------------------------- the page stays admin-only -- */

describe("the analytics pages stay behind the administration permission", () => {
  const PAGES = [
    "src/app/(app)/admin/analytics/page.tsx",
    "src/app/(app)/admin/analytics/[view]/page.tsx",
  ];

  it.each(PAGES)("%s requires view_analytics on the server", (page) => {
    /*
     * BOTH HALVES. `requirePagePermission` is the server guard and is what
     * actually refuses; `PermissionGate adminOnly` is the client one. A page
     * with only the second renders nothing and has already fetched everything.
     */
    const source = readFileSync(join(process.cwd(), page), "utf8");
    expect(source).toContain('requirePagePermission("view_analytics")');
    expect(source).toContain('permission="view_analytics"');
    expect(source).toContain("adminOnly");
  });

  it.each(PAGES)("%s guards before it loads any data", (page) => {
    /*
     * MEASURED INSIDE THE COMPONENT, not across the file. The loader is
     * IMPORTED at the top, so comparing raw offsets would compare an import
     * against a call and fail a page that is correctly ordered — which is a
     * test that has to be deleted rather than a bug that has to be fixed.
     */
    const source = readFileSync(join(process.cwd(), page), "utf8");
    const body = source.split("export default async function")[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(body.indexOf("requirePagePermission")).toBeLessThan(
      body.indexOf("loadAnalyticsPage"),
    );
  });

  it("routes every analytics view through the same guarded pages", () => {
    /*
     * A view added as its own route file would be a page somebody had to
     * remember to guard. The `[view]` segment means there is nowhere else for
     * one to go — this asserts the directory has not grown a sibling.
     */
    const dir = join(process.cwd(), "src/app/(app)/admin/analytics");
    const entries = readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
    expect(entries.sort()).toEqual(["[view]", "page.tsx"]);
  });
});

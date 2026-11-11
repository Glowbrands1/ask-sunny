import { describe, expect, it } from "vitest";

import { DEMO_REVIEW_METRICS } from "@/data/demo/reviews";
import { EMPTY_FEEDBACK_FILTERS } from "@/lib/analytics/feedback-filters";
import { EMPTY_FILTERS } from "@/lib/analytics/filters";
import { followUpState } from "@/lib/forms/follow-up";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

import {
  demoAnalyticsSnapshot,
  demoFeedbackPage,
  demoFeedbackSnapshot,
  demoSalonUuid,
} from "./analytics-fixtures";
import { demoSalonScope } from "./demo-scope";
import {
  demoListForms,
  demoMarkFollowedUp,
  demoOutstandingFollowUps,
  demoTemplateSummaries,
  isDemoFormId,
} from "./forms-fixtures";
import { demoAnchorSetupRows, demoApifySource } from "./reviews-admin-fixtures";

/*
 * The demo screens draw the live components over these fixtures, so the
 * fixtures must keep the live shapes' own invariants: totals that add up,
 * filters that narrow, and the same review figures the seeded /reviews page
 * shows.
 */
const TODAY = "2026-11-10";

describe("analytics fixtures", () => {
  it("counts a non-empty window whose breakdowns add up to the total", () => {
    const snapshot = demoAnalyticsSnapshot(EMPTY_FILTERS, TODAY);
    expect(snapshot.totals.events).toBeGreaterThan(500);
    const byFeature = snapshot.byFeature.reduce((sum, row) => sum + row.events, 0);
    expect(byFeature).toBe(snapshot.totals.events);
    expect(snapshot.locations).toHaveLength(15);
    expect(snapshot.previous.events).toBeGreaterThan(0);
  });

  it("narrows every panel when a salon is chosen", () => {
    const salonId = demoSalonUuid("0306");
    const snapshot = demoAnalyticsSnapshot({ ...EMPTY_FILTERS, salonId }, TODAY);
    expect(snapshot.locations.map((row) => row.salonNumber)).toEqual(["0306"]);
    expect(snapshot.leaders.every((row) => row.salonId === salonId)).toBe(true);
    expect(snapshot.totals.activeSalons).toBe(1);
  });

  it("pages the open feedback queue", () => {
    const feedback = demoFeedbackSnapshot(EMPTY_FILTERS, TODAY);
    const page = demoFeedbackPage(EMPTY_FILTERS, EMPTY_FEEDBACK_FILTERS, TODAY);
    expect(page.total).toBe(feedback.summary.queue.pending + feedback.summary.queue.in_review);
    expect(page.items.every((item) => item.status === "pending" || item.status === "in_review")).toBe(true);
  });
});

describe("forms fixtures", () => {
  it("lists the real template library at its seed revisions", () => {
    const summaries = demoTemplateSummaries();
    expect(summaries.map((row) => row.key).sort()).toEqual(TEMPLATE_SEEDS.map((seed) => seed.key).sort());
    for (const summary of summaries) {
      const seed = TEMPLATE_SEEDS.find((entry) => entry.key === summary.key);
      expect(summary.currentVersion?.version).toBe(seed?.revision);
    }
  });

  it("has overdue, open and archived forms and keeps a follow-up done once marked", () => {
    const states = new Set(demoListForms("all").map((form) => followUpState(form)));
    for (const state of ["overdue", "open", "followed_up", "archived", "drafted"]) {
      expect(states.has(state as never)).toBe(true);
    }
    const target = demoOutstandingFollowUps()[0];
    expect(isDemoFormId(target.id)).toBe(true);
    demoMarkFollowedUp(target.id, "Test");
    expect(demoOutstandingFollowUps().some((form) => form.id === target.id)).toBe(false);
  });

  it("scopes a seeded district manager to production salons", () => {
    const salons = demoSalonScope({ level: "district", primaryAreaId: "dist-1", alsoCoversAreaIds: [] });
    expect(salons).toContain("loc-0306");
    expect(salons).not.toContain("loc-0313");
    expect(demoSalonScope({ level: "global", primaryAreaId: null, alsoCoversAreaIds: [] })).toBeNull();
  });
});

describe("review admin fixtures", () => {
  it("matches the seeded /reviews figures", () => {
    for (const row of demoAnchorSetupRows()) {
      const metrics = DEMO_REVIEW_METRICS.find((entry) => entry.salonNumber === row.salonNumber);
      expect(row.heldReviews).toBe(metrics?.held);
      expect(row.historicalReviews).toBe(metrics?.historical);
      expect(row.trackingActive).toBe(metrics?.counting);
    }
  });

  it("reports a healthy source for all fifteen listings", () => {
    const source = demoApifySource();
    expect(source.locationsConfigured).toBe(15);
    expect(source.problems).toEqual([]);
    expect(source.locations.every((location) => location.sourceStatus === "verified")).toBe(true);
  });
});

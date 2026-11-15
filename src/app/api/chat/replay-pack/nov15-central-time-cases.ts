import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { __setDataToolDepsForTests } from "@/lib/ai/agent-loop/data-tools";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";

import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * "THE WHOLE APP AND CHAT SHOULD BE IN CT" (Pau, 15 Nov 2026), in the agent loop. The chat had told Pau "Data current
 * as of the last sync, 2026-11-14 12:01 UTC". The loop's tools now return times already in Central ("Nov 14, 6:01 AM CT")
 * and the rules book says to give them as they are. The reply's wording is the model's; this checks what the tool gives
 * it and what it was told.
 */
const FLAG = "AGENT_LOOP_ENABLED";
const PAU_REVIEWS = "How many google reviews do we have this far";

const SNAPSHOT = {
  empty: false,
  locations: [
    {
      storeCode: "143", locationName: "listing 143", district: null, salonNumber: "0309", listingState: "verified", anchorReviewId: "anchor-143", anchorReviewer: "Invented Anchor", historical: 0,
      reviewsThisWeek: 2, qualifyingThisWeek: 2, lastWeek: 1, qualifyingLastWeek: 1, qualifyingMonthToDate: 11, unanswered: 0, criticalOpen: 0, averageRating: 4.9, total: 40,
    },
  ],
  goal: { target: 20, monthStart: "2026-11-01", today: "2026-11-14", dayOfMonth: 14, daysInMonth: 30, daysElapsed: 13, paceTarget: 9 },
  lastSyncAt: "2026-11-14T12:01:00Z",
} as unknown as ReviewsSnapshot;

export const NOV15_CENTRAL_TIME_CASES: ReplayCase[] = [
  {
    id: "nov15-central-time-loop-reviews-last-sync",
    title: `Pau: "${PAU_REVIEWS}" through the loop: read_reviews gives the last sync in Central time (CT), never UTC or a raw timestamp, and the rules book says times are CT`,
    report: `Pau via QA, 15 Nov 2026: "The whole app and chat should be in CT"; the chat said "Data current as of the last sync, 2026-11-14 12:01 UTC"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      vi.stubEnv("NEXT_PUBLIC_BUSINESS_TIMEZONE", "America/Chicago");
      t.directory(STAFF);
      // The Google Reviews reads need tables the harness does not hold: the snapshot is scripted, with the sync time stored as production stores it (UTC).
      __setDataToolDepsForTests({
        supabaseReady: async () => true,
        loadReviewsSnapshot: async () => SNAPSHOT,
        loadReviewFeed: async () => ({ reviews: [], total: 0 }) as unknown as ReviewFeed,
      });
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view: LoopView) => {
        const out = lastResult(view, "read_reviews") as { last_sync?: string | null } | null;
        return out ? { text: `Data current as of the last sync, ${out.last_sync ?? "not recorded"}.` } : { tool: "read_reviews", input: {} };
      });
      t.loopModel!(model);
      const reply = await t.thread().say(PAU_REVIEWS);
      const output = (model.views.flatMap((view) => view.results).find((result) => result.tool === "read_reviews")?.output ?? {}) as { last_sync?: string | null };
      expect(output.last_sync, `the harness gave no sync time to convert: ${JSON.stringify(output).slice(0, 400)}`).toBeTruthy();
      expect(output.last_sync, "the last sync is not in Central time").toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M CT$/);
      expect(JSON.stringify(output), "UTC reached the model").not.toMatch(/UTC|\d{4}-\d{2}-\d{2}T/);
      expect(reply.content, "the reply says UTC").not.toMatch(/UTC/);
      expect(model.views[0]!.system, "the rules book does not say times are CT").toMatch(/Times you give are Central time \(CT\); never say UTC/);
      vi.unstubAllEnvs();
      __setDataToolDepsForTests(null);
    },
  },
];

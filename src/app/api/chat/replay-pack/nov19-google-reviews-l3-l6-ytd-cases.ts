import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE GOOGLE REVIEWS NOW HAVE L3, L6 AND YTD, AND THE AI ANSWERS FROM THEM (MANAGER REQUEST, 19 NOV 2026)
 * ============================================================================
 *
 * The manager's words on the page: "per month pls last 3 mos last 6 mos and YTD". The Google Reviews page gained a
 * Month by month table with L3 (last 3 full months), L6 (last 6 full months) and YTD per salon. The chat block and the
 * loop's read_reviews knew only the month to date and this reporting week and last, so the assistant had no figure for
 * them. The invariants are on what the model was given: the table's own figures (`t.reviewsOnFile()`: 2 qualifying
 * reviews per listing in each of Aug, Sep and Oct, 1 so far in Nov), the full-month windows named, never the partial
 * month in L3 or L6.
 */

const QUESTION = "How many Google reviews did we get per month, last 3 mos, last 6 mos and YTD?";
const FLAG = "GOOGLE_REVIEWS_IN_CHAT_ENABLED";
const REPORT = `Manager, 19 Nov 2026 (the Google Reviews page): "per month pls last 3 mos last 6 mos and YTD"; the assistant: "${QUESTION}"`;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.reviewsOnFile!();
  return t.thread();
}

export const NOV19_GOOGLE_REVIEWS_L3_L6_YTD_CASES: ReplayCase[] = [
  {
    id: "nov19-google-reviews-l3-l6-ytd",
    title: `"${QUESTION}": the model is given L3, L6, YTD and each month per salon from the Google Reviews page`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      await start(t).say(QUESTION);
      const data = t.lastReportData?.() ?? "";
      expect(data).toContain("GOOGLE REVIEWS — L3, L6, YTD AND MONTH BY MONTH");
      expect(data).toContain("L3 = last 3 full months (Aug – Oct 2026)");
      expect(data).toContain("L6 = last 6 full months (May – Oct 2026)");
      expect(data).toContain("All 15 salons together (qualifying): L3 90, L6 90, YTD 105.");
      expect(data).toContain("(store 143, this manager's salon): L3 6, L6 6, YTD 7.");
    },
  },
  {
    id: "nov19-google-reviews-l3-l6-ytd-agent-loop",
    title: `the tool loop: "${QUESTION}": read_reviews returns L3, L6 and YTD, with the full-month windows named`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view: LoopView) =>
        lastResult(view, "read_reviews") ? { text: "Here is what the app shows." } : { tool: "read_reviews", input: { period: "L3, L6 and YTD" } },
      );
      t.loopModel!(model);
      await thread.say(QUESTION);
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_reviews")).at(-1)?.output ?? {};
      const months = (output.months ?? {}) as { windows?: string; salons?: Record<string, unknown>[] };
      expect(months.windows, "read_reviews gave no L3, L6 or YTD").toContain("L3 = last 3 FULL months");
      expect(months.salons).toHaveLength(1);
      expect(months.salons![0]).toMatchObject({ l3: 6, l6: 6, ytd: 7 });
    },
  },
];

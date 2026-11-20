import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A MONTH OR PERIOD THE MANAGER NAMES READS THE MONTH-BY-MONTH FIGURES (QA's code audit on 9e1d1f67, 20 Nov 2026)
 * ============================================================================
 *
 * "how many reviews did Kearney get last month?", "in October" and "last 2 months" matched nothing in MONTHS_PERIOD, so
 * the chat block and the loop's read_reviews gave only this month to date, and the model had no figure for the month
 * asked. Any month or period the manager names now reads the Google Reviews page's month-by-month figures, in both.
 * CLAUDE.md §5: anything a manager can ask about must be readable by the AI.
 */

const FLAG = "GOOGLE_REVIEWS_IN_CHAT_ENABLED";
const REPORT = "QA's code audit on 9e1d1f67 (20 Nov 2026): a named month or period (\"last month\", \"in October\", \"last 2 months\") gave only this month to date";
const QUESTIONS = [
  ["last-month", "how many reviews did Kearney get last month?"],
  ["october", "how many Google reviews did Kearney get in October?"],
  ["last-2-months", "how many Google reviews did Kearney get the last 2 months?"],
] as const;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.reviewsOnFile!();
  return t.thread();
}

export const NOV20_GOOGLE_REVIEWS_NAMED_PERIODS_CASES: ReplayCase[] = QUESTIONS.flatMap(([key, question]): ReplayCase[] => [
  {
    id: `nov20-google-reviews-named-period-${key}`,
    title: `"${question}": the chat block gives the month-by-month figures, so October (and the months before) are there`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      await start(t).say(question);
      const data = t.lastReportData?.() ?? "";
      expect(data, "the month asked about was not given, only this month to date").toContain("GOOGLE REVIEWS — L3, L6, YTD AND MONTH BY MONTH");
    },
  },
  {
    id: `nov20-google-reviews-named-period-${key}-agent-loop`,
    title: `the tool loop: "${question}" (read_reviews with no period): read_reviews returns the month-by-month figures`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view: LoopView) => (lastResult(view, "read_reviews") ? { text: "Here is what the app shows." } : { tool: "read_reviews", input: {} }));
      t.loopModel!(model);
      await thread.say(question);
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_reviews")).at(-1)?.output ?? {};
      const months = (output.months ?? {}) as { salons?: { by_month?: Record<string, unknown> }[] };
      expect(months.salons?.[0]?.by_month, "read_reviews gave no month-by-month figures for the month asked").toBeTruthy();
    },
  },
]);

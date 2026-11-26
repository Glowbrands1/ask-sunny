import { expect, vi } from "vitest";

import { AI_READABLE_PAGES, readablePagesLine } from "@/config/ai-readable-pages";
import { __setDataToolDepsForTests } from "@/lib/ai/agent-loop/data-tools";
import type { LoadReportBriefingInput, ReportBriefing } from "@/lib/reporting/read/report-briefing";
import type { ReportFamilyId } from "@/lib/reporting/read/report-families";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BED USAGE, SPA ENGAGEMENT AND SPA WELLNESS REACH THE MODEL (board f039, part 2; CLAUDE.md §5)
 * ============================================================================
 *
 * The three bed and spa report pages were `notReadable`: read_stats named only Daily Stats, Sales Totals and Comp, so
 * no description told the model it could ask. read_stats now takes each by name (its own report family, under the
 * pages' View reports gate and the manager's own salons). These cases ask in a manager's words through the real chat
 * route with production's flags, and assert the report asked for is read for the manager's own salons only and its
 * figures reach the model. The report reads need tables the harness does not hold, so the briefing is scripted: it
 * records what it was asked for and returns figures for that report.
 */
const REPORT = "Pau, 20 Nov 2026: \"how can we program this AI to read new things added to the app? i need to always say it?\" (board f039: the bed and spa reports)";
const FLAG = "AGENT_LOOP_ENABLED";

const FIGURES: Partial<Record<ReportFamilyId, string>> = {
  "bed-usage": "BED USAGE — month to date\nKearney: total tans 1,204; beds 12; tans per bed 100.3 (chain 88.1).",
  "spa-engagement": "SPA ENGAGEMENT — month to date\nKearney: spa sessions 310; unique tanners 640; unique spa tanners 122; sessions per bed 51.7.",
  "spa-wellness": "SPA WELLNESS — month to date, year to date, last twelve months\nKearney: Red light sessions MTD 88 (peers 74); YTD 1,010; LTM 1,102.",
};

async function ask(t: ReplayContext, report: string, words: string) {
  vi.setSystemTime(new Date("2026-11-26T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const asked: LoadReportBriefingInput[] = [];
  __setDataToolDepsForTests({
    loadReportBriefing: async (input) => {
      asked.push(input);
      return {
        text: input.families.map((family) => FIGURES[family] ?? "").join("\n\n"),
        requested: input.families,
        present: input.families,
        missing: [],
        periodIntent: null,
        periods: {},
        freshness: [],
      } as ReportBriefing;
    },
    readBreakdown: async () => null,
  });
  const model = loopStandIn((view: LoopView) => (lastResult(view, "read_stats") ? { text: "Here is what the report shows." } : { tool: "read_stats", input: { report, question: words } }));
  t.loopModel!(model);
  try {
    await t.thread().say(words);
  } finally {
    __setDataToolDepsForTests(null);
  }
  const output = (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_stats")).at(-1)?.output ?? {}) as Record<string, unknown>;
  return { model, output, asked };
}

function reportCase(id: string, title: string, report: string, family: ReportFamilyId, source: string, words: string): ReplayCase {
  return {
    id,
    title: `"${words}": read_stats reads the ${title} report for the manager's own salons, and its figures reach the model; the rules name the page`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { model, output, asked } = await ask(t, report, words);
      expect(model.views[0]?.system, "the readable-pages line is not in what the model is given").toContain(readablePagesLine(AI_READABLE_PAGES)!);
      expect(model.views[0]?.system).toContain(`${title} (read_stats)`);
      expect(output.refused, JSON.stringify(output)).toBeUndefined();
      expect(output.error, JSON.stringify(output)).toBeUndefined();
      expect(output.source).toBe(source);
      expect(asked.at(-1)?.families, "read_stats read another report").toEqual([family]);
      // KEARNEY is salon 0309 alone: the report is read for it, never unrestricted.
      expect(asked.at(-1)?.scope, "read_stats read more than the manager's own salons").toMatchObject({ unrestricted: false, salonNumbers: ["0309"] });
      expect(JSON.stringify(output.figures), `the ${title} figures did not reach the model`).toContain(FIGURES[family]!.split("\n")[1]!.slice(0, 30));
    },
  };
}

export const NOV26_F039_BED_SPA_REPORTS_CASES: ReplayCase[] = [
  reportCase("nov26-f039-bed-usage-reaches-the-model", "Bed Usage", "bed usage", "bed-usage", "Bed Usage report", "how many tans per bed are we doing this month?"),
  reportCase("nov26-f039-spa-engagement-reaches-the-model", "Spa Engagement", "spa engagement", "spa-engagement", "Spa Engagement report", "how is our spa engagement this month?"),
  reportCase("nov26-f039-spa-wellness-reaches-the-model", "Spa Wellness", "spa wellness", "spa-wellness", "Spa Wellness report", "what does the spa wellness report say for my salon year to date?"),
];

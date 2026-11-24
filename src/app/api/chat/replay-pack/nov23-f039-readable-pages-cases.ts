import { expect, vi } from "vitest";

import { readablePagesLine, AI_READABLE_PAGES } from "@/config/ai-readable-pages";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE PAGES THE AI CAN READ REACH THE MODEL (board f039, QA approved 23 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * Pau, 20 Nov 2026: "how can we program this AI to read new things added to the app? i need to always say it?" The
 * page list (`src/config/ai-readable-pages.ts`) writes the rules book's line naming every page the AI can read and the
 * tool for each. This case runs the real chat route with production's flags and asserts that line is in what the model
 * is given, and that a manager asking about one of those pages, in a manager's words, reaches its tool with their scope.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau, 20 Nov 2026: \"how can we program this AI to read new things added to the app? i need to always say it?\" (board f039)";
const ASK = "what does the sales totals page say for my salon";

export const NOV23_F039_READABLE_PAGES_CASES: ReplayCase[] = [
  {
    id: "nov23-f039-readable-pages-reach-the-model",
    title: `"${ASK}": the rules the model is given name every page it can read (from the page list), and Sales Totals is read through read_stats with the manager's scope`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-23T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view: LoopView) =>
        lastResult(view, "read_stats") ? { text: "Here is what the Sales Totals page shows." } : { tool: "read_stats", input: { report: "sales totals", question: ASK } });
      t.loopModel!(model);
      await t.thread().say(ASK);

      const line = readablePagesLine(AI_READABLE_PAGES)!;
      expect(model.views[0]?.system, "the readable-pages line is not in what the model is given").toContain(line);
      for (const page of AI_READABLE_PAGES.filter((entry) => entry.kind === "page" && entry.reader && !entry.route.includes("["))) {
        expect(line, `${page.title} is readable but not named to the model`).toContain(page.title);
      }
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_stats")).at(-1)?.output ?? {};
      expect(output.source, "read_stats was not reached for the Sales Totals page").toBe("Sales Totals report");
      expect(output.refused, "the manager's own salon was refused").toBeUndefined();
    },
  },
];

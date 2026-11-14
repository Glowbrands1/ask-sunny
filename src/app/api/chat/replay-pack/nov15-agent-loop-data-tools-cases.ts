import { expect, vi } from "vitest";

import { OUTSIDE_ACCESS } from "@/lib/ai/agent-loop/data-tools";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE AGENT LOOP'S APP DATA TOOLS, THROUGH THE REAL CHAT ROUTE (QA, 15 Nov 2026)
 * ============================================================================
 *
 * read_reviews and read_stats (`lib/ai/agent-loop/data-tools.ts`), registered in the loop's tool list. The scope is
 * enforced inside the tools: these cases hold it end to end, with the signed-in manager's own scope from the route.
 * Pau's two questions are his own words. The loop runs only for listed users, so on production's flags these cases
 * list this case's manager (`t.loopModel`).
 *
 * WHAT THESE PROVE, AND WHAT THEY DO NOT. The replay pack's fake database holds no Google review or report rows, so
 * here both tools answer "could not be read" / "no report figures" for an in-scope salon. These cases prove the hook
 * (the tools are reached through the real route, with the signed-in manager's scope) and the refusals end to end; the
 * figures each scope sees (primary + additional, a named own salon, a global admin's all-salons summary, rankings) are
 * proven against scripted rows in `lib/ai/agent-loop/data-tools.test.ts`.
 */
const PAU_REVIEWS = "How many google reviews do we have this far";
const PAU_DAILY = "Show me the most recent Daily Stats and what I need to focus on today";
const REPORT = "QA, 15 Nov 2026: the agent loop's app data tools (Pau's scope rules)";
const FLAG = "AGENT_LOOP_ENABLED";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
/** Salons outside the Kearney manager's access. */
const OTHERS = /Wornall|Grand Island|Lincoln|Omaha|Liberty|Manhattan|Shawnee|Lawrence|Overland|St Joseph/;

/** One tool call with this input, then a reply; the views the model saw, for the tool's result. */
function oneCall(t: ReplayContext, tool: string, input: Record<string, unknown>) {
  const model = loopStandIn((view: LoopView) => (lastResult(view, tool) ? { text: "Here is what the app shows." } : { tool, input }));
  t.loopModel!(model);
  return () => model.views.flatMap((view) => view.results.filter((result) => result.tool === tool)).at(-1)?.output ?? {};
}

function start(t: ReplayContext, scope: unknown = KEARNEY, role = "salon_director") {
  vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
  t.directory(STAFF);
  t.as(role, scope);
  return t.thread();
}

export const NOV15_AGENT_LOOP_DATA_TOOLS_CASES: ReplayCase[] = [
  {
    id: "nov15-agent-loop-reviews-own-salons-only",
    title: `Pau: "${PAU_REVIEWS}" for a salon manager: read_reviews is reached through the loop with their scope, and nothing about another salon reaches the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const result = oneCall(t, "read_reviews", {});
      await thread.say(PAU_REVIEWS);
      const output = result();
      expect(output.source, "read_reviews was not reached through the loop").toBe("Google Reviews page");
      expect(output.refused, "the manager's own salon was refused").toBeUndefined();
      expect(JSON.stringify(output), "another salon reached the model").not.toMatch(OTHERS);
    },
  },
  {
    id: "nov15-agent-loop-reviews-outside-salon-refused",
    title: "a salon manager asking about a salon outside their access: read_reviews refuses, and reads nothing about it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const result = oneCall(t, "read_reviews", { salon: "Wornall" });
      await thread.say("how many google reviews does wornall have");
      expect(result()).toEqual({ source: "Google Reviews page", refused: OUTSIDE_ACCESS });
    },
  },
  {
    id: "nov15-agent-loop-daily-stats-own-salons",
    title: `Pau: "${PAU_DAILY}" for a salon manager: read_stats is reached through the loop with their scope, and nothing about another salon reaches the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const result = oneCall(t, "read_stats", { report: "daily stats", question: PAU_DAILY });
      await thread.say(PAU_DAILY);
      const output = result();
      expect(output.source, "read_stats was not reached through the loop").toBe("Daily Stats");
      expect(output.refused, "the manager's own salon was refused").toBeUndefined();
      expect(JSON.stringify(output), "another salon reached the model").not.toMatch(OTHERS);
    },
  },
  {
    id: "nov15-agent-loop-stats-outside-salon-refused",
    title: "a salon manager asking for another salon's Sales Totals: read_stats refuses, and no report is read",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const result = oneCall(t, "read_stats", { report: "sales totals", salon: "Overland Park" });
      await thread.say("what were overland park's sales totals yesterday");
      expect(result()).toEqual({ source: "Sales Totals report", refused: OUTSIDE_ACCESS });
    },
  },
  {
    id: "nov15-agent-loop-daily-stats-global-admin-all",
    title: `Pau: "${PAU_DAILY}" for a global admin: read_stats is reached, never refused, and the reply never asks "which salon?"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t, GLOBAL, "admin");
      const result = oneCall(t, "read_stats", { report: "daily stats", question: PAU_DAILY });
      const reply = await thread.say(PAU_DAILY);
      const output = result();
      expect(output.refused, "a global admin was refused").toBeUndefined();
      expect(reply.content, "a global admin was asked which salon").not.toMatch(/which salon/i);
    },
  },
];

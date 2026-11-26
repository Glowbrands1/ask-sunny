import { expect, vi } from "vitest";

import { AI_READABLE_PAGES, readablePagesLine } from "@/config/ai-readable-pages";
import { WHATS_NEW } from "@/config/whats-new";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "WHAT'S NEW IN SUNNY?" IS ANSWERED FROM THE WHAT'S NEW PAGE (Pau, 26 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * The What's New page (`/whats-new`) lists recent updates from `src/config/whats-new.ts`; the AI reads the same list
 * through read_whats_new, scoped as the page is: an entry about a page only for a role that may open that page. These
 * cases run the real chat route with production's flags, ask in a manager's words, and assert the entries reach the
 * model: a Salon Director gets every update they may open and not the administrators' Employee Directory one; an
 * administrator gets that one too.
 */
const REPORT = "Pau, 26 Nov 2026: a What's New page of recent updates, and \"what's new in Sunny?\" answered from it (CLAUDE.md §5)";
const FLAG = "AGENT_LOOP_ENABLED";
const ASK = "what's new in Sunny?";
const ADMIN_ONLY = "Employee address in the Employee Directory";

type Update = { date: string; title: string; what: string; page?: string };

async function ask(t: ReplayContext, words: string, input: Record<string, unknown> = {}) {
  vi.setSystemTime(new Date("2026-11-26T16:00:00Z"));
  const model = loopStandIn((view: LoopView) => (lastResult(view, "read_whats_new") ? { text: "Here's what's new." } : { tool: "read_whats_new", input }));
  t.loopModel!(model);
  await t.thread().say(words);
  const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_whats_new")).at(-1)?.output as
    | { updates?: Update[]; refused?: string; error?: string }
    | undefined;
  return { model, output };
}

export const NOV26_WHATS_NEW_CASES: ReplayCase[] = [
  {
    id: "nov26-whats-new-reaches-the-model",
    title: `"${ASK}" (a Salon Director): read_whats_new gives the model the What's New page's updates, newest first, and not the administrators' Employee Directory update; the rules name the page`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const { model, output } = await ask(t, ASK);
      expect(model.views[0]?.system, "the readable-pages line is not in what the model is given").toContain(readablePagesLine(AI_READABLE_PAGES)!);
      expect(model.views[0]?.system).toContain("What's New (read_whats_new)");
      expect(output?.refused, JSON.stringify(output)).toBeUndefined();
      const titles = (output?.updates ?? []).map((update) => update.title);
      for (const title of ["What's New", "Missing fields explained at Finalize", "Google Reviews leaderboard by period", "Notifications bar"]) {
        expect(titles, `${title} did not reach the model`).toContain(title);
      }
      expect(titles, "an administrators-only update reached a Salon Director").not.toContain(ADMIN_ONLY);
      expect(output?.updates?.[0]?.date, "newest first").toBe("Nov 26, 2026");
      const missing = output!.updates!.find((update) => update.title === "Missing fields explained at Finalize")!;
      expect(missing.what).toBe(WHATS_NEW.find((entry) => entry.title === missing.title)!.description);
    },
  },
  {
    id: "nov26-whats-new-admin-and-since",
    title: `"any new features this week?" (an administrator): the Employee Directory update reaches the model, and since keeps only that week's updates`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      t.directory(STAFF);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      const { output } = await ask(t, "any new features this week?", { since: "2026-11-25" });
      const titles = (output?.updates ?? []).map((update) => update.title);
      expect(titles).toContain(ADMIN_ONLY);
      expect(titles).toContain("Create a form from this conversation");
      expect(titles, "an update from before the 25th was given for this week").not.toContain("Google Reviews leaderboard by period");
    },
  },
];

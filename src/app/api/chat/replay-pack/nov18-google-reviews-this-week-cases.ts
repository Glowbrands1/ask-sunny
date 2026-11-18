import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "HOW MANY GOOGLE REVIEWS DID WE GET THIS WEEK?" IS ANSWERED FROM THE GOOGLE REVIEWS PAGE (PORT FROM ASK BUBBLES)
 * ============================================================================
 *
 * QA, 18 Nov 2026, production in the sibling app's main chat: the question got "I don't have report figures like
 * review counts", while its Google Reviews page has the figures. This app has the same gap on the path most managers
 * take (the agent loop runs only for listed users): GOOGLE_REVIEWS_IN_CHAT_ENABLED is not on in production, so the
 * prompt says "You have NO report figures for this question", which that reply repeats. With it on, the answering
 * model is given this reporting week and last (Sunday to Saturday, Central, the page's own weeks) for every salon the
 * page shows, and is told never to say it has no figures. The loop's read_reviews returns the same weeks.
 *
 * The invariants are on what the answering model was given, not on its words. The page's reads are the harness's fixed
 * figures (`t.reviewsOnFile()`): 15 listings, 2 reviews each this week.
 */

const QUESTION = "How many Google reviews did we get this week?";
const FLAG = "GOOGLE_REVIEWS_IN_CHAT_ENABLED";
const REPORT = `QA, 18 Nov 2026 (production, the sibling app's main chat): "${QUESTION}" answered "I don't have report figures like review counts"`;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.reviewsOnFile!();
  return t.thread();
}

export const NOV18_GOOGLE_REVIEWS_THIS_WEEK_CASES: ReplayCase[] = [
  {
    id: "nov18-google-reviews-this-week",
    title: `"${QUESTION}": the model is given this reporting week and last from the Google Reviews page, and no "no report figures" rule`,
    report: REPORT,
    status: { open: `${FLAG} is not on in production: set it to 1 in Vercel, then list it in production-flags.json and mark this case fixed` },
    fixFlags: [FLAG],
    async run(t) {
      await start(t).say(QUESTION);
      const system = t.lastSystem?.() ?? "";
      const data = t.lastReportData?.() ?? "";
      expect(system, "the prompt told the model it has no report figures").not.toContain("You have NO report figures for this question");
      expect(data).toContain("GOOGLE REVIEWS — THIS REPORTING WEEK AND LAST");
      expect(data).toContain("This week: Sun, Nov 15 – Sat, Nov 21");
      expect(data).toContain("All 15 salons together: this week 30 reviews (30 qualifying); last week 60 reviews (45 qualifying).");
      expect(data).toContain("(store 143, this manager's salon): this week 2 reviews (2 qualifying)");
      expect(data).toContain("Never say you have no Google review figures");
    },
  },
  {
    id: "nov18-google-reviews-this-week-agent-loop",
    title: `the tool loop: "${QUESTION}": read_reviews returns this reporting week and last, every rating and qualifying, with the weeks named`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view: LoopView) => (lastResult(view, "read_reviews") ? { text: "Here is what the app shows." } : { tool: "read_reviews", input: {} }));
      t.loopModel!(model);
      await thread.say(QUESTION);
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_reviews")).at(-1)?.output ?? {};
      expect(output.source, "read_reviews was not reached through the loop").toBe("Google Reviews page");
      const salons = (output.salons ?? []) as Record<string, unknown>[];
      expect(salons).toHaveLength(1);
      expect(salons[0]).toMatchObject({ this_week: 2, this_week_all_ratings: 2, last_week: 3, last_week_all_ratings: 4 });
      expect(output.weeks).toContain("this week opened Sunday 2026-11-15");
    },
  },
];

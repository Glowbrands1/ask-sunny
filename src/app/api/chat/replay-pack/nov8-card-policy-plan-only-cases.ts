import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN UNDER-PERFORMANCE CA'S ACTION PLAN NAMES ONLY THE CARD'S POLICY (QA, 8 Nov 2026)
 * ============================================================================
 *
 * QA's replays of 1f5850e6 (2/4), and 3/64 such replies before flip 7: "put together a corrective action for <A> due to
 * under performance in salon metrics for the month of october" gave "**Policy:** Standards of Conduct" but an Action
 * Plan to "review the Standards of Conduct and Evaluations and Raises policies", and a second source, "Evaluations and
 * Raises" p.34. It is intermittent: a model reading picks the second section. Offline, the stand-in models never pick
 * it, so this case is a guard: the pinned manual also has "Evaluations and Raises" p.34 (`manualAlsoHas`), and the
 * plan and the sources still name only Standards of Conduct, with CARD_POLICY_PLAN_ONLY_ENABLED on and off. The bad
 * shape itself is in `ai/card-policy-plan-only.test.ts`. The person is invented.
 */
const SAID = "put together a corrective action for Rowan Kestrel due to under performance in salon metrics for the month of october";
const EVALUATIONS = {
  chunkIndex: 900,
  chunkId: "jba-900",
  locator: "Page 34 — Evaluations and Raises",
  page: 35,
  content:
    "Evaluations and Raises\nEmployees are entitled to a review and potential raises at least annually. The Company cannot\npromise or guarantee that raises will occur as raises are based upon several factors including but\nnot limited to: Employee performance, location performance, and overall company\nperformance.",
  section: "Evaluations and Raises",
  printedPage: 34,
  sections: [{ page: 34, heading: "Evaluations and Raises" }],
};

async function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([EVALUATIONS]);
  return t.thread();
}

export const NOV8_CARD_POLICY_PLAN_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov8-card-policy-plan-only-under-performance",
    title: "\"… due to under performance in salon metrics …\", the manual also has Evaluations and Raises: the plan and sources name only Standards of Conduct",
    report: "QA, 8 Nov 2026 (1f5850e6; the tester's conv_mw6ttvot2lu0m65): a second retrieved section in the Action Plan and the sources",
    status: "fixed",
    fixFlags: ["CARD_POLICY_PLAN_ONLY_ENABLED"],
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say(SAID);
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      expect(reply.content, `the card's Policy line:\n${reply.content}`).toMatch(/^\*\*Policy:\*\* Standards of Conduct/m);
      expect(reply.content, `a second section in the reply:\n${reply.content}`).not.toMatch(/Evaluations and Raises/i);
      const sources = ((reply as { citations?: { excerpt?: string; locator?: string }[] }).citations ?? []).map((c) => `${c.locator ?? ""} ${c.excerpt ?? ""}`);
      expect(sources.filter((source) => /Evaluations and Raises/i.test(source)), "a second source").toEqual([]);
    },
  },
];

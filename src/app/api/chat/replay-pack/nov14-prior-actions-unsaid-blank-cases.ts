import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PRIOR_ACTIONS_UNSAID_BLANK — AN UNSAID HISTORY STAYS BLANK AT CREATE (QA's Bubbles 17x live test, 14 Nov 2026)
 * ============================================================================
 *
 * QA's 17x live test: at Create, prior_actions was AI-filled "None — first occurrence" though the card had said it
 * would not guess ("You'll set any prior coaching or corrective action on the form — I won't guess at it"). With
 * PRIOR_ACTIONS_UNSAID_BLANK_ENABLED a "None" line stands only where the manager said this is the first occurrence.
 * The drafting model's value is QA's; the person is invented.
 */
const FLAG = "PRIOR_ACTIONS_UNSAID_BLANK_ENABLED";
const REPORT = "Ported from the sibling app (QA's Bubbles 17x live test, 14 Nov 2026); invented person";

async function createdPriorActions(t: ReplayContext, turn: string): Promise<{ reply: string; prior: string }> {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] });
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  t.draftWrites({ observation: "Remy Calder was 20 minutes late for her shift on 11/3/26.", prior_actions: "None — first occurrence" });
  const id = await thread.create();
  return { reply, prior: t.values(id).prior_actions ?? "" };
}

export const NOV14_PRIOR_ACTIONS_UNSAID_BLANK_CASES: ReplayCase[] = [
  {
    id: "nov14-prior-actions-unsaid-blank-at-create",
    title: `"verbal ca for remy calder, she was late on 11/3/26. no payroll deduct" — Create leaves Prior Actions blank`,
    report: REPORT,
    status: { open: `Prior Actions is saved as "None — first occurrence" though nothing was said about history` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, prior } = await createdPriorActions(t, "verbal ca for remy calder, she was late on 11/3/26. no payroll deduct");
      expect(prior, `Prior Actions was filled:\n${reply}`).toBe("");
    },
  },
];

export const NOV14_PRIOR_ACTIONS_UNSAID_BLANK_GUARDS: ReplayCase[] = [
  {
    id: "nov14-prior-actions-unsaid-blank-guard-first-time-said",
    title: `"create ca for remy calder she was late on 11/3/26, verbal warning, first time" — Create keeps "None — first occurrence"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, prior } = await createdPriorActions(
        t,
        "create ca for remy calder she was late on 11/3/26, verbal warning, first time. no payroll deduct",
      );
      expect(prior, `the stated first occurrence was lost:\n${reply}`).toBe("None — first occurrence");
    },
  },
];

import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * NEGATED_FIRST_TIME_NOT_NONE — "NOT HER FIRST TIME" IS NEVER "NONE — FIRST OCCURRENCE" (QA, 14 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app (Gate-Bubbles-3's #888 follow-up, QA: high). The same reader here (main af04c58c). "this isn't the first time she's been late" read as a first
 * occurrence, so Create saved Prior Actions "None — first occurrence" though the drafter wrote nothing: a clean
 * history the manager denied. With NEGATED_FIRST_TIME_NOT_NONE_ENABLED it stays blank. Invented person.
 */
const FLAG = "NEGATED_FIRST_TIME_NOT_NONE_ENABLED";
const REPORT = "Ported from the sibling app (Gate-Bubbles-3's #888 follow-up, QA 14 Nov 2026); invented person";

async function createdPriorActions(t: ReplayContext, turn: string): Promise<{ reply: string; prior: string }> {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] });
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  t.draftWrites({ observation: "Marnie Holloway was 20 minutes late for her shift on 11/3/26." });
  const id = await thread.create();
  return { reply, prior: t.values(id).prior_actions ?? "" };
}

export const NOV14_NEGATED_FIRST_TIME_CASES: ReplayCase[] = [
  "verbal ca for marnie holloway, she was late on 11/3/26. no payroll deduct. this isn't the first time she's been late",
  "verbal ca for marnie holloway, she was late on 11/3/26. no payroll deduct. not her first time",
].map((turn, index) => ({
  id: `nov14-negated-first-time-${index + 1}`,
  title: `"${turn}" — Prior Actions is never "None — first occurrence"`,
  report: REPORT,
  status: { open: `Create saves "None — first occurrence" for a history the manager denied` },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, prior } = await createdPriorActions(t, turn);
    expect(prior, `a clean history was stated:\n${reply}`).not.toMatch(/^none\b/i);
  },
}));

export const NOV14_NEGATED_FIRST_TIME_GUARDS: ReplayCase[] = [
  {
    id: "nov14-negated-first-time-guard-first-time-said",
    title: `"verbal ca for marnie holloway, she was late on 11/3/26. no payroll deduct. first time" — Create keeps "None — first occurrence"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, prior } = await createdPriorActions(t, "verbal ca for marnie holloway, she was late on 11/3/26. no payroll deduct. first time");
      expect(prior, `the stated first occurrence was lost:\n${reply}`).toBe("None — first occurrence");
    },
  },
];

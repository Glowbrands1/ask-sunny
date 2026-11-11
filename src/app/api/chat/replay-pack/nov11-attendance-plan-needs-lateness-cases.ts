import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * NO LATENESS SAID, NO LATENESS PLAN (ported from Ask Bubbles: QA's prod-env reading and ruling, 11 Nov 2026; ATTENDANCE_PLAN_NEEDS_LATENESS_ENABLED)
 * ============================================================================
 *
 * `corrective-action-dm-feedback-e2e.test.ts` B1: "create ca form for <name> for violating attendance policy on
 * 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching" saved Pau's attendance plan — "<name> is
 * expected to arrive on time for all scheduled shifts … Continued lateness will result …" — though no lateness was
 * described. QA's control: "she was late on 10/20/26" keeps Pau's plan. The person is invented.
 */
const TESS: DirectoryRow = { id: "e-tess-varga-att", firstName: "Tess", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const B1 = "create ca form for tess varga for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching";
const LATE = "create ca form for tess varga for violating attendance policy, she was late on 10/20/26. verbal. no payroll deduct.";
const FIX = ["ATTENDANCE_PLAN_NEEDS_LATENESS_ENABLED"];
const REPORT = "QA's prod-env reading (11 Nov 2026): an Attendance CA with no lateness described saved the lateness plan";
const LATENESS_PLAN = /arrive on time|Continued lateness/i;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF, TESS]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

async function savedPlan(t: ReplayContext, said: string) {
  const thread = start(t);
  const card = await thread.say(said);
  expect(card.content, `the card does not cite Attendance:\n${card.content}`).toMatch(/\*\*Policy:\*\* Attendance/);
  t.draftWrites({ observation: "Observed:\nTess Varga violated the attendance policy on October 20, 2026." });
  const id = await thread.create();
  return t.values(id).action_plan ?? "";
}

export const NOV11_ATTENDANCE_PLAN_NEEDS_LATENESS_CASES: ReplayCase[] = [
  {
    id: "nov11-attendance-plan-no-lateness-said",
    title: "B1 \"… for violating attendance policy on 10-20-26 …\", then Create: the saved Action Plan states no lateness",
    report: REPORT,
    status: { open: "the saved Action Plan is \"Tess is expected to arrive on time … Continued lateness …\"" },
    fixFlags: FIX,
    async run(t) {
      const saved = await savedPlan(t, B1);
      expect(saved, "the saved Action Plan states a lateness nobody described").not.toMatch(LATENESS_PLAN);
    },
  },
  {
    id: "nov11-attendance-plan-lateness-said",
    title: "control: \"… she was late on 10/20/26 …\", then Create: Pau's attendance plan is saved",
    report: `${REPORT} (QA's control)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const saved = await savedPlan(t, LATE);
      expect(saved, "the lateness account lost Pau's plan").toMatch(/Tess is expected to arrive on time for all scheduled shifts/);
    },
  },
];

import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PLAIN "LATE" IS ATTENDANCE ON THE REPLY, THE CARD AND THE PLAN ALIKE (QA, Sunny live r22 + r26, dpl_7Uakw6iR, 11 Nov 2026)
 * ============================================================================
 *
 * "create a CA for <roster person, typed lowercase>, she was late on 11/3/26", sent three times: once the reply said
 * "Policy: Attendance — read from this request." while the card had no policy line, its Action Plan said "Management will
 * review the Late Opening policy with <first>…" and the only source was Late Opening p.15. Cause: the reply reads the
 * policy from the manager's words (LATE_READS_ATTENDANCE), the card from the slot model's heading, which sometimes is
 * "Late Opening". Not the lowercase name, not retrieval. LATE_CARD_AGREES_ENABLED puts the card on the reply's reading.
 * The person is invented; a late opening and a no-show keep their policies.
 */
const ODETTE: DirectoryRow = {
  id: "e-odette-ravensworth",
  firstName: "Odette",
  lastName: "Ravensworth",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const SAID = "create a CA for odette ravensworth, she was late on 11/3/26";
const REPORT = "QA, Sunny live r22 + r26 (dpl_7Uakw6iR), 11 Nov 2026: 1 of 3 runs, the reply read Attendance and the card Late Opening";

async function card(t: ReplayContext, said: string, heading: string) {
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  t.directory([...STAFF, ODETTE]);
  t.as("salon_director", KEARNEY);
  t.slotsRead({ employee: "odette ravensworth", formType: "Corrective Action Form", formTurn: true, policyHeading: heading });
  return (await t.thread().say(said)).content;
}

export const NOV11_LATE_CARD_AGREES_CASES: ReplayCase[] = [
  {
    id: "nov11-late-card-agrees-model-heading-late-opening",
    title: `"${SAID}", the slot model's heading Late Opening (as in the bad run): reply, card and plan all Attendance p.14`,
    report: REPORT,
    status: { open: "the reply reads Attendance; the card has no citation and the plan reviews the Late Opening policy" },
    fixFlags: ["LATE_CARD_AGREES_ENABLED"],
    async run(t) {
      const content = await card(t, SAID, "Late Opening");
      expect(content, content).toMatch(/\*\*Policy:\*\* Attendance — read from this request/);
      expect(content, content).toMatch(/Attendance Policy, JBA Policy Manual p\.14/);
      expect(content, content).toMatch(/review the Attendance policy with Odette/);
      expect(content, content).not.toMatch(/Late Opening/);
    },
  },
  // Controls: the runs that went right, and the cases the flag must leave alone.
  ...(
    [
      ["model-heading-attendance", SAID, "Attendance", /review the Attendance policy with Odette/],
      ["late-opening-stays", "create a CA for odette ravensworth, she was late opening the salon on 11/3/26", "Late Opening", /Late Opening/],
    ] as const
  ).map(
    ([id, said, heading, expected]): ReplayCase => ({
      id: `nov11-late-card-agrees-control-${id}`,
      title: `control: "${said}" (model heading ${heading}) reads the same with LATE_CARD_AGREES on`,
      report: `${REPORT} (controls)`,
      status: "fixed",
      fixFlags: ["LATE_CARD_AGREES_ENABLED"],
      async run(t) {
        const content = await card(t, said, heading);
        expect(content, content).toMatch(expected);
      },
    }),
  ),
];

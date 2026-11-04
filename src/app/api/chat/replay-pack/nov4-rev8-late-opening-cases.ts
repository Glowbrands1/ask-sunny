import { expect } from "vitest";

import { STAFF, KEARNEY, type ReplayCase } from "./cases";

/**
 * Corrective Action revision 8 (4 Nov 2026; the sibling app's revision 7 cases,
 * ported): a Late Opening the manager names — or describes — is cited under
 * the Attendance Policy box, which replaced Tardiness/Leaving Early. Reported
 * from this app's revision 8 port (QA, 4 Nov 2026): a named "Late Opening"
 * lost its Attendance box. The box must stay ticked and Policy Violated must
 * read "Attendance Policy — Late Opening".
 */
export const NOV4_REV8_LATE_OPENING_CASES: readonly ReplayCase[] = [
  {
    id: "nov4-rev8-named-late-opening-keeps-attendance",
    title: "a CA naming the Late Opening policy keeps the Attendance Policy box (revision 8)",
    report: "QA, 4 Nov 2026 (this app's revision 8 port): a named or card \"Late Opening\" lost its Attendance box",
    status: "fixed",
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a verbal CA for Remy Calder for violating the late opening policy on 11-2-26. payroll deduct no");
      expect(thread.proposal, "no CA card for Remy Calder").toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      t.draftWrites({ observation: "Observed:\nRemy Calder did not open the salon on time on November 2, 2026." });
      const id = await thread.create();
      expect(t.checked(id).offense_type ?? [], "the Attendance Policy box is not ticked").toContain("attendance_policy");
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated").toBe("Attendance Policy — Late Opening");
      expect(values.policy_language ?? "", "Direct policy does not cite Late Opening").toMatch(/Late Opening/);
    },
  },
  {
    id: "nov4-rev8-described-late-opening-keeps-attendance",
    title: "a CA for opening the salon late keeps the Attendance Policy box (revision 8)",
    report: "QA, 4 Nov 2026 (this app's revision 8 port)",
    status: "fixed",
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      t.draftWrites({ observation: "Observed:\nRemy Calder was late to opening this morning." }, { offense_type: ["attendance_policy"] });
      const id = await thread.create();
      expect(t.checked(id).offense_type ?? [], "the Attendance Policy box is not ticked").toContain("attendance_policy");
      expect(t.values(id).policy_violated ?? "", "Policy Violated has no Attendance Policy").toMatch(/^Attendance Policy/);
    },
  },
];

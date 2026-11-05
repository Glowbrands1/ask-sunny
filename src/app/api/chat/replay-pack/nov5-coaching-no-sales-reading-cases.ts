import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A COACHING FORM GETS NO SALES READING (QA's ruling, 5 Nov 2026, within
 * Pau's CA_SALES rule "sales/MSB Corrective Actions cite Standards of Conduct")
 * ============================================================================
 *
 * The flag classification of CA_SALES_POLICY_ENABLED (priority replay s11):
 * a Coaching Form for a cell-phone account, after a turn complaining about
 * the app ("sunny created a coaching form … and reflected it as
 * underperformance and should be retraining"), printed "Standards of Conduct
 * Policy, JBA Policy Manual p.12" beside the Cell Phone/Smart Watch Policy.
 * QA: (1) a Coaching Form does not get the sales reading; (2) a turn
 * complaining about the app is not an account of the employee. s11's shape;
 * the person is invented. With production's flags (CA_SALES off) it holds;
 * with CA_SALES on it failed before the fix.
 */

const BRISA: DirectoryRow = {
  id: "e-brisa-tollefsen",
  firstName: "Brisa",
  lastName: "Tollefsen",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function coachingNoSalesReadingPeople(): readonly DirectoryRow[] {
  return [BRISA];
}

export const NOV5_COACHING_NO_SALES_READING_CASES: ReplayCase[] = [
  {
    id: "nov5-coaching-cell-phone-no-sales-reading",
    title: "s11's shape: a Coaching Form for a cell-phone account cites only Cell Phone/Smart Watch p.19 — no \"Standards of Conduct … p.12\" from an earlier complaint about the app",
    report: "QA, 5 Nov 2026 (flag classification of CA_SALES_POLICY_ENABLED, priority replay s11)",
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-09-29T18:00:00Z"));
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create coaching form for brisa tollefsen who is a tanning consultant at kearney. on 9-29-26 brisa was out of dress code");
      await thread.say("sunny created a coaching form for an employee who was not in dress code and reflected it as underperformance and should be retraining");
      const reply = await thread.say("create a coaching form for kearney location tanning consultant, brisa tollefsen, who was talking on her cell phone for 25 minutes on 9-29-26 when customers were waiting to check in");
      expect(thread.proposal, `no Coaching Form card:\n${reply.content}`).toMatchObject({ templateKey: "coaching" });
      expect(reply.content, `the cell-phone account is not cited:\n${reply.content}`).toMatch(/Cell Phone\/Smart Watch Policy, JBA Policy Manual p\.19/);
      expect(reply.content, `the sales reading on a Coaching Form:\n${reply.content}`).not.toMatch(/Standards of Conduct/i);
      // The draft made from the card: no Standards of Conduct in any field either.
      t.draftWrites({ observation: "Observed:\nOn September 29, 2026, Brisa Tollefsen talked on her cell phone for 25 minutes while customers waited to check in." });
      const values = t.values(await thread.create());
      const draft = Object.entries(values).map(([key, value]) => `${key}: ${value}`).join("\n");
      expect(draft, `the sales reading on the Coaching Form's draft:\n${draft}`).not.toMatch(/Standards of Conduct/i);
    },
  },
];

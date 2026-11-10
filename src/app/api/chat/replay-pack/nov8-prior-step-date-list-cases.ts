import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "A VERBAL WARNING AND COACHING ON 9/8, 9/15 AND 9/25" IS FOUR PRIOR ACTIONS (QA round 5, Bubbles live, 7 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the employee invented): "hi, i need a performance corrective action for <name>, a tanning consultant.
 * she is under performance for september. she already received a verbal warning and coaching on 9/8/2026, 9/15/2026
 * and 9/25/2026. no payroll deduction applies. today's date is fine." Prior actions listed only "Coaching —
 * 09/08/2026". QA's ruling (8 Nov 2026): the verbal warning with no date, and a Coaching row for each date.
 * PRIOR_STEP_DATE_LIST_ENABLED (`forms/prior-actions.ts`).
 */

const TAMSIN: DirectoryRow = {
  id: "e-tamsin-vale-r5-prior",
  firstName: "Tamsin",
  lastName: "Vale",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const SAID =
  "hi, i need a performance corrective action for tamsin vale, a tanning consultant. she is under performance for september. she already received a verbal warning and coaching on 9/8/2026, 9/15/2026 and 9/25/2026. no payroll deduction applies. today's date is fine.";

export const NOV8_PRIOR_STEP_DATE_LIST_CASES: ReplayCase[] = [
  {
    id: "nov8-r5-prior-step-date-list",
    title: "\"already received a verbal warning and coaching on 9/8/2026, 9/15/2026 and 9/25/2026\": every coaching and the verbal are Prior actions",
    report: "QA round 5, the sibling app live 7 Nov 2026 18:56Z (ported)",
    // Changed on purpose (8 Nov 2026): fixed in production by PRIOR_STEP_DATE_LIST_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["PRIOR_STEP_DATE_LIST_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T18:56:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      const prior = /\*\*Prior actions:\*\*[^\n]*/.exec(reply.content)?.[0] ?? "";
      for (const row of ["Coaching — 09/08/2026", "Coaching — 09/15/2026", "Coaching — 09/25/2026", "Verbal warning"]) {
        expect(prior, `"${row}" is not in Prior actions:\n${reply.content}`).toContain(row);
      }
      expect(prior, `the verbal is given a date the manager did not tie to it:\n${reply.content}`).not.toMatch(/Verbal warning — /);
    },
  },
];

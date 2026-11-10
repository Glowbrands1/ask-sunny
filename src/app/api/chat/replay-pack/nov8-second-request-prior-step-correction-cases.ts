import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A CORRECTION OF A PRIOR STEP'S DATE IS NEVER A SECOND REQUEST (QA's Sunny round-5 gate, 8 Nov 2026)
 * ============================================================================
 *
 * The gate ran corrective-action-conversation-qa-e2e "Q6 corrections before the draft is created" with
 * SECOND_REQUEST_OWN_ACCOUNT on: "sorry, the verbal ca was on 9-2-26 not 9-1-26" names a form ("ca"), so it was read
 * as a new request with its own account and no policy, and the saved form's Offense Type became Standards of Conduct
 * instead of Attendance Policy. The step it names is the history line being corrected (`ai/remap-incident.ts`
 * `onlyAboutAPriorStep`). The test's chat word for word; the person is invented ("Tess Varga", on no directory).
 */
const TESS: DirectoryRow = {
  id: "e-tess-varga",
  firstName: "Tess",
  lastName: "Varga",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

export const NOV8_SECOND_REQUEST_PRIOR_STEP_CORRECTION_CASES: ReplayCase[] = [
  {
    id: "nov8-second-request-prior-step-correction",
    title: "Q6: \"… previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26\", three corrections, \"no payroll deduct\", Create: Attendance Policy, the corrected dates, one request",
    report: "QA's Sunny round-5 gate (8 Nov 2026): with SECOND_REQUEST_OWN_ACCOUNT on, \"sorry, the verbal ca was on 9-2-26 not 9-1-26\" was a new request and the form became Standards of Conduct",
    status: "fixed",
    fixFlags: ["SECOND_REQUEST_OWN_ACCOUNT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
      t.directory([...STAFF, TESS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26");
      await thread.say("actually make it verbal");
      await thread.say("the meeting was actually on 10-19-26");
      const corrected = await thread.say("sorry, the verbal ca was on 9-2-26 not 9-1-26");
      expect(corrected.content, `the correction did not move the verbal CA's date:\n${corrected.content}`).toMatch(/Verbal corrective action — (?:signed )?09\/02\/2026/);
      await thread.say("no payroll deduct");
      t.draftWrites({ observation: "Observed:\nTess Varga did not attend the monthly meeting on October 19, 2026." });
      const id = await thread.create();
      expect(t.checked(id).offense_type ?? [], "the Offense Type is not the Attendance Policy").toEqual(["attendance_policy"]);
      // The saved Date is not asserted here: the pack's Create saves today's date for this chat with and without the flag
      // (reported to QA separately); the e2e test checks the card's date. This case is about the second request.
      expect(t.values(id).prior_actions ?? "", "the corrected prior step").toMatch(/Verbal corrective action — (?:signed )?09\/02\/2026/);
    },
  },
];

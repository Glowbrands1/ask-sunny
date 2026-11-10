import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE DAY A STEP WAS GIVEN IS ALSO THE INCIDENT'S DAY (ported from Ask Bubbles: QA's prod-env reading there, 10 Nov 2026, D3;
 * INCIDENT_DATE_SHARED_WITH_STEP_ENABLED)
 * ============================================================================
 *
 * With production's flags, "write up <name>, i gave her a verbal on 10-21 for being late" and "ca for <name>,
 * she was late on 10-21 and i gave her a verbal on 10-21" left the card with no Date: 10-21 is the verbal's date, so it
 * was read as a prior step's only (CORRECTED_DATE_KEPT sets every step's date aside; the card's own reading skips it). The wording is the NEVER-BREAK rows' in
 * `forms/form-date-incident-only.test.ts`; the person is invented.
 */
const PERLA: DirectoryRow = {
  id: "e-perla-quist-d3",
  firstName: "Perla",
  lastName: "Quist",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const FIX = ["INCIDENT_DATE_SHARED_WITH_STEP_ENABLED"];
const REPORT = "QA's prod-env reading (10 Nov 2026, D3): the incident date dropped because a step was given the same day";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF, PERLA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV10_INCIDENT_DATE_SHARED_WITH_STEP_CASES: ReplayCase[] = [
  {
    id: "nov10-incident-date-shared-with-step-for-being-late",
    title: "\"i gave her a verbal on 10-21 for being late\": the card is dated 10-21",
    report: REPORT,
    status: { open: "the card is not dated 10-21" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("write up perla quist, i gave her a verbal on 10-21 for being late");
      expect(thread.proposal, `no card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(thread.proposal?.formDate, `the incident date is lost:\n${reply.content}`).toBe("2026-10-21");
    },
  },
  {
    id: "nov10-incident-date-shared-with-step-late-then-verbal",
    title: "\"she was late on 10-21 and i gave her a verbal on 10-21\": the card is dated 10-21",
    report: REPORT,
    status: { open: "the card is not dated 10-21" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("ca for perla quist, she was late on 10-21 and i gave her a verbal on 10-21");
      expect(thread.proposal, `no card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(thread.proposal?.formDate, `the incident date is lost:\n${reply.content}`).toBe("2026-10-21");
    },
  },
];

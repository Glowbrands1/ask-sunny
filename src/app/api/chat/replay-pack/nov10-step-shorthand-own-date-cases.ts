import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A TERSE REQUEST ENDING WITH A DATED PRIOR STEP: THE INCIDENT DATE IS KEPT (ported from Ask Bubbles: QA's prod-env reading there, 10 Nov 2026, D2;
 * STEP_SHORTHAND_OWN_DATE_ENABLED)
 * ============================================================================
 *
 * The manager's words (round 3, `corrective-action-dm-feedback-e2e.test.ts`; the person invented): one sentence with no
 * full stop. With production's flags CA_SHORTCUT_WORDS' shorthand matched "coaching 7/1", `stepSentenceDates` set aside
 * every date in the sentence, 10/13/26 included, and STEP_DATES_NOT_FORM_DATE dated the card today.
 */
const REMY: DirectoryRow = {
  id: "e-remy-calder-d2",
  firstName: "Remy",
  lastName: "Calder",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const SAID = "Remy Calder - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26";
const FIX = ["STEP_SHORTHAND_OWN_DATE_ENABLED"];
/** QA (10 Nov 2026): the same message asked for directly, so the card comes on the first turn. */
const DIRECT = "create a ca for remy calder - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26";
const REPORT = "QA's prod-env reading (10 Nov 2026, D2): a terse CA request ending with a dated prior step is dated today";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF, REMY]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV10_STEP_SHORTHAND_OWN_DATE_CASES: ReplayCase[] = [
  {
    id: "nov10-step-shorthand-own-date",
    title: `"${SAID}": the card is dated 10/13/26, not today and not the coaching's 7/1`,
    report: REPORT,
    // Not reproduced on the live path (QA, 10 Nov 2026): the chat route dates this card 10/13 with production's flags; the
    // defect is in `corrective-action-dm-feedback-e2e.test.ts`'s path. A guard: it holds with and without the flag.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      let reply = await thread.say(SAID);
      // On the chat route this terse request is offered first ("Do you want a Corrective Action for Remy Calder? Say yes …").
      if (!thread.proposal && /Say \*\*yes\*\*/.test(reply.content)) reply = await thread.say("yes");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(thread.proposal?.formDate, `the incident date is lost:\n${reply.content}`).toBe("2026-10-13");
    },
  },
  {
    id: "nov10-step-shorthand-own-date-direct",
    title: `"${DIRECT}": the card is dated 10/13/26`,
    report: `${REPORT} (QA: the same message asked for directly)`,
    // Not reproduced on the live path (QA, 10 Nov 2026): the chat route dates this card 10/13 with production's flags; the
    // defect is in `corrective-action-dm-feedback-e2e.test.ts`'s path. A guard: it holds with and without the flag.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(DIRECT);
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(thread.proposal?.formDate, `the incident date is lost:\n${reply.content}`).toBe("2026-10-13");
    },
  },
];

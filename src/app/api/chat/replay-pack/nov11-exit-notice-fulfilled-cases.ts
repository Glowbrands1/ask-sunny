import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "GAVE NOTICE … WORKED IT TIL 10/9": NOTICE 9/25, LAST DAY 10/9, SUBMITTED & FULFILLED NOTICE TICKED (QA's October
 * triage of #245, 10 Nov 2026; EXIT_NOTICE_FULFILLED_ENABLED)
 * ============================================================================
 *
 * The managers' wording (conv_mvofnrm5217ss9v turn 4, conv_mvofngxg2xy7l11), the person from the pack's STAFF: with
 * production's flags 10/9 is read as the notice date and the last day is left blank.
 */
const SAID = "exit form remy calder tc kearney 9/25 gave notice worked it til 10/9";

export const NOV11_EXIT_NOTICE_FULFILLED_CASES: readonly ReplayCase[] = [
  {
    id: "nov11-exit-notice-worked-it-til",
    title: '"… 9/25 gave notice worked it til 10/9": the notice date is September 25, the last day worked October 9',
    report: "#245 (QA's October triage, 10 Nov 2026): \"9/25 gave notice worked it til 10/9\" put 10/9 on the notice line, Last Day blank",
    status: { open: "the notice date is October 9 and the last day worked is blank" },
    fixFlags: ["EXIT_NOTICE_FULFILLED_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say(SAID);
      expect(reply.formProposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Remy Calder" });
      expect(reply.content, `notice date is not 9/25:\n${reply.content}`).toMatch(/\*\*Date that notice was given:\*\*\s*September 25, 2026/);
      expect(reply.content, `last day worked is not 10/9:\n${reply.content}`).toMatch(/\*\*Last Day Worked:\*\*\s*October 9, 2026/);
      expect(reply.content, `box unticked:\n${reply.content}`).toMatch(/\*\*Resignation Details:\*\*\s*Submitted & Fulfilled Notice/);
    },
  },
];

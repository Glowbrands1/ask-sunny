import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * AN EXIT FORM TYPED AS LINES KEEPS THE EMPLOYEE'S OWN JOB TITLE (QA's Sunny
 * gate, 6 Nov 2026, s16; TITLE_ENDS_AT_LINE_ENABLED)
 * ============================================================================
 *
 * With TITLE_OF_THE_EMPLOYEE_ENABLED on, "<name>\nTanning Consultant \nNE
 * Kearney\n…" gave the exit card no job title: the salon on the next line was
 * read as another person beside the title. The employee is off the roster, so
 * the typed title is the only one there is. The name is the priority replay's
 * own (invented).
 */
const TURNS = [
  "Can you create an exit form for me?",
  "Marnie Kettering\nTanning Consultant \nNE Kearney\nGave notice - fulfilled notice\nGave notice 9/25/26 - date notice fulfilled 10/9/26\nResigning to pursue other career options\nStore items returned payroll deduction does not apply eligible for rehire",
];

export const NOV6_TITLE_ENDS_AT_LINE_CASES: ReplayCase[] = [
  {
    id: "nov6-title-ends-at-line-exit-s16",
    title: "s16: an exit form typed as lines, with TITLE_OF_THE_EMPLOYEE on: the card's job title is the one typed on its own line",
    report: "QA's Sunny gate, 6 Nov 2026: priority replay s16, the exit card's job title null with TITLE_OF_THE_EMPLOYEE on",
    // With production's flags (TITLE_OF_THE_EMPLOYEE off) it holds; the fix flags are TITLE's own path, where it failed.
    status: "fixed",
    fixFlags: ["TITLE_OF_THE_EMPLOYEE_ENABLED", "TITLE_ENDS_AT_LINE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(TURNS[0]!);
      let reply = await thread.say(TURNS[1]!);
      /*
       * Changed on purpose (QA, 7 Nov 2026; as the sibling app's #516, finding C): with FORM_NAME_FROM_ROSTER +
       * OFF_ROSTER_CONFIRM the off-roster name is offered first ("reply **use Marnie Kettering**"); the card is filled
       * after "use Marnie Kettering", and its job title is still the line's.
       */
      if (!thread.proposal?.employeeName && reply.content.includes("reply **use Marnie Kettering**")) reply = await thread.say("use Marnie Kettering");
      expect(thread.proposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Marnie Kettering" });
      expect(thread.proposal?.employeeRole ?? null, `the card's job title:\n${reply.content}`).toBe("Tanning Consultant");
    },
  },
];

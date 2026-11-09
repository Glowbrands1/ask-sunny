import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * The sibling app's flip-3 tester (QA, 6 Nov 2026, B), checked here: "exit form for <X>, resigned 11-3-26 with no notice, not eligible
 * for rehire" said "Date that notice was given: November 3, 2026". NO_NOTICE_NO_DATE_ENABLED leaves the
 * notice date empty when the manager says no notice was given. The person is invented and not on
 * either directory.
 */
export const NOV6_NO_NOTICE_NO_DATE_CASES: ReplayCase[] = [
  {
    id: "nov6-no-notice-no-date-resigned",
    title: "\"exit form for <X>, resigned 11-3-26 with no notice, not eligible for rehire\": no notice date, and the resignation date stays",
    report: "QA, 6 Nov 2026 (the sibling app's flip-3 tester, B), in this app: \"no notice\" still got a notice date on the exit form",
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ["NO_NOTICE_NO_DATE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      let reply = await thread.say("exit form for Peregrine Ashcombe, resigned 11-3-26 with no notice, not eligible for rehire");
      /*
       * Changed on purpose (9 Nov 2026, the off-roster switch-on: OFF_ROSTER_CONFIRM + OFF_ROSTER_ASK_BEFORE_CARD, Pau's
       * "on" via QA): Peregrine Ashcombe is on no roster here, so a salon manager is asked about the name first. The
       * manager's "use <name>" makes the card, and every assertion below holds on that card turn, as it did on turn 1.
       */
      if (/I can't find \*\*Peregrine Ashcombe\*\* on your roster/.test(reply.content)) {
        reply = await thread.say("use Peregrine Ashcombe");
      }
      expect(reply.content, "a notice date the manager never gave").not.toMatch(/\*\*Date that notice was given:\*\*/i);
      expect(reply.content, "the resignation date is lost").toMatch(/Resignation Date:\*\* November 3, 2026/);
    },
  },
];

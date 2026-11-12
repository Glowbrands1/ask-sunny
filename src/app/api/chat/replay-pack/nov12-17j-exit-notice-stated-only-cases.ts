import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A RESIGNATION DATE IS NOT A NOTICE DATE (QA's Bubbles 17j live test, 12 Nov 2026; EXIT_NOTICE_STATED_ONLY_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app; reproduced here. "exit form for <A>, she resigned 11/8 …" printed "Date that notice was given: November 8" though the manager gave only
 * the resignation date. The tester's wording; the person is STAFF's invented Marnie Holloway.
 */
const SAID = "exit form for Marnie Holloway, she resigned 11/8";

export const NOV12_17J_EXIT_NOTICE_STATED_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov12-17j-resigned-date-is-not-notice-date",
    title: "17j: \"exit form for <A>, she resigned 11/8\": Resignation Date November 8, \"Date that notice was given\" left blank",
    report: "QA's Bubbles 17j live test via the sibling app, 12 Nov 2026; reproduced here",
    status: { open: "Date that notice was given: November 8" },
    fixFlags: ["EXIT_NOTICE_STATED_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal?.templateKey, `no exit card:\n${reply.content}`).toBe("stc-exit");
      expect(reply.content, `the notice date is filled from the resignation date:\n${reply.content}`).not.toMatch(/notice was given[^\n]*November 8/i);
      const id = await thread.create();
      expect(t.values(id).notice_given_date ?? "", "the saved notice date").toBe("");
      expect(t.values(id).resignation_date ?? "", "the saved Resignation Date").toBe("2026-11-08");
    },
  },
  {
    id: "nov12-17j-stated-notice-still-dated",
    title: "guard: \"exit form for <A>, she gave two weeks notice on 11/8\" still dates the notice",
    report: "QA's Bubbles 17j live test, 12 Nov 2026 (the stated-notice guard)",
    status: "fixed",
    fixFlags: ["EXIT_NOTICE_STATED_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("exit form for Marnie Holloway, she gave two weeks notice on 11/8");
      expect(thread.proposal?.templateKey, `no exit card:\n${reply.content}`).toBe("stc-exit");
      const id = await thread.create();
      expect(t.values(id).notice_given_date ?? "", "the stated notice date").toBe("2026-11-08");
    },
  },
];

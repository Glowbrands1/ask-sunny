import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN EXIT CARD'S DATE IS THE REPLY'S DATE (QA round 5, 8 Nov 2026; production chat of 7 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the employee invented): "exit form for <name>, last day 11/05, gave no notice". The reply's
 * list said "- **Date:** the day the draft is created", the card under it said "**Date:** 11/5/2026", and the
 * form was created dated 11/5. EXIT_DATE_LINE_AGREES_ENABLED (`ai/reply-matches-card.ts`), with
 * REPLY_MATCHES_CARD (on in production).
 */

const TAMSIN: DirectoryRow = {
  id: "e-tamsin-vale-exit",
  firstName: "Tamsin",
  lastName: "Vale",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const FIX = ["EXIT_DATE_LINE_AGREES_ENABLED"];
const REPORT = "QA round 5, 8 Nov 2026 (production chat 60e64d85, 7 Nov 2026)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T13:35:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function listDate(content: string): string {
  return /^- \*\*Date:\*\* (.+)$/m.exec(content)?.[1] ?? "";
}

export const NOV8_EXIT_DATE_LINE_AGREES_CASES: ReplayCase[] = [
  {
    id: "nov8-r5-exit-date-line-agrees",
    title: "\"exit form for <name>, last day 11/05, gave no notice\": the reply's Date line is the card's 11/5, the form's date",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by EXIT_DATE_LINE_AGREES_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("exit form for Tamsin Vale, last day 11/05, gave no notice");
      expect(thread.proposal, `no exit card:\n${reply.content}`).toMatchObject({ templateKey: "stc-exit", formDate: "2026-11-05" });
      expect(listDate(reply.content), `the reply's Date line disagrees with the card:\n${reply.content}`).toBe("November 5, 2026");
      const id = await thread.create();
      expect(t.values(id).form_date, "the form's date").toBe("2026-11-05");
    },
  },
  {
    id: "nov8-r5-exit-date-line-no-date",
    title: "negative: an exit card with no date keeps \"the day the draft is created\"",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("exit form for Tamsin Vale, she quit without notice");
      expect(thread.proposal, `no exit card:\n${reply.content}`).toMatchObject({ templateKey: "stc-exit" });
      expect(thread.proposal?.formDate ?? null, `the card has a date:\n${reply.content}`).toBeNull();
      expect(listDate(reply.content), `the Date line changed:\n${reply.content}`).toBe("the day the draft is created");
    },
  },
];

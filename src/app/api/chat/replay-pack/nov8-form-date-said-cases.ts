import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "MAKE THE DATE FOR 10/14/26" STILL ASKED WHICH DATE (QA, 8 Nov 2026)
 * ============================================================================
 *
 * QA's flip-9 tester, item 9, the date part (8 Nov 2026): on a Coaching proposal card about a meeting missed on
 * 10/10/26, "I need you to make it about showing up late and please list the policy make the date for 10/14/26."
 * got "You mentioned more than one date (10/10, 10/14). Which date goes on the form?" although the manager had
 * said which. FORM_DATE_SAID_SETTLES_ENABLED (`forms/form-date-said.ts`). The manager's words; the employee is invented.
 */

const PERPETUA: DirectoryRow = {
  id: "e-perpetua-lindqvist-d9",
  firstName: "Perpetua",
  lastName: "Lindqvist",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const REQUEST = "create a coaching form for Perpetua Lindqvist, he missed the monthly meeting on 10/10/26";
const EDIT = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
const ASKED = /You mentioned more than one date|Which date goes on the form\?/;
const FIX = ["FORM_DATE_SAID_SETTLES_ENABLED"];
const REPORT = "QA's flip-9 tester, item 9 (8 Nov 2026): \"make the date for 10/14/26\" was asked about again";

export const NOV8_FORM_DATE_SAID_CASES: ReplayCase[] = [
  {
    id: "nov8-form-date-said-settles",
    title: "\"… make the date for 10/14/26.\" on a card with 10/10 in it: the Date is 10/14/2026 and no date question is asked",
    report: REPORT,
    status: { open: "the card asks \"You mentioned more than one date (10/10, 10/14). Which date goes on the form?\"" },
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T14:00:00Z"));
      t.directory([...STAFF, PERPETUA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(REQUEST);
      const reply = await thread.say(EDIT);
      expect(reply.content, `the date the manager gave is asked about:\n${reply.content}`).not.toMatch(ASKED);
      expect(thread.proposal?.formDate ?? null, "the card's Date").toBe("2026-10-14");
      const id = await thread.create();
      expect(t.values(id).form_date, "the form's Date").toBe("2026-10-14");
    },
  },
  {
    id: "nov8-form-date-said-negative",
    title: "negative: two incident dates and no date said for the form still ask which",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T14:00:00Z"));
      t.directory([...STAFF, PERPETUA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Perpetua Lindqvist, she was late on 10/5/26 and again on 10/15/26");
      expect(reply.content, "two incident dates are asked about").toMatch(ASKED);
    },
  },
];

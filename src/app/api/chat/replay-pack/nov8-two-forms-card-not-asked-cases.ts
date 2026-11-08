import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * TWO FORMS, THE CARD ALREADY FOR A IS NEVER ASKED "WHICH OF THEM" (QA, 8 Nov 2026, live check conv ef902fec after
 * round 4). "Coaching form for <A>. Also a CA for <B>." made the Coaching card for A (status ready) and offered B's
 * Corrective Action, but the reply above the card asked "Which of them is this **Coaching Form** for — **<A>** or
 * **<B>**?". The tester's wording; the names are the tester's own invented ones, not on employee_access_directory in
 * either app, so both are off the roster, as in the chat.
 *
 * The pack's readers give the right reply here today (the live one came from the models' reading of the names, which
 * the pack does not reproduce: tried with the intent reader taking A, B, both or none, as a salon director and as an
 * admin, on main and on the deploy's 144c26b5). So this case is a guard on the path production takes, and the fix is
 * proven on the live reply itself (`lib/forms/card-not-asked.test.ts`).
 */
const SAID = "Coaching form for Dana Lane. Also a CA for Marnie Quill.";
const ASKED = /Which of them is this \*\*Coaching Form\*\* for/;
const OFFER_B = /\*\*Do you want a Corrective Action Form for Marnie Quill next\?\*\* Say \*\*yes\*\* and I'll start it\./;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-08T01:05:10Z"));
  t.directory(STAFF);
  // The tester covers every salon (the live card read "location not applicable").
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  // The intent reader takes B, the last person named, as the Coaching Form's employee (as in nov8-two-forms-offer-name).
  t.slotsRead({ employee: "Marnie Quill", formType: "Coaching Form", formTurn: true }, "Marnie Quill", { onlyIfSaid: true });
  return t.thread();
}

export const NOV8_TWO_FORMS_CARD_NOT_ASKED_CASES: ReplayCase[] = [
  {
    id: "nov8-two-forms-card-not-asked-ef902fec",
    title: "guard: \"Coaching form for <A>. Also a CA for <B>.\" (both off the roster): the card for A is not asked \"Which of them\", and B is offered",
    report: "QA, 8 Nov 2026 (conv ef902fec): the card was for A, and the reply still asked \"Which of them … — A or B?\"",
    status: "fixed",
    fixFlags: ["TWO_FORMS_CARD_NOT_ASKED_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(SAID);
      expect(thread.proposal, `no Coaching card for A:\n${reply.content}`).toMatchObject({ employeeName: "Dana Lane" });
      expect(reply.content, `the card for A is asked which:\n${reply.content}`).not.toMatch(ASKED);
      expect(reply.content, `B is not offered:\n${reply.content}`).toMatch(OFFER_B);
    },
  },
];

import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { s35People } from "./nov7-s35-ca-not-prior-coaching-cases";

/**
 * ============================================================================
 * P10 / P11: THE STATED ANSWER IS ON THE SAVED FORM, NOT ONLY ON THE CARD (Pau's 7 Nov check; QA, 10 Nov 2026)
 * ============================================================================
 *
 * Two live chats of 6 Nov 2026 where the reply said a box would be ticked. QA asked for cases that assert the SAVED
 * value, not the card's words. Both managers' wording, word for word. The people are invented: sf-s35's Wrenna
 * Calloway, and STAFF's Marnie Holloway, typed with sf-s36's one-letter surname typo in the first turn.
 *
 * - P10: "This needs changed to a verbal corrective action" after the CA card. The reply said "Verbal Warning, as you
 *   said — I'll tick it on the form". The saved form must have Type of Warning ticked Verbal.
 * - P11: "I need a exit for for <name> TC. … payroll deduction is applicable.  store items were returned.", then
 *   "Exit form. Tanning Consultant, <name>". The card listed Store Items Returned and Payroll Deduction. The saved form
 *   must have both ticked Yes.
 *
 * Production's own rows for both forms (read 10 Nov 2026) hold these values, written at Create from the manager's
 * statement (`instances.ts` writeStatedFacts, filled_by "system", provenance manager_statement). These cases keep it so.
 * The "Who is this form for?" turn of P11 is sf-s36's open case, not this one; the second turn names the person.
 */
const P11_FIRST =
  "I need a exit for for Marnie Halloway TC. Quit without notice. not fulfilling a 2 weeks notice. payroll deduction is applicable.  store items were returned.";
const P11_SECOND = "Exit form. Tanning Consultant, Marnie Holloway";
const P10_FIRST =
  "Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26. Wrenna has signed a coaching document for being late on 10/14/26. I need you to make sure the policy is on this CA.";
const P10_SECOND = "This needs changed to a verbal corrective action";

export const NOV10_SAVED_STATED_FACTS_CASES: ReplayCase[] = [
  {
    id: "nov10-p10-verbal-saved",
    title: "P10: \"This needs changed to a verbal corrective action\" on the CA card: the SAVED form's Type of Warning is ticked Verbal",
    report: "Pau's 7 Nov check P10 (live chat 6 Nov 2026), relayed by QA 10 Nov 2026: the reply said it would tick Verbal; reported blank on the saved form",
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T14:18:00Z"));
      t.directory([...STAFF, ...s35People()]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(P10_FIRST);
      const reply = await thread.say(P10_SECOND);
      expect(thread.proposal, `no Corrective Action card after the second turn:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wrenna Calloway" });
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], `the saved Type of Warning is not Verbal:\n${reply.content}`).toEqual(["verbal"]);
    },
  },
  {
    id: "nov10-p11-exit-stated-answers-saved",
    title: "P11: \"… payroll deduction is applicable.  store items were returned.\" then \"Exit form. Tanning Consultant, <name>\": the SAVED form ticks both Yes",
    report: "Pau's 7 Nov check P11 (live chat 6 Nov 2026), relayed by QA 10 Nov 2026: the card listed both answers; reported blank on the saved form",
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:14:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(P11_FIRST);
      const reply = await thread.say(P11_SECOND);
      expect(thread.proposal, `no exit card after the second turn:\n${reply.content}`).toMatchObject({ employeeName: "Marnie Holloway" });
      const id = await thread.create();
      const checked = t.checked(id);
      expect(checked.store_items_returned ?? [], `the saved Store Items Returned is not Yes:\n${reply.content}`).toEqual(["yes"]);
      expect(checked.payroll_deduction_applicable ?? [], `the saved Payroll Deduction is not Yes:\n${reply.content}`).toEqual(["yes"]);
    },
  },
];

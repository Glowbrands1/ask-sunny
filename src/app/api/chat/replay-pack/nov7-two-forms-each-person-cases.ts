import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * The Sunny live tester after flip 7 (QA, 7 Nov 2026), with TWO_FORMS_OWN_PERSON live: "Coaching form for <A>. Also a
 * CA for <B>." gave ONE Coaching card with Employee "Not yet", asked who, and said "ask for <B>'s CA on its own": the
 * typed person A was ignored and B's Corrective Action was not made. Expected: the Coaching card for A, and the
 * Corrective Action offered for B, each with its own person. TWO_FORMS_EACH_PERSON_ENABLED. The models read B for the
 * whole message (the live shape); a call shown only A's request reads nobody else. The people are invented.
 */
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});
const PEREGRINE = person("e-peregrine-ashcombe", "Peregrine", "Ashcombe");
const TAMSIN = person("e-tamsin-wexley", "Tamsin", "Wexley");

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function twoFormsEachPersonPeople(): readonly DirectoryRow[] {
  return [PEREGRINE, TAMSIN];
}

const FIX = ["TWO_FORMS_OWN_PERSON_ENABLED", "TWO_FORMS_EACH_PERSON_ENABLED"];
const REPORT = "QA, 7 Nov 2026 (Sunny live tester after flip 7): one Coaching card with no employee, A ignored, B's CA not made";
const OFFER_B = /\*\*Do you want a Corrective Action Form for Tamsin Wexley next\?\*\* Say \*\*yes\*\* and I'll start it\./;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  t.directory([...STAFF, PEREGRINE, TAMSIN]);
  t.as("salon_director", KEARNEY);
  t.slotsRead({ employee: "Tamsin Wexley", formType: "Coaching Form", formTurn: true }, "Tamsin Wexley", { onlyIfSaid: true });
  return t.thread();
}

export const NOV7_TWO_FORMS_EACH_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov7-two-forms-each-person-coaching-and-ca",
    title: "\"Coaching form for <A>. Also a CA for <B>.\": the Coaching card is A's, and B's Corrective Action is offered with B",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by TWO_FORMS_EACH_PERSON_ENABLED, QA round 4, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("Coaching form for Peregrine Ashcombe. Also a CA for Tamsin Wexley.");
      expect(thread.proposal, `no Coaching card for A:\n${reply.content}`).toMatchObject({ employeeName: "Peregrine Ashcombe" });
      expect(thread.proposal?.templateKey, `not a Coaching card:\n${reply.content}`).not.toBe("dpoa");
      expect(reply.content, `B's Corrective Action is not offered:\n${reply.content}`).toMatch(OFFER_B);
      expect(reply.content, `asks who although A was typed:\n${reply.content}`).not.toMatch(/Who is this \*\*Coaching Form\*\* for\?/);
    },
  },
  {
    id: "nov7-two-forms-each-person-yes-starts-b",
    title: "then \"yes\": the Corrective Action card is B's",
    report: `${REPORT} (the offer accepted)`,
    // Changed on purpose (8 Nov 2026): fixed in production by TWO_FORMS_EACH_PERSON_ENABLED, QA round 4, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("Coaching form for Peregrine Ashcombe. Also a CA for Tamsin Wexley.");
      const reply = await thread.say("yes");
      expect(thread.proposal, `no Corrective Action card for B:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Tamsin Wexley" });
    },
  },
];

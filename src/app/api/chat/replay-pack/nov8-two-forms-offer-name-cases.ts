import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * TWO_FORMS_EACH_PERSON_ENABLED's offer, typed in lower case (QA, 8 Nov 2026, round-5 follow-up): "… also a ca for
 * tamsin wexley" was offered as "for tamsin wexley next?". The offer shows the name with each word capitalised, and a
 * "yes" still starts B's Corrective Action. The people are invented (the same as nov7-two-forms-each-person-cases.ts).
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
export function twoFormsOfferNamePeople(): readonly DirectoryRow[] {
  return [PEREGRINE, TAMSIN];
}

const FIX = ["TWO_FORMS_OWN_PERSON_ENABLED", "TWO_FORMS_EACH_PERSON_ENABLED"];
const SAID = "coaching form for peregrine ashcombe. also a ca for tamsin wexley";
const OFFER_B = /\*\*Do you want a Corrective Action Form for Tamsin Wexley next\?\*\* Say \*\*yes\*\* and I'll start it\./;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  t.directory([...STAFF, PEREGRINE, TAMSIN]);
  t.as("salon_director", KEARNEY);
  t.slotsRead({ employee: "tamsin wexley", formType: "Coaching Form", formTurn: true }, "tamsin wexley", { onlyIfSaid: true });
  return t.thread();
}

export const NOV8_TWO_FORMS_OFFER_NAME_CASES: ReplayCase[] = [
  {
    id: "nov8-two-forms-offer-name-lowercase",
    title: "\"coaching form for <a>. also a ca for <b>\" typed in lower case: B is offered as \"Tamsin Wexley\", and \"yes\" starts B's card",
    report: "QA, 8 Nov 2026: the offer named B as typed (\"for rowan kestrel next?\")",
    // Changed on purpose (8 Nov 2026): production-flags.json now lists TWO_FORMS_EACH_PERSON_ENABLED (round 4, #666), so this holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(SAID);
      expect(reply.content, `B is not offered with the name capitalised:\n${reply.content}`).toMatch(OFFER_B);
      const yes = await thread.say("yes");
      expect(thread.proposal, `no Corrective Action card for B:\n${yes.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Tamsin Wexley" });
    },
  },
];

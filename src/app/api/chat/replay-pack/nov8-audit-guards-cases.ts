import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * GUARDS FOR QA's ROUND-6 FLAG AUDIT (8 Nov 2026): BUGS THE SIBLING APP FIXED BEHIND A FLAG THAT THIS APP DOES NOT HAVE
 * ============================================================================
 *
 * QA compared every flag's production value in both apps. Two of the sibling app's fixes are not needed here because
 * this app's production already holds; these cases keep it that way (`docs/parity-log/2026-11-08-*.md`).
 *
 * - The sibling app's STORE_WORD_NOT_A_NAME (QA BF7 there, 27 Oct 2026, the "Madeline" chain): a reply that is only a
 *   store's name ("dodge") became the employee. Here, with this app's words ("kearney"), the employee stays.
 * - CA_OFFER_KEEPS_ACCOUNT (on in the sibling app): QA's M5 offer → "yes" → Create, on this app's production card
 *   (no FORM_FULL_REMAP): the draft's Observation is her account, never the offer's rewritten request.
 *
 * The testers' words; the people are invented.
 */
const NERISSA: DirectoryRow = {
  id: "e-nerissa-quellmont",
  firstName: "Nerissa",
  lastName: "Quellmont",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

function start(t: ReplayContext, people: readonly DirectoryRow[] = STAFF) {
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory([...people]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_AUDIT_GUARDS_CASES: ReplayCase[] = [
  {
    id: "nov8-audit-salon-word-not-the-employee",
    title: "the sibling's BF7 \"Madeline\" chain in this app's words: a reply that is only the salon's name (\"kearney\") is never the employee",
    report: "QA's round-6 flag audit (8 Nov 2026): the sibling app's STORE_WORD_NOT_A_NAME; not needed here",
    status: "fixed",
    async run(t) {
      const thread = start(t);
      for (const turn of ["i need to issue a ca for someone being late", "rowan kestrel was late on 10/20 and the salon was opened late", "she was issued a verbal ca on 10.1 for this same thing", "yes payrol ldeduct", "i dont know the amount", "kearney"]) {
        await thread.say(turn);
      }
      expect(thread.proposal?.employeeName ?? null, "the salon's name became the employee").toBe("Rowan Kestrel");
    },
  },
  {
    id: "nov8-audit-ca-offer-create-keeps-account",
    title: "M5 → the offer → \"yes\" → Create on production's card (no full remap): the draft's Observation is her MSB account",
    report: "QA's round-6 flag audit (8 Nov 2026): CA_OFFER_KEEPS_ACCOUNT is on in the sibling app; not needed here while FORM_FULL_REMAP is off",
    status: "fixed",
    async run(t) {
      const thread = start(t, [...STAFF, NERISSA]);
      await thread.say("Nerissa Quellmont did not follow must see behaviors which violates standards of conduct policy");
      await thread.say("yes");
      const id = await thread.create();
      const observation = t.values(id).observation ?? "";
      expect(observation, "the Observation is the offer's rewritten request").not.toMatch(/policy is Standards of Conduct|Create a Corrective Action Form/i);
      expect(observation, "the Observation is not her account").toMatch(/did not follow must see behaviors/i);
    },
  },
];

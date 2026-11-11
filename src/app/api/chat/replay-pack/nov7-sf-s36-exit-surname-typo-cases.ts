import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * sf-s36: AN EXIT FORM FOR A ROSTER PERSON WITH A ONE-LETTER SURNAME TYPO (Pau's scan,
 * a real manager, 6 Nov 2026 23:14 PHT; relayed by QA, 7 Nov 2026)
 * ============================================================================
 *
 * "I need a exit for for <First> <Surname, one letter wrong> TC. Quit without notice. …" was answered "Who is this
 * form for? Tell me the employee's full name." — no "Is this for <the roster's spelling>?" — and only "Exit form.
 * Tanning Consultant, <the right name>" filled the card. The manager's wording; the person is invented (STAFF's
 * Marnie Holloway, typed "Marnie Halloway"). The live path: the reading model returns the form and the name as
 * typed (the live trace). Without the model, the code alone does not read "a exit for for" as a form request and gives
 * a policy answer, so that path is not this report's and has no case.
 *
 * With production's flags plus the 7 Nov catch-up (QA's flips of 5 and 6 Nov) the reply is the reported one, "Here is
 * what I would put on a **Resignation/Exit Form** for the employee. … Who is this form for? Tell me the employee's full
 * name." With the name set on (FORM_NAME_FROM_ROSTER, ROSTER_NEAR_MISS, …): "Is this for **Marnie Holloway**?".
 */
const TYPED = "Marnie Halloway";
const ROSTER = "Marnie Holloway";
const SAID = `I need a exit for for ${TYPED} TC. Quit without notice. not fulfilling a 2 weeks notice. payroll deduction is applicable. store items were returned.`;
const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];

function typoCase(id: string): ReplayCase {
  return {
    id,
    title: `sf-s36: "I need a exit for for <roster name, one letter wrong> TC. Quit without notice. …" (the reading model returns the name as typed): the card is the roster person's, or the reply asks "Is this for **<roster name>**?"`,
    report: "Pau's scan sf-s36 (real manager, 6 Nov 2026 23:14 PHT; QA, 7 Nov 2026): a one-letter surname typo on an exit form asked who, with no offer of the roster spelling",
    // Changed on purpose (10 Nov 2026): fixed in production by KEEP_ROSTER_EXACT_NAME_ENABLED (gate runner 2 solo GO), QA P11a release; it now holds with production's flags.
    status: "fixed",
    fixFlags: NAME_SET,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      t.slotsRead({ employee: TYPED, formType: "Resignation/Exit Form", formTurn: true }, TYPED);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      const employee = thread.proposal?.employeeName ?? null;
      const offered = new RegExp(String.raw`Is this for \*\*${ROSTER}\*\*\?`).test(reply.content);
      expect(employee === ROSTER || offered, `neither the card (${employee}) nor "Is this for **${ROSTER}**?":\n${reply.content}`).toBe(true);
      expect(employee, `the card keeps the typo:\n${reply.content}`).not.toBe(TYPED);
    },
  };
}

export const NOV7_SF_S36_EXIT_SURNAME_TYPO_CASES: ReplayCase[] = [
  typoCase("nov7-sf-s36-exit-surname-typo"),
];

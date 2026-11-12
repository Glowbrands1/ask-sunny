import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * sf-s36's OTHER HALF: AN OFF-ROSTER NAME IN THE SAME WORDING (QA, 10 Nov 2026)
 * ============================================================================
 *
 * QA ran nov7-sf-s36 on main e9b3f32d: with production's flags the reply asks "Who is this form for?" and the typed
 * name is dropped, not even offered as an off-roster name. A manager whose employee really is not on the roster would
 * loop the same way. sf-s36's wording, word for word, with a full name that is on no roster and near nobody on it
 * (invented): with the name set on, a salon manager is asked OFF_ROSTER_ASK's "I can't find **<name>** on your roster — … reply **use
 * <name>**", and "yes" puts the name on the card, ready to create.
 */
const TYPED = "Quillon Thaddeus";
const SAID = `I need a exit for for ${TYPED} TC. Quit without notice. not fulfilling a 2 weeks notice. payroll deduction is applicable. store items were returned.`;
const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "NEAR_MISS_QUESTION_RULES_ENABLED",
  "NEAR_MISS_DETAILS_ACCEPT_ENABLED",
  "FORM_NAME_OFF_ROSTER_ASK_ENABLED",
];

export const NOV10_SF_S36_OFF_ROSTER_EXIT_CASES: ReplayCase[] = [
  {
    id: "nov10-sf-s36-off-roster-exit",
    title: "sf-s36's wording with an off-roster name near nobody: the typed name is offered (\"use <name>\"), and \"yes\" puts it on the card",
    report: "QA, 10 Nov 2026, on main e9b3f32d: sf-s36 with production's flags drops the typed name; an off-roster employee would loop on \"Who is this form for?\"",
    // Changed on purpose (10 Nov 2026): fixed in production by the roster-name set (FORM_NAME_FROM_ROSTER and companions), QA round 22; it now holds with production's flags.
    status: "fixed",
    fixFlags: NAME_SET,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      t.slotsRead({ employee: TYPED, formType: "Resignation/Exit Form", formTurn: true }, TYPED);
      const thread = t.thread();
      const first = await thread.say(SAID);
      const offered = /reply \*\*use Quillon Thaddeus\*\*/.test(first.content);
      const seated = thread.proposal?.employeeName === TYPED;
      expect(offered || seated, `the typed name is neither offered nor on the card:\n${first.content}`).toBe(true);
      expect(first.content, `the reply only asks who:\n${first.content}`).not.toMatch(/^(?![\s\S]*Quillon)[\s\S]*Who is this form for\?/);
      if (!seated) {
        const reply = await thread.say("yes");
        expect(thread.proposal, `"yes" does not put the typed name on the card:\n${reply.content}`).toMatchObject({ employeeName: TYPED, status: "ready" });
      }
    },
  },
];

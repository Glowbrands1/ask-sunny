import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE SIBLING APP'S FORM_NAME LIVE RE-RUN (QA, 7 Nov 2026 09:39 PHT: 15 PASS / 2 FAIL, rolled back there)
 * ============================================================================
 *
 * FAIL 1, the real B1 manager message there, a person not in Woven after a job title ("<title>, <name>"): the card's Employee stayed "Not
 * yet" and "Who is this form for? Tell me the employee's full name." was asked on all three turns — never "I
 * couldn't find <name> … reply **use <name>**", and "name is <name>" filled nothing. With the flag off the card
 * fills with the typed name.
 * FAIL 2 there: "my team member <roster person> was late on 10-20-26, verbal ca" made no card and refused ("'verbal CA'
 * isn't something I can put in writing …").
 * QA's wording with this app's own title (Tanning Consultant) and a salon; the names are invented (FAIL 1's is on
 * no directory; FAIL 2's is STAFF's Remy Calder).
 */
const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];
const OFF_ROSTER = "Zebulon Marchbanks";
const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?/i;

const B1_TURNS = [
  `create a written corrective action for Tanning Consultant, ${OFF_ROSTER}. He did not complete his policy acknowledgements in woven by 10-15-26. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.`,
  `name is ${OFF_ROSTER}`,
  "this is a violation under Standards of Conduct",
];

/** The person is on the card, or offered as not in Woven. */
function seatedOrOffered(employee: string | null, reply: ReplayAnswer): boolean {
  return employee === OFF_ROSTER || reply.content.includes(`reply **use ${OFF_ROSTER}**`);
}

export const NOV7_FORM_NAME_LIVE_RERUN_CASES: ReplayCase[] = [
  {
    id: "nov7-live-b1-team-member-off-roster-three-turns",
    title: "FAIL 1: \"create a written corrective action for Tanning Consultant, <off-roster name>. …\", then \"name is <name>\", then \"this is a violation under Standards of Conduct\": the name typed on turn 1 is on the card or offered on turn 1, never asked for three times",
    report: "QA, the FORM_NAME live re-run (7 Nov 2026 09:39 PHT), FAIL 1: the real B1 message asked \"Who is this form for?\" on all three turns",
    status: "fixed",
    fixFlags: NAME_SET,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const replies: ReplayAnswer[] = [];
      for (const turn of B1_TURNS) {
        const reply = await thread.say(turn);
        replies.push(reply);
        expect(reply.content, `the job title is said back as a person:\n${reply.content}`).not.toMatch(/\*\*Tanning Consultant\*\*/);
        // The name is typed on turn 1 ("for <title>, <name>."), so turn 1 seats or offers it.
        expect(seatedOrOffered(thread.proposal?.employeeName ?? null, reply), `turn ${replies.length} neither seats nor offers ${OFF_ROSTER}:\n${reply.content}`).toBe(true);
        break;
      }
      expect(replies.filter((reply) => ASKS_WHO.test(reply.content)).length, "asked who on every turn").toBeLessThan(3);
    },
  },
  {
    id: "nov7-live-team-member-verbal-ca-roster",
    title: "FAIL 2: \"my tanning consultant <roster person> was late on 10-20-26, verbal ca\": a Corrective Action card for them, never a refusal",
    report: "QA, the FORM_NAME live re-run (7 Nov 2026 09:39 PHT), FAIL 2: no card, \"'verbal CA' isn't something I can put in writing …\"",
    // The sibling app made no card for this message; this app makes the card with production's flags and with the name
    // set, so the case holds here as a check that it stays so.
    status: "fixed",
    fixFlags: NAME_SET,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      // The live path: the reading model reads the request (a verbal Corrective Action for the roster person).
      t.slotsRead({ employee: "Remy Calder", warningLevel: "verbal", formType: "Corrective Action Form", formTurn: true, incidentDate: "2026-10-20" });
      const reply = await thread.say("my tanning consultant Remy Calder was late on 10-20-26, verbal ca");
      expect(reply.content, `a refusal:\n${reply.content}`).not.toMatch(/isn['’]t something I can put in writing/i);
      expect(thread.proposal, `no Corrective Action card for Remy Calder:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
    },
  },
];

import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE OFFER IS THE ONE QUESTION (port of the sibling
 * app's flip-3 tester finding C, 6 Nov 2026; OFF_ROSTER_CONFIRM_ENABLED)
 * ============================================================================
 *
 * In every not-found shape the first reply made the off-roster offer ("reply
 * **use <name>**") and still asked "Who is this form for? Tell me the
 * employee's full name." with "- **Name:** The employee" on the card list —
 * two questions for one answer. When the offer is made it is the one question
 * about the person: no generic who-ask, no "The employee" Name line. Any other
 * question (the job title) stays. The names are invented and on no directory.
 */
const FLAGS = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];

const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?/i;
const NAME_IS_THE_EMPLOYEE = /^- \*\*Name:\*\* the employee$/im;

function oneQuestion(id: string, title: string, turns: readonly string[], name: string): ReplayCase {
  return {
    id,
    title,
    report: "The sibling app's flip-3 tester (6 Nov 2026), finding C: the offer and \"Who is this form for?\" in the same reply",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      let reply = { content: "" };
      for (const turn of turns) {
        reply = await thread.say(turn);
        if (!reply.content.includes(`reply **use ${name}**`)) continue;
        expect(reply.content, `the offer and a second who-question:\n${reply.content}`).not.toMatch(ASKS_WHO);
        expect(reply.content, `the offer and "Name: The employee":\n${reply.content}`).not.toMatch(NAME_IS_THE_EMPLOYEE);
        reply = await thread.say(`use ${name}`);
        expect(thread.proposal, `no card the manager can create:\n${reply.content}`).toMatchObject({ employeeName: name, status: "ready" });
        return;
      }
    },
  };
}

export const NOV6_OFF_ROSTER_ONE_QUESTION_CASES: ReplayCase[] = [
  oneQuestion(
    "nov6-one-question-own-line",
    "an exit form typed as lines, the name alone on the first: the offer is the one question about the person",
    [
      "Can you create an exit form for me?",
      "Thessaly Varrow\nTeam Member Part Time \nGave notice - fulfilled notice\nGave notice 9/25/26 - date notice fulfilled 10/9/26\nResigning to pursue other career options\neligible for rehire",
    ],
    "Thessaly Varrow",
  ),
  oneQuestion(
    "nov6-one-question-for-name",
    "\"exit form for <name>, …\": the offer is the one question about the person",
    ["exit form for Thessaly Varrow, she gave notice 9/25/26 and her last day was 10/9/26, resigning to pursue other career options"],
    "Thessaly Varrow",
  ),
  oneQuestion(
    "nov6-one-question-ca",
    "\"create a ca form for <name>, …\": the offer is the one question about the person",
    ["create a ca form for Zebulon Marchbanks, he was late opening the salon on 11/2"],
    "Zebulon Marchbanks",
  ),
  oneQuestion(
    "nov6-one-question-employee-comma",
    "\"i have an employee, <name> that needs …\": the offer is the one question about the person",
    ["i have an employee, Zebulon Marchbanks that needs a corrective action form with a customer complaint"],
    "Zebulon Marchbanks",
  ),
];

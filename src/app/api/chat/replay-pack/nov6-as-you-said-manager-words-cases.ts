import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "AS YOU SAID" ONLY FOR A POLICY THE MANAGER NAMED (live chat, 4 Nov 2026)
 * ============================================================================
 *
 * A manager, word for word (the employee swapped for an invented one), asked
 * two policy questions — "closing policy", answered with a list that named
 * **Late Opening** "(if you meant opening, not closing)", and "What policy
 * would it be if a tanning consultant did not complete the closing correctly
 * and i have already talked to her about it" — then asked for the form:
 * "Write a CA for <name> she is TC works at Omaha Pacific and on 11/3/26 she
 * was scheduled until 9:15PM and clocked out at 9:01. She also took down the
 * spray booths down at 8:11 PM before the Salon was closed." The card said
 * "**Policy:** Late Opening, as you said". The manager never named Late
 * Opening; the app's own earlier answer did. AS_YOU_SAID_MANAGER_WORDS_ENABLED.
 */

const ISOLDE: DirectoryRow = {
  id: "e-isolde-brannock",
  firstName: "Isolde",
  lastName: "Brannock",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const CLOSING_ANSWER = [
  "We've got a couple of policies that touch on closing — which one do you need?",
  "",
  "- **Location Closing Times**: The salon accepts customers until the posted closing time [p.21]. Failing to accept customers up to that time results in immediate disciplinary action [p.21].",
  "- **Late Opening** (if you meant opening, not closing): If the opener can't open on time, they must notify the manager ASAP, the manager has to open and work until the opener arrives or a replacement is found, and the employee who failed to open owes a $25.00 payroll deduction for expenses incurred, where applicable and following state/local guidelines [p.15].",
  "",
  "Let me know if you meant something else — like end-of-shift cleaning/checklists, which falls under Care and Cleaning of Equipment and Facilities [p.21].",
].join("\n");

const CLOSING_DUTIES_ANSWER =
  "Incomplete closing duties falls under Care and Cleaning of Equipment and Facilities — \"It is the responsibility of every employee to ensure completion of appropriate checklists are completed each shift\" [p.21]. If you want one started, ask me to create a Corrective Action Form and name her.";

const REQUEST =
  "Write a CA for Isolde Brannock she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";

const S24_T1 =
  "Can you write me a performace ca for an employee who did not meet their numbers for the month of october Isolde Brannock  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";
const S24_T2 =
  "it should be must see behaviors and she also had coaching on file for open ended questions coahing done one 10/22 and sunless bundle coachings done 10/15";

export const NOV6_AS_YOU_SAID_MANAGER_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov6-as-you-said-reader-heading",
    title: "\"it should be must see behaviors …\" with the reader's heading Standards of Conduct: no \"Standards of Conduct, as you said\"",
    report: "Live chat, 4 Nov 2026 (Pau's sf-s24, relayed by QA): the reader's heading was said back as the manager's",
    status: { open: "\"**Policy:** Standards of Conduct, as you said\" although the manager said must see behaviors" },
    fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
      t.directory([...STAFF, ISOLDE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(S24_T1);
      t.slotsRead({ policyHeading: "Standards of Conduct" });
      const reply = await thread.say(S24_T2);
      const policy = reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/.test(line)) ?? "";
      expect(policy, `"as you said" for a policy the manager never typed:\n${reply.content}`).not.toMatch(/Standards of Conduct,? as you said/i);
    },
  },
  {
    id: "nov6-as-you-said-manager-words",
    title: "after \"closing policy\" was answered with Late Opening, a CA for leaving early / taking the booths down early is not \"Late Opening, as you said\"",
    report: "Live chat, 4 Nov 2026 (relayed by QA, 6 Nov): \"Policy: Late Opening, as you said\" for leaving early",
    /*
     * A GUARD (6 Nov 2026): with the live trace's reading (policyHeading "Late Opening" from the first turn) the
     * replay shows the Late Opening citation and the live Observation word for word, but its stand-ins no longer
     * build the "**Policy:** Late Opening, as you said" line. The same mechanism is proven by the next case and by
     * `forms/as-you-said-manager-words.test.ts` (the live line, from the app's "Policy reference: Late Opening …").
     */
    status: "fixed",
    fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T16:39:00Z"));
      t.directory([...STAFF, ISOLDE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      t.modelSays(CLOSING_ANSWER);
      t.slotsRead({ policyHeading: "Late Opening" });
      await thread.say("closing policy");
      t.modelSays(CLOSING_DUTIES_ANSWER);
      t.slotsRead({ policyHeading: "Late Opening" });
      await thread.say("What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it");
      t.modelSays(null);
      t.slotsRead({ policyHeading: "Late Opening" });
      const reply = await thread.say(REQUEST);
      expect(thread.proposal, `no CA card for Isolde Brannock:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Isolde Brannock" });
      expect(reply.content, `a policy the manager never named is "as you said":\n${reply.content}`).not.toMatch(/Late Opening,? as you said/i);
      expect(reply.content, `the card is about Late Opening:\n${reply.content}`).not.toMatch(/\*\*Policy:\*\* Late Opening/i);
    },
  },
];

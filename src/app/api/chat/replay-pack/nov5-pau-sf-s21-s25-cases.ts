import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PAU'S sf-s21 … sf-s25 (this app's production, 4 Nov 2026; full transcripts
 * relayed by QA, 5 Nov 2026)
 * ============================================================================
 *
 * Cases only: each is OPEN with today's production flags and no fixFlags until
 * a fix exists. The manager's turns are verbatim (typos, tabs, line breaks);
 * every person is invented: Wynne Sarrow is the employee, Tamsyn Fairlow the
 * employee whose Corrective Action was pasted as a template, Corwen Pell the
 * employee in a reviewer's pasted notes. Where the live model wrote the text
 * at fault, the stand-in model writes what it wrote, and the case asserts what
 * the app shows or saves.
 */

type T = ReplayContext;

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

const PEOPLE: readonly DirectoryRow[] = [
  person("e-wynne-sarrow", "Wynne", "Sarrow"),
  person("e-tamsyn-fairlow", "Tamsyn", "Fairlow"),
  person("e-corwen-pell", "Corwen", "Pell"),
];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function pauSfS21People(): readonly DirectoryRow[] {
  return PEOPLE;
}

const REPORT = "Pau via QA, 5 Nov 2026 (this app's production, 4 Nov)";

/** The "as you said" fix: the card's policy line reads the manager's words, not the stored heading. */
const SAID_ONLY = ["CA_POLICY_SAID_ONLY_ENABLED"];

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The card's Policy line, or "". */
function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

/** The card's Observation of Offense line, or "". */
function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

/** "as you said" on a Policy line naming a policy the manager never typed. */
function claimsUnsaid(reply: ReplayAnswer, said: readonly string[]): string | null {
  const line = policyLine(reply);
  const claim = /\*\*Policy:?\*\*\s*([^,—]+?)(?:\s+Policy)?(?:,|\s+—)[^\n]*\bas you said\b/i.exec(line);
  if (!claim) return null;
  const policy = claim[1]!.trim().toLowerCase();
  return said.some((turn) => turn.toLowerCase().includes(policy)) ? null : claim[1]!.trim();
}

const S21_T1 = "create a ca for must see behaviors for performace  this should be for wynne sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";
const TEMPLATE =
  "Observation of Offense:  During the month of September 2026, Tamsyn completed 237 tanning transactions. Throughout these transactions, Tamsyn failed to follow their Must See Behaviors resulting in a performance below Sun Tan City averages in the following areas UPTA, Average Club, CC%, and Spa %.  \n\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client. In order to ensure the best results for our clients, every employee is expected to follow their Client Service Must See Behaviors and Engagement Must See Behaviors with every client interaction.\t\n\nAction Plan:  The Leadership Team will coach Tamsyn on Must See Behaviors to make sure these are not only understood but also put into practice. Tamsyn is expected to follow these Must See Behaviors with every client interaction. Failure to consistenly meet expectations may result in additional corrective action up to and including termination of employment.";
const REVIEWER_NOTES =
  "Please make the following edits and resubmit:\n\n1. **Kit Coaching Document:** This was signed on 10/16/2026. I do not see a date showing that Spa/EFT was signed by Corwen. Please make sure all coaching documents are signed and dated (mm/dd/yyyy format) before uploading.\n\n2. **Details – Observed:** Please reword this section to:\n   \n   For the month of October 2026, Corwen completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa%.\n\n3. **Policy Violated:** Please change this from **Under Performance** to **Standards of Conduct**, as the second bullet under that policy is lack of sales performance. You may need to manually add this bullet.";

export const NOV5_PAU_SF_S21_S25_CASES: ReplayCase[] = [
  {
    id: "nov5-sf-s21-must-see-behaviors-template",
    title: "sf-s21: \"create a ca for must see behaviors …\": no \"Standards of Conduct, as you said\"; the template's outline is applied with Wynne's own facts, never \"I haven't changed the form\"",
    report: `${REPORT}, sf-s21`,
    status: { open: "\"**Policy:** Standards of Conduct, as you said\" on turn 1 (the intent read's heading, as in the live trace), and the template turns are answered \"I haven't changed the Corrective Action Form\"" },
    async run(t) {
      const thread = start(t);
      const said: string[] = [S21_T1];
      // The live trace (5 Nov 2026): the intent read returned policyHeading "Standards of Conduct" (p.12) for this turn.
      t.slotsRead({ policyHeading: "Standards of Conduct" });
      const first = await thread.say(S21_T1);
      t.slotsRead({});
      expect(thread.proposal, `no CA card for Wynne Sarrow:\n${first.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      expect(claimsUnsaid(first, said), `"as you said" for a policy the manager never typed:\n${policyLine(first)}`).toBeNull();
      t.draftWrites({ observation: "Observed:\nIn October 2026, Wynne completed 146 tanning transactions and was below average in PPTA, LPSVA, Average Club, CC%, and Spa%." });
      await thread.create();
      for (const turn of [TEMPLATE, "No this should be the same out line but with wynnes info i told you in the first chat", "I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for Wynne."]) {
        said.push(turn);
        const reply = await thread.say(turn);
        expect(reply.content, `a requested change answered as nothing changed:\n${reply.content}`).not.toMatch(/I haven'?t changed the \*\*Corrective Action Form\*\*/);
      }
    },
  },
  {
    id: "nov5-sf-s22-ca-not-coaching",
    title: "sf-s22: \"It needs to be a CA, not a coaching form\" and \"Its a CA\" keep the Corrective Action; another employee's reviewer notes never go into the Observation",
    report: `${REPORT}, sf-s22`,
    status: { open: "after \"It needs to be a CA\" the card goes back to \"Here is what I would put on a Coaching Form\", and the Observation carries Corwen's reviewer notes" },
    fixFlags: ["OBSERVATION_OTHER_PERSON_TURN_ENABLED", "PASTED_BLOCK_FORM_ENABLED", "NEW_PERSON_OWN_WORDS_ENABLED"],
    async run(t) {
      const thread = start(t);
      const first = await thread.say(
        "create a ca for must see behaviors for performace  this should be for wynne sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%  but i need it to be in the format of Tamsyn ca  it needs to look exactally the same as tamsyns but wtih all of this information",
      );
      expect(thread.proposal, `no CA card:\n${first.content}`).toMatchObject({ templateKey: "dpoa" });
      await thread.say(`Use this to make it: ${REVIEWER_NOTES}`);
      const caTurn = await thread.say("It needs to be a CA, not a coaching form");
      expect(thread.proposal, `"It needs to be a CA" is not a Corrective Action:\n${caTurn.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(observationLine(caTurn), `another employee's notes in the Observation:\n${observationLine(caTurn)}`).not.toMatch(/Corwen/i);
      // QA, 5 Nov 2026: the card still reads back turn 1's facts after "It needs to be a CA".
      expect(observationLine(caTurn), `"It needs to be a CA" lost the account:\n${caTurn.content}`).toMatch(/146 tans/);
      const again = await thread.say(`Make this:${REVIEWER_NOTES}`);
      expect(again.content, `back to the Coaching Form after "It needs to be a CA":\n${again.content}`).not.toMatch(/what I would put on a \*\*Coaching Form\*\*/);
      const its = await thread.say("Its a CA");
      expect(thread.proposal, `"Its a CA" is still a Coaching Form:\n${its.content}`).toMatchObject({ templateKey: "dpoa" });
    },
  },
  {
    id: "nov5-sf-s23-payroll-answer-and-policy-change",
    title: "sf-s23: \"not pay roll deductable\" answers the payroll question (not the Observation, not asked again); \"under performance not standard of conduct\" changes the Action Plan and Direct policy too",
    report: `${REPORT}, sf-s23`,
    status: { open: "\"not pay roll deductable\" becomes the card's Observation and the payroll question is asked again" },
    fixFlags: ["PAYROLL_ANSWER_SPELLING_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("can you write me a Ca for wynne sarrow for performance for october");
      const payroll = await thread.say("not pay roll deductable");
      // The question as asked is bold ("**Is payroll deduct applicable?** Yes or No?"); the answer read back
      // ("Is payroll deduct applicable? **No** — tell me if that should change.") is not asking it again.
      expect(payroll.content, `the payroll question is asked again:\n${payroll.content}`).not.toMatch(/\*\*Is payroll deduct applicable\?\*\*/);
      expect(observationLine(payroll), `the payroll answer is the Observation:\n${observationLine(payroll)}`).not.toMatch(/pay\s*roll/i);
    },
  },
  {
    id: "nov5-sf-s24-must-see-behaviors-and-coaching-on-file",
    title: "sf-s24: \"it should be must see behaviors and she also had coaching on file …\": no \"Standards of Conduct, as you said\"; the card and the saved form agree",
    report: `${REPORT}, sf-s24`,
    // Reproduced with the live trace's intent read (policyHeading "Standards of Conduct"; QA, 5 Nov 2026).
    status: { open: "\"**Policy:** Standards of Conduct, as you said\" although the manager said must see behaviors" },
    fixFlags: SAID_ONLY,
    async run(t) {
      const thread = start(t);
      const t1 = "Can you write me a performace ca for an employee who did not meet their numbers for the month of october Wynne Sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";
      const t2 = "it should be must see behaviors and she also had coaching on file for open ended questions coahing done one 10/22 and sunless bundle coachings done 10/15";
      await thread.say(t1);
      // The live trace (5 Nov 2026): the intent read returned policyHeading "Standards of Conduct" (p.12) for this turn.
      t.slotsRead({ policyHeading: "Standards of Conduct" });
      const reply = await thread.say(t2);
      expect(claimsUnsaid(reply, [t1, t2]), `"as you said" for a policy the manager never typed:\n${policyLine(reply)}`).toBeNull();
    },
  },
  {
    id: "nov5-sf-s25-closing-no-late-opening-claim",
    title: "sf-s25: a closing account is never \"Late Opening, as you said\"; the Observation is the incident, not the earlier question",
    report: `${REPORT}, sf-s25`,
    status: { open: "the card's Observation begins with the earlier question (\"What policy would it be …\")" },
    fixFlags: ["OBSERVATION_NOT_EARLIER_QUESTION_ENABLED", "CARD_POLICY_DESCRIBED_ENABLED"],
    // The live "Late Opening, as you said" is asserted too (the trace's heading is read); here the Observation fails first.
    async run(t) {
      const thread = start(t);
      const said = [
        "closing policy",
        "What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it",
        "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.",
      ];
      await thread.say(said[0]!);
      await thread.say(said[1]!);
      // The live trace (5 Nov 2026): the intent read returned policyHeading "Late Opening" (p.15) for this turn.
      t.slotsRead({ policyHeading: "Late Opening" });
      const reply = await thread.say(said[2]!);
      expect(claimsUnsaid(reply, said), `"as you said" for a policy the manager never typed:\n${policyLine(reply)}`).toBeNull();
      expect(observationLine(reply), `the earlier question is in the Observation:\n${observationLine(reply)}`).not.toMatch(/What policy would it be/i);
      // QA, 5 Nov 2026: a closing account never cites Late Opening (the intent read's heading, stored).
      expect(reply.content, `a closing account cites Late Opening:\n${reply.content}`).not.toMatch(/Late Opening/i);
    },
  },
  {
    id: "nov5-sf-s21-no-as-you-said",
    title: "sf-s21 turn 1 alone: the intent read's \"Standards of Conduct\" is never \"as you said\"",
    report: `${REPORT}, sf-s21`,
    status: { open: "\"**Policy:** Standards of Conduct, as you said\" on turn 1 (the intent read's heading, as in the live trace)" },
    fixFlags: SAID_ONLY,
    async run(t) {
      const thread = start(t);
      t.slotsRead({ policyHeading: "Standards of Conduct" });
      const first = await thread.say(S21_T1);
      expect(thread.proposal, `no CA card for Wynne Sarrow:\n${first.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      expect(claimsUnsaid(first, [S21_T1]), `"as you said" for a policy the manager never typed:\n${policyLine(first)}`).toBeNull();
    },
  },
  {
    id: "nov5-sf-s25-no-late-opening-claim",
    title: "sf-s25 alone: a closing account is never \"Late Opening, as you said\"",
    report: `${REPORT}, sf-s25`,
    // A guard: here the turn takes the "what I would put on" path, which has no
    // "as you said" line, so the live claim does not reproduce. The reader that
    // wrote it live is the one sf-s24 reaches (ca-policy-said-only.test.ts has
    // the "Late Opening" sentence).
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const said = [
        "closing policy",
        "What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it",
        "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.",
      ];
      await thread.say(said[0]!);
      await thread.say(said[1]!);
      t.slotsRead({ policyHeading: "Late Opening" });
      const reply = await thread.say(said[2]!);
      expect(claimsUnsaid(reply, said), `"as you said" for a policy the manager never typed:\n${policyLine(reply)}`).toBeNull();
    },
  },
];

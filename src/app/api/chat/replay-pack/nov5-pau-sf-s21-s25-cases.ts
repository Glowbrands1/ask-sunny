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
const S22_T1 =
  "create a ca for must see behaviors for performace  this should be for wynne sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%  but i need it to be in the format of Tamsyn ca  it needs to look exactally the same as tamsyns but wtih all of this information";
const TEMPLATE =
  "Observation of Offense:  During the month of September 2026, Tamsyn completed 237 tanning transactions. Throughout these transactions, Tamsyn failed to follow their Must See Behaviors resulting in a performance below Sun Tan City averages in the following areas UPTA, Average Club, CC%, and Spa %.  \n\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client. In order to ensure the best results for our clients, every employee is expected to follow their Client Service Must See Behaviors and Engagement Must See Behaviors with every client interaction.\t\n\nAction Plan:  The Leadership Team will coach Tamsyn on Must See Behaviors to make sure these are not only understood but also put into practice. Tamsyn is expected to follow these Must See Behaviors with every client interaction. Failure to consistenly meet expectations may result in additional corrective action up to and including termination of employment.";
/** The template's outline with Wynne's own facts, as the revision model writes it (the stand-in). */
const TEMPLATE_WITH_WYNNE = {
  observation:
    "During the month of October 2026, Wynne completed 146 tanning transactions. Throughout these transactions, Wynne failed to follow their Must See Behaviors resulting in a performance below Sun Tan City averages in the following areas PPTA, LPSVA, Average Club, CC%, and Spa%.\n\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client. In order to ensure the best results for our clients, every employee is expected to follow their Client Service Must See Behaviors and Engagement Must See Behaviors with every client interaction.",
  action_plan:
    "The Leadership Team will coach Wynne on Must See Behaviors to make sure these are not only understood but also put into practice. Wynne is expected to follow these Must See Behaviors with every client interaction. Failure to consistently meet expectations may result in additional corrective action up to and including termination of employment.",
};
const REVIEWER_NOTES =
  "Please make the following edits and resubmit:\n\n1. **Kit Coaching Document:** This was signed on 10/16/2026. I do not see a date showing that Spa/EFT was signed by Corwen. Please make sure all coaching documents are signed and dated (mm/dd/yyyy format) before uploading.\n\n2. **Details – Observed:** Please reword this section to:\n   \n   For the month of October 2026, Corwen completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa%.\n\n3. **Policy Violated:** Please change this from **Under Performance** to **Standards of Conduct**, as the second bullet under that policy is lack of sales performance. You may need to manually add this bullet.";

export const NOV5_PAU_SF_S21_S25_CASES: ReplayCase[] = [
  {
    id: "nov5-sf-s21-must-see-behaviors-template",
    title: "sf-s21: \"create a ca for must see behaviors …\": no \"Standards of Conduct, as you said\"; the template's outline is applied with Wynne's own facts, never \"I haven't changed the form\"",
    report: `${REPORT}, sf-s21`,
    // Changed on purpose (10 Nov 2026): fixed in production by TEMPLATE_OUTLINE_FIELDS_ENABLED, QA round 23.
    status: "fixed",
    // Fixed under TEMPLATE_OUTLINE_FIELDS_ENABLED (coding 6, 10 Nov 2026): the template's outline writes its fields; "not the standard of
    // conduct" is answered with why Standards of Conduct stays (QA's ruling). Open on production flags until QA flips it.
    fixFlags: ["TEMPLATE_OUTLINE_FIELDS_ENABLED"],
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
        // Changed on purpose (coding 6, 10 Nov 2026): the revision model's stand-in writes the template's outline with Wynne's facts,
        // as the live model was asked to (it is shown the template and her facts). Unscripted, it wrote nothing, and no fix could hold.
        t.revisionWrites(TEMPLATE_WITH_WYNNE);
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
    async run(t) {
      const thread = start(t);
      const first = await thread.say(S22_T1);
      expect(thread.proposal, `no CA card:\n${first.content}`).toMatchObject({ templateKey: "dpoa" });
      await thread.say(`Use this to make it: ${REVIEWER_NOTES}`);
      const caTurn = await thread.say("It needs to be a CA, not a coaching form");
      expect(thread.proposal, `"It needs to be a CA" is not a Corrective Action:\n${caTurn.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(observationLine(caTurn), `another employee's notes in the Observation:\n${observationLine(caTurn)}`).not.toMatch(/Corwen/i);
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
    // Changed on purpose (10 Nov 2026): fixed in production by PAYROLL_SPLIT_WORDS_ENABLED, QA round 19; it now holds with production's flags.
    status: "fixed",
    // Fixed under PAYROLL_SPLIT_WORDS_ENABLED (coding 6, 10 Nov 2026): "not pay roll deductable" answers payroll No; open on production flags until QA flips it.
    fixFlags: ["PAYROLL_SPLIT_WORDS_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("can you write me a Ca for wynne sarrow for performance for october");
      const payroll = await thread.say("not pay roll deductable");
      // Changed on purpose (coding 6, 10 Nov 2026): the card's read-back of the answer ("Is payroll deduct applicable? **No** —
      // tell me if that should change.", `ai/form-proposal.ts`) is the answer shown, not the question asked again.
      expect(payroll.content, `the payroll question is asked again:\n${payroll.content}`).not.toMatch(/Is payroll deduct applicable\?(?!\s*\*\*(?:Yes|No)\*\*)/);
      expect(observationLine(payroll), `the payroll answer is the Observation:\n${observationLine(payroll)}`).not.toMatch(/pay\s*roll/i);
    },
  },
  {
    id: "nov5-sf-s24-must-see-behaviors-and-coaching-on-file",
    title: "sf-s24: \"it should be must see behaviors and she also had coaching on file …\": no \"Standards of Conduct, as you said\"; the card and the saved form agree",
    report: `${REPORT}, sf-s24`,
    // Reproduced with the live trace's intent read (policyHeading "Standards of Conduct"; QA, 5 Nov 2026).
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
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
    },
  },
];

/*
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026): with the flag on, sf-s22's first card lost
 * "Standards of Conduct Policy, JBA Policy Manual p.12" and its Action Plan's policy (the citation read the turn's lines
 * as turns, and "… in the format of Tamsyn ca …" as a new request); its later cards lost both, and the Observation lost
 * Wynne's own facts ("146 tans …"): the pasted reviewer notes ("1. **Kit Coaching Document:** …") and "It needs to be a
 * CA, not a coaching form" were read as requests of their own. sf-s21's template turn the same. One request, whatever
 * is pasted into it.
 */
const SECOND_REQUEST = "SECOND_REQUEST_OWN_ACCOUNT_ENABLED";
const GATE = "QA's Sunny round-4 gate (8 Nov 2026): SECOND_REQUEST_OWN_ACCOUNT lost the Policy and Wynne's own facts (sf-s21, sf-s22)";

export const NOV8_SECOND_REQUEST_ONE_REQUEST_PASTED_CASES: ReplayCase[] = [
  {
    id: "nov8-second-request-sf-s22-one-request",
    title: "sf-s22 with SECOND_REQUEST_OWN_ACCOUNT on: every card cites Standards of Conduct p.12 and keeps Wynne's own facts",
    report: GATE,
    status: "fixed",
    fixFlags: [SECOND_REQUEST],
    async run(t) {
      const thread = start(t);
      const first = await thread.say(S22_T1);
      expect(first.content, `turn 1 lost its citation:\n${first.content}`).toMatch(/Standards of Conduct Policy, JBA Policy Manual p\.12/);
      expect(first.content, `turn 1's Action Plan lost its policy:\n${first.content}`).toMatch(/review the Standards of Conduct policy with Wynne/);
      const second = await thread.say(`Use this to make it: ${REVIEWER_NOTES}`);
      expect(observationLine(second), `turn 2's Observation lost Wynne's own facts:\n${observationLine(second)}`).toMatch(/146 tans/);
      const third = await thread.say("It needs to be a CA, not a coaching form");
      expect(third.content, `turn 3 lost its citation:\n${third.content}`).toMatch(/Standards of Conduct Policy, JBA Policy Manual p\.12/);
      expect(observationLine(third), `turn 3's Observation lost Wynne's own facts:\n${observationLine(third)}`).toMatch(/146 tans/);
    },
  },
  {
    id: "nov8-second-request-sf-s21-template-one-request",
    title: "sf-s21 with SECOND_REQUEST_OWN_ACCOUNT on: the pasted template is not a request of its own; the Observation keeps Wynne's own facts",
    report: GATE,
    status: "fixed",
    fixFlags: [SECOND_REQUEST],
    async run(t) {
      const thread = start(t);
      await thread.say(S21_T1);
      const reply = await thread.say(TEMPLATE);
      expect(observationLine(reply), `the Observation lost Wynne's own facts:\n${observationLine(reply)}`).toMatch(/146 tans/);
    },
  },
];

/*
 * TEMPLATE_OUTLINE_FIELDS_ENABLED (coding 6, 10 Nov 2026): sf-s21 with what is SAVED. "the same out line" writes the
 * template's Observation AND Action Plan with Wynne's facts; "the Must see behaviors and not the standard of conduct"
 * keeps Standards of Conduct (the manual has no Must See Behaviors section) and says why (QA's ruling).
 */
export const NOV10_TEMPLATE_OUTLINE_CASES: ReplayCase[] = [
  {
    id: "nov10-sf-s21-template-outline-saved",
    title: "sf-s21: \"the same out line but with wynnes info\" saves the template's Observation and Action Plan; \"not the standard of conduct\" says why it stays",
    report: `${REPORT}, sf-s21`,
    // Changed on purpose (10 Nov 2026): fixed in production by TEMPLATE_OUTLINE_FIELDS_ENABLED, QA round 23.
    status: "fixed",
    fixFlags: ["TEMPLATE_OUTLINE_FIELDS_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(S21_T1);
      t.draftWrites({ observation: "Observed:\nIn October 2026, Wynne completed 146 tanning transactions and was below average in PPTA, LPSVA, Average Club, CC%, and Spa%." });
      const id = await thread.create();
      t.revisionWrites(TEMPLATE_WITH_WYNNE);
      await thread.say(TEMPLATE);
      t.revisionWrites(TEMPLATE_WITH_WYNNE);
      const outline = await thread.say("No this should be the same out line but with wynnes info i told you in the first chat");
      const saved = t.values(id);
      expect(saved.observation ?? "", `the template's Observation was not saved:\n${outline.content}`).toMatch(/Wynne completed 146 tanning transactions/);
      expect(saved.action_plan ?? "", `the template's Action Plan was not saved:\n${outline.content}`).toMatch(/Leadership Team will coach Wynne on Must See Behaviors/);
      expect(JSON.stringify(saved), "the template's employee is on Wynne's form").not.toMatch(/Tamsyn/);
      t.revisionWrites(TEMPLATE_WITH_WYNNE);
      const last = await thread.say("I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for Wynne.");
      expect(last.content, "the last ask is answered as nothing changed").not.toMatch(/I haven'?t changed|I didn'?t change anything/);
      expect(last.content, `the reply does not say why Standards of Conduct stays:\n${last.content}`).toMatch(/Must See Behaviors is part of the Standards of Conduct policy/);
      expect(t.values(id).policy_violated, "the policy left Standards of Conduct").toBe("Standards of Conduct");
    },
  },
];

/*
 * QA's Sunny round-23 live test of sf-s21 (10 Nov 2026, conv_mwb21a4z2rxf5y1, main 227340dd, an all-salon admin, the
 * turns as typed): 5a S21_T1 and Create; 5b the pasted TEMPLATE → "Is this for Tamsyn?" and a new card over the
 * draft; 5c "No this should be the same out line …" → the new card, Salon "MO St Joseph"; 5d → a new card for
 * "Wynne". Saved: the 5a metrics sentence, no outline. The case above scripts the revision model to write the
 * outline, so it never saw the turn go elsewhere. Here the revision model is the stand-in (it writes nothing), and
 * the invariants are where each turn goes and what the revision model is HANDED.
 */
const LIVE_5C = "No this should be the same out line but with wynnes info i told you in the first chat";
const LIVE_5D = "I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for Wynne.";

export const NOV10_R23_SF_S21_LIVE_CASES: ReplayCase[] = [
  {
    // The live test's people were invented. Off the directory, 5a here asks before any card (OFF_ROSTER_ASK_BEFORE_CARD),
    // and how the tester answered is not recorded, so the case starts from the state live reached: Wynne's CA created.
    id: "nov10-r23-sf-s21-pasted-outline-to-open-draft",
    title: "sf-s21 as QA's r23 live test ran it: with Wynne's CA draft open, the pasted Tamsyn CA is that draft's outline — no new card, no \"Is this for Tamsyn?\", and the revision is handed the outline with the draft's own facts",
    report: `QA's Sunny round-23 live test, conv_mwb21a4z2rxf5y1: 5b "Is this for Tamsyn?" and a new card over Wynne's draft; the outline never saved`,
    // Changed on purpose (11 Nov 2026): fixed in production by PASTED_OUTLINE_TO_OPEN_DRAFT_ENABLED, QA round 25. Was OPEN ("the pasted outline names Tamsyn, so it is read as a new request: a new card covers Wynne's draft and the outline never reaches it").
    status: "fixed",
    fixFlags: ["PASTED_OUTLINE_TO_OPEN_DRAFT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T19:00:00Z"));
      t.directory([...STAFF, ...PEOPLE]);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never);
      const thread = t.thread();
      await thread.say(S21_T1);
      // Off the directory the name proceeds as typed ("wynne sarrow", TYPED_NAME_PROCEEDS).
      expect(thread.proposal, "5a: no CA card").toMatchObject({ templateKey: "dpoa" });
      expect(thread.proposal?.employeeName ?? "", "5a: the card is not Wynne Sarrow's").toMatch(/^wynne sarrow$/i);
      t.draftWrites({ observation: "Observed:\nWynne completed 146 tans, below average in PPTA, LPSVA, Average Club, CC% and Spa%." });
      const draft = await thread.create();
      const asked = (t.revisionPrompts?.() ?? []).length;
      for (const [turn, label] of [[TEMPLATE, "5b"], [LIVE_5C, "5c"], [LIVE_5D, "5d"]] as const) {
        const reply = await thread.say(turn);
        // No new card: so no "MO St Joseph" salon and no first-name-only "Wynne" card (live 5c and 5d) either.
        expect(reply.formProposal ?? null, `${label}: a new card over Wynne's open draft:\n${reply.content}`).toBeNull();
        // QA (10 Nov): the outline's other person never triggers "Is this for <name>?" and never becomes the draft's employee.
        expect(reply.content, `${label}: asked whether the form is for Tamsyn`).not.toMatch(/is this for \**tamsyn/i);
        expect(reply.content, `${label}: asked who the form is for`).not.toMatch(/is this for \*\*|who is this (?:form )?for\?/i);
        expect(t.values(draft).employee_name ?? "", `${label}: the open draft's employee changed`).toMatch(/^wynne sarrow$/i);
      }
      const prompts = (t.revisionPrompts?.() ?? []).slice(asked).join("\n");
      expect(prompts, "the revision was never handed the pasted outline").toMatch(/Observation of Offense:/);
      expect(prompts, "the revision was not asked to rewrite the Action Plan in the outline").toMatch(/rewrite the Action Plan/i);
    },
  },
];

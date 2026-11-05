import { expect, vi } from "vitest";

import {
  endsAsSentence,
  KEARNEY,
  noAsYouSaidUnlessSaid,
  STAFF,
  type DirectoryRow,
  type ReplayAnswer,
  type ReplayCase,
  type ReplayContext,
} from "./cases";

/**
 * ============================================================================
 * THE 5 NOV 2026 SILENT-FAILURE SET (PLAN.md, Step 0)
 * ============================================================================
 *
 * sf-s21 to sf-s29: production chats in this app, relayed by QA on 5 Nov 2026
 * with the employee's name replaced by "Employee R". Here "Employee R" is an
 * invented name (Odessa Quillfeather) and the other employee in sf-s21/sf-s22
 * is invented too (Rhea Vantress); both checked against both apps' directories.
 * The managers' words are otherwise exactly as relayed. What the model said
 * or wrote in production is scripted (`modelSays`, `draftWrites`,
 * `revisionWrites`), so each case asks whether CODE lets it through.
 *
 * sf-b6 is the sibling app's chat (its replay pack, same file name): the same
 * mechanism here — the form picker's heading while a form is in progress —
 * with this app's fixtures.
 *
 * Every case is open: each fails today with production's flags, on its own
 * assertion. A step that fixes one sets its `fixFlags`.
 */

type T = ReplayContext;
type Thread = ReturnType<T["thread"]>;

const SALON = "loc-0309";
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
});

const ODESSA = person("e-odessa-quillfeather", "Odessa", "Quillfeather");
const RHEA = person("e-rhea-vantress", "Rhea", "Vantress");
const TALIA = person("e-talia-brennick", "Talia", "Brennick");

const REPORT = "QA, 5 Nov 2026: the silent-failure scan (names replaced by \"Employee R\")";
const ASKS_WHAT_HAPPENED = /haven'?t told me what happened|what happened\?|tell me what happened/i;
const READY_CLAIM = /everything i need is here|i have everything|all set to draft|ready to draft/i;

function start(t: T): Thread {
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory([...STAFF, ODESSA, RHEA, TALIA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/*
 * FORM_FULL_REMAP_ENABLED is off in production in both apps (QA, Vercel read,
 * 5 Nov 2026). The "**Policy:** …, as you said" lines these chats showed come
 * only from `form-full-remap.ts`, so with production's flags sf-s21 and sf-s24
 * hold: their "as you said" failure is not a production defect. sf-s25 and
 * sf-s27 still fail with production's flags, on their own invariants.
 */

/** Every manager turn of a thread so far, as the checks read them. */
function managerTurns(said: readonly string[]): string[] {
  return [...said];
}

/** The other employee's CA, pasted by the manager as a template (sf-s21; invented, same shape). */
const PASTED_CA = [
  "Corrective Action — Rhea Vantress",
  "Type of warning: Verbal",
  "Observation: In September Rhea Vantress finished at 212 tans with PPTA 18.40, LPSVA 9%, Average Club 41, CC% 22% and Spa% 6%, below the salon goals for each.",
  "Policy Violated: Standards of Conduct",
  "Direct policy from official manual: Failing to follow the policies and procedures of The Company",
  "Action Plan: Rhea will review the Must See Behaviors with her Salon Director weekly. She will meet each goal by the end of October.",
].join("\n");

export const NOV5_SILENT_FAILURE_CASES: readonly ReplayCase[] = [
  {
    // Stricter variant of nov5-sf-s21-must-see-behaviors-template (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s21",
    title: "a CA for one employee's must see behaviors, then another employee's CA pasted as a template: only this employee's facts, no false \"as you said\", the asked-for fill applied",
    report: `${REPORT}: "create a ca for must see behaviors for performance this should be for Employee R - verbal 146 tans Below in PPTA, LPSVA, Average Club, CC%, Spa%" → "Policy: Standards of Conduct, as you said." A pasted CA for another employee; "I need you to fill in the information for me" saved the other employee's month and numbers.`,
    // Holds with production's flags: its failure needed FORM_FULL_REMAP_ENABLED, off in production (QA, 5 Nov 2026) — not a production defect.
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const said: string[] = [];
      const first = "create a ca for must see behaviors for performance this should be for Odessa Quillfeather - verbal 146 tans Below in PPTA, LPSVA, Average Club, CC%, Spa%";
      said.push(first);
      const card = await thread.say(first);
      noAsYouSaidUnlessSaid(card, managerTurns(said));
      t.draftWrites({ observation: "Observed:\nOdessa Quillfeather finished at 146 tans, below goal in PPTA, LPSVA, Average Club, CC% and Spa%." }, { offense_type: ["standards_of_conduct"] });
      const id = await thread.create();
      const paste = `can you make it look like this one with her info\n\n${PASTED_CA}`;
      said.push(paste);
      await thread.say(paste);
      // As in production: the revision copies the pasted form's facts.
      t.revisionWrites({ observation: "Observed:\nIn September Odessa Quillfeather finished at 212 tans with PPTA 18.40, LPSVA 9%, Average Club 41, CC% 22% and Spa% 6%, below the salon goals for each." });
      said.push("I need you to fill in the information for me");
      await thread.say("I need you to fill in the information for me");
      const saved = t.values(id);
      expect(saved.observation ?? "", "the other employee's month and numbers are on this employee's form").not.toMatch(/september|212 tans|18\.40/i);
      expect(saved.observation ?? "", "this employee's own facts are gone").toMatch(/146/);
    },
  },
  {
    // Stricter variant of nov5-sf-s22-ca-not-coaching (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s22",
    title: "\"It needs to be a CA, not a coaching form\": the type the manager typed wins and stays; another person's notes never reach the observation",
    report: `${REPORT}: "It needs to be a CA, not a coaching form" → the bot later went back to "Here is what I would put on a Coaching Form" twice after "Its a CA". Reviewer notes about another employee were pasted into the observation.`,
    status: { open: "Step 4 (explicit type wins) and a later step (pasted notes go to sourceNotes)" },
    async run(t) {
      const thread = start(t);
      await thread.say("coaching form for Odessa Quillfeather, she was below on spa% and CC% this month");
      const ca = await thread.say("It needs to be a CA, not a coaching form");
      expect(thread.proposal?.templateKey, `the card is not a CA after "It needs to be a CA":\n${ca.content}`).toBe("dpoa");
      t.modelSays("Here is what I would put on a Coaching Form for Odessa Quillfeather:\n\n- Spa% and CC% below goal this month.");
      const later = await thread.say("Its a CA");
      expect(later.content, "back to a Coaching Form after \"Its a CA\"").not.toMatch(/coaching form/i);
      expect(thread.proposal?.templateKey ?? "dpoa", "the card went back to a Coaching Form").toBe("dpoa");
      t.draftWrites({ observation: "Observed:\nReviewer notes for Rhea Vantress: Rhea missed two Must See Behaviors on the floor walk." });
      const id = await thread.create();
      expect(t.values(id).observation ?? "", "another employee's notes are in the observation").not.toMatch(/rhea/i);
    },
  },
  {
    // Stricter variant of nov5-sf-s23-payroll-answer-and-policy-change (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s23",
    title: "\"not pay roll deductable\" fills the payroll answer; moving the policy to Under Performance moves the action plan and policy text with it",
    report: `${REPORT}: "not pay roll deductable" → put in the observation and the payroll question asked again. "it should be under performance not standard of conduct" → the policy changed but the action plan and policy text still said Standards of Conduct.`,
    status: { open: "a later step: one apply function updates every field a policy change touches; the payroll answer fills its field" },
    async run(t) {
      const thread = start(t);
      await thread.say("CA for Odessa Quillfeather, verbal, she sold 4 clubs out of 60 guests this week");
      const answered = await thread.say("not pay roll deductable");
      expect(answered.content, "the payroll question is asked again after it was answered").not.toMatch(/payroll deduct(?:ion)?(?: applicable)?\?/i);
      t.draftWrites(
        {
          observation: "Observed:\nOdessa Quillfeather sold 4 clubs out of 60 guests this week.",
          action_plan: "Odessa will follow the Standards of Conduct on every shift. She will review the Standards of Conduct with her Salon Director.",
        },
        { offense_type: ["standards_of_conduct"] },
      );
      const id = await thread.create();
      expect(t.values(id).observation ?? "", "the payroll answer went into the observation").not.toMatch(/pay ?roll/i);
      await thread.say("it should be under performance not standard of conduct");
      const saved = t.values(id);
      expect(saved.action_plan ?? "", "the action plan still names Standards of Conduct after the policy moved").not.toMatch(/standards? of conduct/i);
    },
  },
  {
    // Stricter variant of nov5-sf-s24-must-see-behaviors-and-coaching-on-file (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s24",
    title: "\"it should be must see behaviors …\": no false \"as you said\"; the card and the saved form agree; the observation is not the whole message",
    report: `${REPORT}: "it should be must see behaviors and she also had coaching on file … 10/22 and … 10/15" → "Policy: Standards of Conduct, as you said."; the whole message in the observation; the saved policy was Under Performance.`,
    // Holds with production's flags: its failure needed FORM_FULL_REMAP_ENABLED, off in production (QA, 5 Nov 2026) — not a production defect.
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const said = ["CA for Odessa Quillfeather, verbal", "it should be must see behaviors and she also had coaching on file for it 10/22 and a coaching on 10/15"];
      await thread.say(said[0]!);
      const card = await thread.say(said[1]!);
      noAsYouSaidUnlessSaid(card, said);
      t.draftWrites({ observation: `Observed:\n${said[1]}` }, { offense_type: ["standards_of_conduct"] });
      const id = await thread.create();
      expect((t.values(id).observation ?? "").toLowerCase(), "the whole message is the observation").not.toContain(said[1]!.toLowerCase());
    },
  },
  {
    // Stricter variant of nov5-sf-s25-closing-no-late-opening-claim (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s25",
    title: "a CA with times: no invented \"as you said\" policy; the observation is the incident, not an earlier question",
    report: `${REPORT}: "Write a CA for Employee R … on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took the spray booths down at 8:11 PM before the salon was closed." → "Policy: Late Opening, as you said."; the observation held an earlier question.`,
    status: { open: "Step 6: \"as you said\" only for the manager's words; the observation never a question" },
    async run(t) {
      const thread = start(t);
      const question = "what policy covers leaving before the end of a shift?";
      const request =
        "Write a CA for Odessa Quillfeather on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took the spray booths down at 8:11 PM before the salon was closed.";
      await thread.say(question);
      const card = await thread.say(request);
      noAsYouSaidUnlessSaid(card, [question, request]);
      t.draftWrites({ observation: `Observed:\n${question}` });
      const id = await thread.create();
      expect(t.values(id).observation ?? "", "the observation is the manager's question").not.toMatch(/\?\s*$|what policy covers/i);
    },
  },
  {
    // Stricter variant of nov5-sf-s26-edit-misspelled-ca and nov5-sf-s26-change-ca-new-chat (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s26",
    title: "\"Change Employee R CA\" in a new chat finds the existing CA and opens it; a misspelled name still finds it",
    report: `${REPORT}: "Edit [misspelled Employee R] CA" → the bot asked who the form is for. New chat: "Change Employee R CA" → a new form, "You haven't told me what happened yet".`,
    status: { open: "a later step: the record finds the employee's open CA on file" },
    async run(t) {
      const first = start(t);
      await first.say("CA for Odessa Quillfeather, verbal, she left before the end of her shift on 11/3");
      t.draftWrites({ observation: "Observed:\nOdessa Quillfeather left before the end of her shift on 11/3." });
      await first.create();
      const misspelled = await t.thread().say("Edit Odesa Quilfeather CA");
      expect(misspelled.content, "asked who the form is for with the name given").not.toMatch(/who (?:is|should) (?:this|the form)/i);
      const reply = await t.thread().say("Change Odessa Quillfeather CA");
      expect(reply.content, "started a new form and asked what happened").not.toMatch(ASKS_WHAT_HAPPENED);
      expect(reply.formOpened, `the existing CA is not opened:\n${reply.content}`).toBeTruthy();
    },
  },
  {
    // Stricter variant of nov5-sf-s27-coaching-name-only-asks-what-happened (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s27",
    title: "\"Create a coaching form.\" then a name: asks what happened; never says everything is ready without an incident",
    report: `${REPORT}: "Create a coaching form." → "Employee R" → "Everything I need is here … I have the employee and the salon." with no draft and no incident.`,
    status: { open: "Step 2's missing-fields list: never \"ready\" while a required field is empty" },
    async run(t) {
      const thread = start(t);
      await thread.say("Create a coaching form.");
      const reply = await thread.say("Odessa Quillfeather");
      expect(reply.content, "says everything is ready with no incident").not.toMatch(READY_CLAIM);
      expect(reply.content, "does not ask what happened").toMatch(ASKS_WHAT_HAPPENED);
    },
  },
  {
    // Stricter variant of nov5-sf-s28-incident-from-previous-turn (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-s28",
    title: "the incident asked about one turn, the CA asked for the next: the incident is used, never \"You haven't told me what happened\"",
    report: `${REPORT}: "can i give a ca for not signing off on the cleaning check list" → "can you write me a ca for Employee R from o street" → "You haven't told me what happened yet" and the observation was the question.`,
    status: { open: "Step 2: the record carries the incident from the previous turn" },
    async run(t) {
      const thread = start(t);
      await thread.say("can i give a ca for not signing off on the cleaning check list");
      const reply = await thread.say("can you write me a ca for Odessa Quillfeather from o street");
      expect(reply.content, "asks what happened although the previous turn said").not.toMatch(ASKS_WHAT_HAPPENED);
      if (thread.proposal) {
        t.draftWrites({ observation: "Observed:\ncan i give a ca for not signing off on the cleaning check list" });
        const id = await thread.create();
        expect(t.values(id).observation ?? "", "the observation is the manager's question").not.toMatch(/can i give/i);
      }
    },
  },
  {
    id: "sf-s29",
    title: "\"are there any coaching and ca's for Employee R\": the forms on file are looked up, never a form card or a description of the CA",
    report: `${REPORT}: "are there any coaching and ca's for Employee R" → the bot described the CA form type instead of checking the employee's file.`,
    status: { open: "a later step: a question about forms on file is never a form request" },
    async run(t) {
      const thread = start(t);
      const before = t.calls().chat;
      const reply = await thread.say("are there any coaching and ca's for Odessa Quillfeather");
      expect(reply.formProposal ?? null, `a form card for a question about forms on file:\n${reply.content}`).toBeNull();
      expect((reply as ReplayAnswer & { formSelection?: unknown }).formSelection ?? null, "a form picker for a question about forms on file").toBeNull();
      expect(t.calls().chat, "the question was not answered from the forms on file").toBeGreaterThan(before);
    },
  },
  {
    // Stricter variant of nov5-twin-sf-b6-full-sentence-and-added-detail (QA, 5 Nov 2026: both kept until the pack is deduplicated).
    id: "sf-b6-reply",
    title: "(the sibling app's sf-b6) a detail added while a CA is on its proposal card: the reply never ends on the form picker's heading",
    report:
      "QA, 5 Nov 2026 (the sibling app): \"Reply ended mid-sentence: 'Based on what you've described, I can prepare:'\". The trace says the model finished (end_turn); the heading was the form picker's, offered while a CA was in progress.",
    status: { open: "REPLY_CUT_CHECK_ENABLED (Step 1): no picker or heading while a form is in progress" },
    async run(t) {
      const thread = start(t);
      const first = await thread.say("I need a corrective action form for Talia Brennick for closing the salon early and turning away a guest");
      expect(first.formProposal, "the first turn shows the Corrective Action card").toBeTruthy();
      const detail =
        "can you have it include that we recieved a guest complaint from Sunday 11-1, she started closing at 8:56pm and we cant close until the salon is closed at 9pm, we had a guest come in at 8:59 and was told them that we were closed";
      t.modelSays(
        "I can add that detail as the factual account on the form, but none of the sources available to me state a policy for this, so I'd leave the policy for you to complete.\n\nLet me know the warning level and payroll deduct, and I'll fold it all together.",
      );
      const reply = await thread.say(detail);
      endsAsSentence(reply, detail, true);
      expect(reply.content).toContain("I'll fold it all together.");
    },
  },
];

import { expect, vi } from "vitest";

import { KEARNEY, STAFF, noRepeatedReply, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * REGRESSION SET — QA'S OVERNIGHT SCAN (4 Nov 2026)
 * ============================================================================
 *
 * Eleven production chats QA's overnight scan flagged (sf-s11 … sf-s20, and
 * the sibling app's sf-b5 in this app's setting). The managers' turns are
 * kept word for word; every person is invented (the repository is public)
 * and is on this file's own directory fixture. Test-only: no fix path, no
 * flag, `fixFlags` left out until a step claims a case.
 *
 * Each case says, in a `Coverage (QA)` comment, which step of the master plan
 * QA maps it to, and what no step covers yet.
 *
 * The pack's clock reads 26 Oct 2026; these chats are dated in the first days
 * of November and name dates up to 2 Nov, so each case runs on the scan's
 * date (`onScanDate`) — a date after "today" would be refused for a reason
 * the managers never met.
 */

type T = ReplayContext;

const KEARNEY_SALON = "loc-0309";
/** A salon the Kearney salon director does not cover (NE Grand Island). */
const GRAND_ISLAND = "loc-0307";

const person = (id: string, firstName: string, lastName: string, positionName = "Tanning Consultant"): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [KEARNEY_SALON],
  positionName,
});

/* The invented people (QA's names), used the same way in every case. */
const ODALYS = person("e-odalys-frewen", "Odalys", "Frewen");
const PERRIN = person("e-perrin-haldane", "Perrin", "Haldane");
const ISOLDE = person("e-isolde-brannock", "Isolde", "Brannock");
const CALISTA = person("e-calista-venn", "Calista", "Venn");
const MARIT = person("e-marit-sollano", "Marit", "Sollano");
const JOVELLE = person("e-jovelle-kerrigan", "Jovelle", "Kerrigan");
/** On the directory as "Lysandra Quade"; the manager typed "LYsandra". */
const LYSANDRA = person("e-lysandra-quade", "Lysandra", "Quade");
/** On the directory as "Delphine Marlowe Ostrander"; the manager typed "Marlwoe". Her title is Woven's, never "District Manager". */
const DELPHINE = person("e-delphine-marlowe-ostrander", "Delphine", "Marlowe Ostrander", "Tanning Consultant");

const ROSTER: readonly DirectoryRow[] = [...STAFF, ODALYS, PERRIN, ISOLDE, CALISTA, MARIT, JOVELLE, LYSANDRA, DELPHINE];

/** The scan's date: the chats ran in early November. */
function onScanDate(): void {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
}

function start(t: T) {
  onScanDate();
  t.directory(ROSTER);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The card's "**Policy:** …" line (empty when the card has none). */
function policyLine(reply: ReplayAnswer | string): string {
  const content = typeof reply === "string" ? reply : reply.content;
  return content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

/** The card's account of the incident: its "**Observation of Offense:**" or "**Issue:**" line (empty when it has none). */
function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*(?:Observation of Offense|Issue):?\*\*/i.test(line)) ?? "";
}

/** The warning level the card carries (the pack's answer type leaves it out). */
function warningLevel(card: ReplayAnswer["formProposal"] | null | undefined): string | null {
  return (card as { warningLevel?: string | null } | null | undefined)?.warningLevel ?? null;
}

/** What the drafting model was handed as the manager's account, every Create. */
function described(t: T): string {
  return t
    .draftPrompts()
    .map((prompt) => prompt.split("WHAT THE MANAGER DESCRIBED:")[1] ?? "")
    .join("\n");
}

const WHO = /who is this\b[^?\n]*\bfor\?|which (?:employee|team member)|who(?:'s| is) (?:it|this) for/i;

const REPORT = "QA's overnight scan of production chats, 4 Nov 2026";

export const NOV4_OVERNIGHT_SCAN_CASES: readonly ReplayCase[] = [
  {
    /* Coverage (QA): steps 3+5+4+2 (partial). */
    id: "nov4-scan-sf-s11-same-for-another",
    title: "\"Can you do the same thing for Perrin Haldane but switch it to a written\" — a NEW Written CA for Perrin, Under Performance, with nothing of Odalys on it and the request never in the Observation",
    report: `${REPORT}, sf-s11: "what information do you need for a corrective action for an employee" → "Odalys Frewen. Verbal Warning. Under Performance." → "Can you do the same thing for Perrin Haldane but switch it to a written"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "turn 3 is read as an edit of Odalys Frewen's card: the card stays Odalys Frewen, Verbal, and its Observation of Offense becomes the request sentence \"Can you do the same thing for Perrin Haldane but switch it to a written\"; no card for Perrin Haldane" },
    async run(t) {
      const thread = start(t);
      await thread.say("what information do you need for a corrective action for an employee");
      await thread.say("Odalys Frewen. Verbal Warning. Under Performance.");
      expect(thread.proposal, "turn 2 made no CA card for Odalys Frewen").toMatchObject({ templateKey: "dpoa", employeeName: "Odalys Frewen" });
      t.draftWrites({ observation: "Observed:\nOdalys Frewen is under performing.\nExpectation:\nOdalys is expected to meet the salon's performance standards." });
      const first = await thread.create();
      const reply = await thread.say("Can you do the same thing for Perrin Haldane but switch it to a written");
      expect(t.values(first).employee_name, "the first CA no longer names Odalys Frewen").toBe("Odalys Frewen");
      expect(observationLine(reply), "the request sentence is the card's Observation").not.toMatch(/do the same thing|switch it to a written/i);
      expect(reply.formProposal, `turn 3 made no new card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Perrin Haldane" });
      expect(warningLevel(reply.formProposal), "the new card is not a Written Warning").toBe("written");
      expect(reply.content, "the new card lost the Under Performance reason").toMatch(/under ?performance/i);
      expect(reply.content, "Odalys is on Perrin's card").not.toMatch(/odalys|frewen/i);
      expect(reply.content, "the request sentence is on the card").not.toMatch(/do the same thing|switch it to a written/i);
      t.draftWrites({ observation: "Observed:\nPerrin Haldane is under performing.\nExpectation:\nPerrin is expected to meet the salon's performance standards." });
      const second = await thread.create();
      expect(second, "Perrin's CA is the first form, not a new one").not.toBe(first);
      expect(t.values(second).employee_name).toBe("Perrin Haldane");
      expect(described(t), "the request sentence was handed to the drafting model as the account").not.toMatch(/do the same thing|switch it to a written/i);
      expect(JSON.stringify(t.values(second)), "Odalys is on Perrin's form").not.toMatch(/odalys|frewen/i);
    },
  },
  {
    /* Coverage (QA): NOT COVERED (needs a company abbreviation glossary). */
    id: "nov4-scan-sf-s12-msb-not-a-person",
    title: "\"I need to make a corrective action for msb\" — MSB is Must See Behaviors (the reason), not a person: ask which employee, never save \"Msb\" as the name",
    report: `${REPORT}, sf-s12: "I need to make a corrective action for msb"`,
    // Run 4 Nov 2026 (production flags): "msb" was taken as the employee ("I can create a Corrective Action Form for **msb**").
    // Fixed by CHAT_GLOSSARY_ENABLED (the approved abbreviation table), on in production from 4 Nov 2026 (QA's flip; MSB meaning confirmed by Pau).
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need to make a corrective action for msb");
      expect(thread.proposal?.employeeName ?? "", "a card names \"Msb\"").not.toMatch(/\bmsb\b/i);
      expect(reply.content, "\"Msb\" is treated as a person").not.toMatch(/\bfor \**msb\b|\bmsb\** (?:is not|isn'?t|was not|wasn'?t) (?:on|in)|find[^.\n]*\bmsb\b/i);
      expect(reply.content, `the reply does not ask which employee:\n${reply.content}`).toMatch(WHO);
    },
  },
  {
    /* Coverage (QA): step 4 + steps 5/6, but the whole-team / blank-employee path is NOT COVERED. */
    id: "nov4-scan-sf-s13-team-coaching-blank-employee",
    title: "a team Coaching Form at Kearney on selling Spray Tan Kits and rainchecks, employee left blank — no product name or instruction in a field",
    report: `${REPORT}, sf-s13: "I need to make a coaching form for the team at Kearney on selling Spray Tan Kits, not writing proper rainchecks which results in inventory not being correct." → "The employee needs to be left blank for now"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "the product is taken as the employee: the coaching card is for \"Spray Tan Kits\" at both turns, \"I have the employee and the salon\", and turn 2's instruction \"The employee needs to be left blank for now\" is appended to the card's Observation" },
    async run(t) {
      const thread = start(t);
      await thread.say(
        "I need to make a coaching form for the team at Kearney on selling Spray Tan Kits, not writing proper rainchecks which results in inventory not being correct.",
      );
      const reply = await thread.say("The employee needs to be left blank for now");
      const card = thread.proposal;
      expect(card, `no coaching card:\n${reply.content}`).toMatchObject({ templateKey: "coaching" });
      expect(card?.employeeName ?? "", "a product or the instruction is the employee").not.toMatch(/spray|tan kits|kits|left blank|employee needs/i);
      expect(card?.locationId ?? KEARNEY_SALON, "the card is not at Kearney").toBe(KEARNEY_SALON);
      t.draftWrites({ coaching_details: "Observed:\nThe team is not selling kits and is not writing proper rainchecks, so inventory is not correct.\nExpectation:\nEvery raincheck is written in full." });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.employee_name ?? "", "the Employee Name is not blank").not.toMatch(/spray|kits|left blank|employee needs/i);
      expect(described(t), "the account handed to the drafting model lost the rainchecks").toMatch(/raincheck/i);
      expect(described(t), "the manager's instruction was handed over as the account").not.toMatch(/needs to be left blank/i);
    },
  },
  {
    /* Coverage (QA): NOT COVERED (location/scope resolution). */
    id: "nov4-scan-sf-s14-team-coaching-other-salon",
    title: "a team coaching form at a salon outside the manager's scope (Grand Island) — confirm the salon or say she cannot file for it; never switch silently to Kearney",
    report: `${REPORT}, sf-s14: "can you make me a coahcing form for my entire team at Grand Island for selling kits and not writing raing checks"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "a team coaching card is made for Grand Island (loc-0307), outside the Kearney salon director's scope, with no question and no word that she cannot file for it" },
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("can you make me a coahcing form for my entire team at Grand Island for selling kits and not writing raing checks");
      expect(reply.formProposal?.locationId ?? null, "the card switched silently to the manager's own salon").not.toBe(KEARNEY_SALON);
      const confirms = /grand island/i.test(reply.content) && /\?/.test(reply.content);
      const cannot = /grand island/i.test(reply.content) && /(?:can'?t|cannot|not able to|don'?t have access|outside (?:your|the) )/i.test(reply.content);
      expect(confirms || cannot, `neither asks to confirm Grand Island nor says she cannot file for it:\n${reply.content}`).toBe(true);
      expect(reply.formProposal?.locationId ?? null, "a card was made for a salon she does not cover").not.toBe(GRAND_ISLAND);
    },
  },
  {
    /* Coverage (QA): step 7, but the "as you said" attribution is NOT COVERED. */
    id: "nov4-scan-sf-s15-opening-duties-cleaning",
    title: "a CA for not completing opening/cleaning duties on 11/2/2026 — Care and Cleaning of Equipment and Facilities (p.21), not Late Opening or Attendance, and no \"as you said\"",
    report: `${REPORT}, sf-s15: "Write me a CA for Isolde Brannock for failing to complete opening duties. Isolde did not complete daily cleaning duties. on november 2, 2026"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "the card reads \"this reads as **Standards of Conduct** — assigned work that wasn't completed\", not Care and Cleaning of Equipment and Facilities (no Late Opening/Attendance and no \"as you said\" in the pack; the live \"as you said\" comes from the answering model)" },
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("Write me a CA for Isolde Brannock for failing to complete opening duties. Isolde did not complete daily cleaning duties. on november 2, 2026");
      expect(thread.proposal, "no CA card for Isolde Brannock").toMatchObject({ templateKey: "dpoa", employeeName: "Isolde Brannock" });
      expect(reply.content, "the card says \"as you said\" about a policy she never named").not.toMatch(/as you said/i);
      const policy = policyLine(reply);
      expect(policy, `the card cites Late Opening or Attendance:\n${reply.content}`).not.toMatch(/late opening|attendance/i);
      expect(policy, `the card does not cite Care and Cleaning:\n${reply.content}`).toMatch(/care and cleaning of equipment and facilities/i);
      t.draftWrites({ observation: "Observed:\nIsolde Brannock did not complete the daily cleaning duties at opening on November 2, 2026." });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.form_date, "the Date is not 11/2/2026").toBe("2026-11-02");
      expect(values.policy_violated ?? "", "Policy Violated is Late Opening or Attendance").not.toMatch(/late opening|attendance/i);
    },
  },
  {
    /* Coverage (QA): steps 2/3/7, covered. */
    id: "nov4-scan-sf-s16-standards-of-conduct-turn-2",
    title: "\"In the past we have quoted the standards of conduct …\" switches the policy to Standards of Conduct (p.12); the Observation stays the underperformance",
    report: `${REPORT}, sf-s16: "put together a corrective action for Calista Venn due to under performance in salon metrics for the month of october" → "In the past we have quoted the standards of conduct for creating a ca due to underperformance"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "turn 2 does switch the card to Standards of Conduct p.12, but the card's Observation of Offense becomes the account plus the instruction \"In the past we have quoted the standards of conduct for creating a ca due to underperformance\"" },
    async run(t) {
      const thread = start(t);
      await thread.say("put together a corrective action for Calista Venn due to under performance in salon metrics for the month of october");
      expect(thread.proposal, "no CA card for Calista Venn").toMatchObject({ templateKey: "dpoa", employeeName: "Calista Venn" });
      const reply = await thread.say("In the past we have quoted the standards of conduct for creating a ca due to underperformance");
      expect(policyLine(reply), `turn 2 does not switch the policy to Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      expect(reply.content, "the card does not cite Standards of Conduct p.12").toMatch(/standards of conduct[^\n]*p\.\s?12/i);
      expect(observationLine(reply), "the card's Observation carries the policy instruction").not.toMatch(/in the past we have quoted/i);
      t.draftWrites({ observation: "Observed:\nCalista Venn under performed in salon metrics for the month of October." });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
      expect(described(t), "the policy instruction was handed over as the account").not.toMatch(/in the past we have quoted/i);
      expect(values.observation ?? "", "the Observation carries the policy instruction").not.toMatch(/in the past we have quoted|standards of conduct/i);
    },
  },
  {
    /* Coverage (QA): steps 6+7, covered. */
    id: "nov4-scan-sf-s17-woven-courses-written",
    title: "a written CA for not completing Woven courses by Oct 31 — the incident is taken as given; turn 2 cites Standards of Conduct; the Observation stays the courses",
    report: `${REPORT}, sf-s17: "put together a written CA for Marit Sollano for not compelting her woven courses by the deadline of october 31st" → "you can reference the standards of conduct for a policy"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "turn 1 takes the incident as given and is Written, and turn 2 cites Standards of Conduct, but the card's Observation of Offense becomes the account plus \"you can reference the standards of conduct for a policy\"" },
    async run(t) {
      const thread = start(t);
      const first = await thread.say("put together a written CA for Marit Sollano for not compelting her woven courses by the deadline of october 31st");
      expect(first.content, "turn 1 says nothing happened yet").not.toMatch(/haven'?t told me what happened|what happened\?/i);
      expect(thread.proposal, `turn 1 made no CA card for Marit Sollano:\n${first.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Marit Sollano" });
      expect(warningLevel(thread.proposal), "the card is not the Written Warning she asked for").toBe("written");
      const reply = await thread.say("you can reference the standards of conduct for a policy");
      expect(policyLine(reply), `turn 2 does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      expect(observationLine(reply), "the card's Observation carries the policy instruction").not.toMatch(/you can reference/i);
      t.draftWrites({ observation: "Observed:\nMarit Sollano did not complete her Woven courses by the October 31 deadline." });
      const id = await thread.create();
      expect(t.values(id).policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
      expect(described(t), "the policy instruction was handed over as the account").not.toMatch(/you can reference/i);
    },
  },
  {
    /* Coverage (QA): step 7 partly; the contradictory notice is NOT COVERED. */
    id: "nov4-scan-sf-s18-standards-named-no-contradiction",
    title: "\"… violating the standards of conduct for under performace …\" — the policy is Standards of Conduct, as she said, and the card never says both \"no section to quote\" and a section",
    report: `${REPORT}, sf-s18: "put together a corrective action form for Calista Venn violating the standards of conduct for under performace in the month of october"`,
    // Run 4 Nov 2026 (production flags): holds — the card cites "Standards of Conduct, as you said" and never says there is no section. A passing guard.
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("put together a corrective action form for Calista Venn violating the standards of conduct for under performace in the month of october");
      expect(thread.proposal, "no CA card for Calista Venn").toMatchObject({ templateKey: "dpoa", employeeName: "Calista Venn" });
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      expect(reply.content, "the card says there is no section to quote and cites one").not.toMatch(/no (?:policy )?section to quote|no section (?:of the manual )?(?:to|I can) quote/i);
    },
  },
  {
    /* Coverage (QA): step 6, partial until then. */
    id: "nov4-scan-sf-s19-corrective-action-answer",
    title: "\"Corrective Action\" after a verbal CA request for Odalys Frewen — proceed with the Verbal CA, or say once what is needed; never the same refusal word for word",
    report: `${REPORT}, sf-s19: "I need a corrective action verbal for Odalys Frewen. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %." → "Corrective Action"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "turn 1 refuses (\"I won't open formal corrective action off a metric\" and the progression list), and turn 2 \"Corrective Action\" gets \"That's the same answer as my last reply\" with no card: it never proceeds with the Verbal CA she chose" },
    async run(t) {
      const thread = start(t);
      const first = await thread.say("I need a corrective action verbal for Odalys Frewen. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.");
      const second = await thread.say("Corrective Action");
      noRepeatedReply([first, second]);
      // She answered "Which one do you need?" with the Corrective Action: refusing again, in any words, is the repeat.
      expect(second.content, `turn 2 refuses again:\n${second.content}`).not.toMatch(/same answer as my last reply|won'?t open formal corrective action/i);
      const proceeds = second.formProposal?.templateKey === "dpoa" && second.formProposal?.employeeName === "Odalys Frewen";
      const explains = !second.formProposal && /\?/.test(second.content);
      expect(proceeds || explains, `turn 2 neither proceeds with the CA for Odalys Frewen nor says what is needed:\n${second.content}`).toBe(true);
      if (thread.proposal) expect(warningLevel(thread.proposal), "the card is not the Verbal Warning she chose").toBe("verbal");
    },
  },
  {
    /* Coverage (QA): step 5, covered. */
    id: "nov4-scan-sf-s20-now-one-for-lysandra",
    title: "\"Now make one for LYsandra\" after a coaching form for Jovelle Kerrigan — confirm \"Lysandra Quade?\" or make her card; never \"I have the employee\" without naming her",
    report: `${REPORT}, sf-s20: "create a coaching document for Jovelle Kerrigan" → "Now make one for LYsandra"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "turn 2 \"Now make one for LYsandra\" keeps the card on Jovelle Kerrigan and says \"I have the employee and the salon\" without naming Lysandra Quade or asking" },
    async run(t) {
      const thread = start(t);
      await thread.say("create a coaching document for Jovelle Kerrigan");
      expect(thread.proposal, "no coaching card for Jovelle Kerrigan").toMatchObject({ templateKey: "coaching", employeeName: "Jovelle Kerrigan" });
      const reply = await thread.say("Now make one for LYsandra");
      const card = reply.formProposal?.templateKey === "coaching" && reply.formProposal?.employeeName === "Lysandra Quade";
      const confirms = /Lysandra Quade/.test(reply.content) && /\?/.test(reply.content);
      expect(card || confirms, `neither a coaching card for Lysandra Quade nor "Lysandra Quade?":\n${reply.content}`).toBe(true);
      if (/I have the employee/i.test(reply.content)) expect(reply.content, "\"I have the employee\" without naming her").toMatch(/Lysandra Quade/);
    },
  },
  {
    /* Coverage (QA): step 5 for the typo; the job-title source is NOT COVERED. */
    id: "nov4-scan-sf-b5-typo-name-rude-to-customer",
    title: "a Verbal CA for \"Delphine Marlwoe Ostrander\" (Delphine Marlowe Ostrander) — dated 10/31/2026, payroll deduct No, Standards of Conduct, her own job title (never \"District Manager\")",
    report: `${REPORT}, sf-b5 (the sibling app's chat, in this app's setting): "create a ca form for Delphine Marlwoe Ostrander" → "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude …"`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "the card is for \"Delphine Marlwoe Ostrander\" as typed (the roster's Delphine Marlowe Ostrander is not matched), and the Job title is \"District Manager\", read from \"spoke with District manager …\"" },
    async run(t) {
      const thread = start(t);
      await thread.say("create a ca form for Delphine Marlwoe Ostrander");
      const reply = await thread.say(
        "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude when she brought up that the register was charging for scent in her lotion refills and it has never done that before. When Delphine spoke with District manager Tobias Wrenfield she said the customer had raised her voice first and she only explained the price.",
      );
      expect(thread.proposal, `no CA card for Delphine Marlowe Ostrander:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Delphine Marlowe Ostrander" });
      expect(warningLevel(thread.proposal), "the card is not the Verbal Warning she said").toBe("verbal");
      expect(thread.proposal?.employeeRole ?? "", "the job title is District Manager").not.toMatch(/district manager/i);
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      t.draftWrites({ observation: "Observed:\nOn October 31, 2026 a customer reported that Delphine was rude to her when she asked about a charge at the register." });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.employee_name).toBe("Delphine Marlowe Ostrander");
      expect(values.job_title ?? "", "the job title is District Manager").not.toMatch(/district manager/i);
      expect(values.job_title ?? "", "the job title is not the roster's").toBe("Tanning Consultant");
      expect(values.form_date, "the Date is not 10/31/2026").toBe("2026-10-31");
      expect(t.checked(id).warning_type, "not a Verbal Warning").toEqual(["verbal"]);
      expect(t.checked(id).payroll_deduct, "payroll deduct is not No").toEqual(["no"]);
      expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
    },
  },
  /*
   * Pau, 5 Nov 2026 (overnight scan sf-s29, PAST_FORMS_BEFORE_LIBRARY_ENABLED):
   * "are there any coaching and ca's for <name>" was answered from the forms
   * library ("Yes. **Corrective Action Form** — …"), not from that person's
   * forms on file. With the flag, a message the forms library would answer
   * that names a person or asks about forms already on file reads the forms
   * on file; the library answer steps aside. Invented names.
   */
  ...(
    [
      ["sf-s29-coaching-and-cas", "are there any coaching and ca's for Jovelle Kerrigan", { open: "answered from the forms library (\"Yes. **Corrective Action Form** — …\"), not from Jovelle Kerrigan's forms on file" }],
      ["sf-s29-named-library-question", "do we have a coaching form for Jovelle Kerrigan?", { open: "answered from the forms library (\"Yes. **Coaching Form** — …\"), not from Jovelle Kerrigan's forms on file" }],
    ] as const
  ).map(
    ([key, text, status]): ReplayCase => ({
      id: `nov5-scan-${key}`,
      title: `sf-s29: "${text}" — answered from the forms on file, never the forms-library answer`,
      report: `Pau, 5 Nov 2026 (overnight scan sf-s29): "are there any coaching and ca's for <name>"`,
      status,
      fixFlags: ["PAST_FORMS_BEFORE_LIBRARY_ENABLED"],
      async run(t) {
        const thread = start(t);
        const reply = await thread.say(text);
        expect(thread.proposal, `a form card for a question about forms on file:\n${reply.content}`).toBeNull();
        expect(reply.content, `the forms-library answer:\n${reply.content}`).not.toMatch(/I can create it here|is filed under|^Yes\. \*\*/);
      },
    }),
  ),
  {
    id: "nov5-scan-sf-s29-control-library-question",
    title: "negative control: \"do we have a coaching form?\" still gets the forms-library answer",
    report: "Pau, 5 Nov 2026 (overnight scan sf-s29): the negative control",
    status: "fixed",
    fixFlags: ["PAST_FORMS_BEFORE_LIBRARY_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("do we have a coaching form?");
      expect(reply.content, `not the forms-library answer:\n${reply.content}`).toMatch(/^Yes\. \*\*Coaching Form\*\*/);
    },
  },
];

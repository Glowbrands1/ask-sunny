import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayThread } from "./cases";

/*
 * STEP B'S OPEN CASES (3 Nov 2026), ported from Ask Bubbles (d130fa40): the
 * mechanism of each report, in this app's own setting (salons, salon titles,
 * invented people). One form-update path is coming (FORM_PATCH_REDUCER_ENABLED
 * + FORM_REPLY_FROM_DIFF_ENABLED, same flags in both apps): what the manager
 * says in chat reaches the open draft's fields, a typed field is never
 * blanked, a redraft merges, payroll and dates go in exactly as given, and the
 * reply about the form comes only from what really changed. Each case asserts
 * that invariant on what is SAVED and what is CLAIMED. All are open: the fix
 * is not in this app yet, so there are no fixFlags; the pull request that
 * wires the fix adds them with the scripted model stub.
 *
 * The drafting and revision models are left at the pack's defaults (they
 * write nothing) unless a case says otherwise: the drafting model was never
 * handed the details (its prompt held only the turns before the card), and
 * the revision model wrote nothing the manager asked for.
 */

const PEOPLE: DirectoryRow[] = [...STAFF, { id: "hr-pat", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }];

/** A reply that says the form changed: a `formUpdate`, or words saying so about the form. */
const CLAIM = /\b(?:updated|added|now reads|now says|applied|is on the card|that'?s on the card|reflected on)\b/i;
function claimsChange(reply: ReplayAnswer): boolean {
  if (reply.formUpdate?.updated.length) return true;
  return reply.content.split("\n").some((line) => CLAIM.test(line) && /\b(?:form|draft|card|details|observation)\b/i.test(line));
}

/**
 * One turn on the open draft: the reply may say the form changed only when the
 * saved values did change.
 */
async function turnOnDraft(t: Parameters<ReplayCase["run"]>[0], thread: ReplayThread, id: string, text: string): Promise<ReplayAnswer> {
  const before = JSON.stringify(t.values(id));
  const reply = await thread.say(text);
  if (claimsChange(reply)) {
    expect(JSON.stringify(t.values(id)), `"${text}": the reply says the form changed, and the saved draft did not`).not.toBe(before);
  }
  return reply;
}

/** Every way a date can be written on a form: 10-1-26, 10/01/2026, 2026-10-01, October 1, 2026, Oct 1. */
const DATE_SHAPES =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "10-1-26" → "10-01"; "2026-10-01" → "10-01"; "October 1, 2026" → "10-01" (month and day only; the year is checked by the Date field). */
function monthDay(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[2]}-${iso[3]}`;
  const numeric = /^(\d{1,2})[-/](\d{1,2})/.exec(text);
  if (numeric) return `${numeric[1]!.padStart(2, "0")}-${numeric[2]!.padStart(2, "0")}`;
  const named = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})/i.exec(text);
  const month = named ? MONTH_NAMES.indexOf(named[1]!.toLowerCase()) : -1;
  return month < 0 ? null : `${String(month + 1).padStart(2, "0")}-${named![2]!.padStart(2, "0")}`;
}

export const NOV3_STEP_B_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-stepb-copy-keeps-details",
    title: "\"ok, create the draft, but include the details of the cleaning checklist.\" — the copied draft holds the checklist details she gave",
    report:
      'Ask Bubbles replay set b13, the mechanism here: "can you create the same draft that we did with <name> by changing the name and position?" → "ok, create the draft, but include the details of <the process>." — the new draft had none of the details',
    status: { open: "the details she gave never reach Marnie's open draft, so the copy made from it has none: the revision path writes nothing" },
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const details =
        "this is what i am wanting to coach on: closing the tanning rooms, here are the details of the process: wipe the bed with the approved cleaner, use the cleaning checklist and initial each room in order of last guest first. Restock lotion samples, fold towels, once the room is ready, then mark it clean on the check-in screen.";
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "for whole staff - tanning consultants", "Marnie", "yes"]) await thread.say(turn);
      /*
       * "the same draft that we did with marnie holloway": her draft was made,
       * so the pack presses Create on her card, as the manager did. The
       * details then go to Marnie's open draft, and Juno's is copied from it.
       */
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
      const marnie = await thread.create();
      for (const turn of [
        details,
        "add details about the cleaning checklist",
        "Do the same coaching form for juno paxton",
        "can you create the same draft that we did with marnie holloway by changing the name and position?",
        "ok, create the draft, but include the details of the cleaning checklist.",
      ]) {
        await thread.say(turn);
      }
      expect(t.values(marnie).coaching_details ?? "", "Marnie's draft does not hold the details she gave").toMatch(/cleaning checklist/i);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Juno Paxton" });
      const juno = await thread.create();
      const copied = t.values(juno).coaching_details ?? "";
      expect(copied, "Juno's draft does not hold the cleaning-checklist details").toMatch(/cleaning checklist/i);
      expect(copied, "Juno's draft does not hold the room order, last guest first").toMatch(/last guest first/i);
    },
  },
  {
    id: "nov3-stepb-make-that-update",
    title: "\"make that update\" and \"I need to add that the room …\" reach the team draft's Details, and no reply says updated without a change",
    report:
      'Ask Bubbles replay set b15 (rated 3), the mechanism here: "i don\'t see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically updating?" → "make that update" → … → "the changes weren\'t made in the details"',
    status: { open: "the open team draft's Details of Coaching never receives the new room flow or the 10-minute rule; the revision path writes nothing" },
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("can you create a coaching form for my whole staff?");
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", subject: "team" });
      const id = await thread.create();
      for (const turn of [
        "coaching is on room turnover for clean organization and flow.  Our district manager has flagged our salon due to marking rooms ready within 0 minutes of the guest checking out.  So we are implementing a new flow.  when a guest checks out, the room will be logged on the turnover clipboard, in order of checkout, then those rooms will be cleaned in order, and the bed wiped and the towels replaced, once rooms are all cleaned, the clipboard will go back to the front desk, initialed, and then mark the rooms ready.   Then, the next round of checkouts will be logged in order on the clipboard.",
        "this is perfect",
        "i don't see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?",
        "make that update",
      ]) {
        await turnOnDraft(t, thread, id, turn);
      }
      expect(t.values(id).coaching_details ?? "", 'after "make that update" the Details do not hold the new flow').toMatch(/turnover clipboard/i);
      for (const turn of [
        "can i reopen this for an edit?",
        "I need to add that the room must not be marked ready until 10 minutes has passed form the guest checking out.",
        "the changes weren't made in the details",
      ]) {
        await turnOnDraft(t, thread, id, turn);
      }
      expect(t.values(id).coaching_details ?? "", "the 10-minute rule is not in the Details").toMatch(/room must not be marked ready until 10 minutes/i);
      expect(t.values(id).coaching_details ?? "", "adding the 10-minute rule dropped the flow").toMatch(/turnover clipboard/i);
    },
  },
  {
    id: "nov3-stepb-write-the-observation",
    title: "\"yes, do that\" / \"write the observtion\" put what Rowan did on the draft, and no reply says updated without a change",
    report:
      'Ask Bubbles replay set b17 (rated 2), the mechanism here: "<name> marked <a thing> as <done> but <it wasn\'t>" → "yes, do that" → "it didnt edit in the card" → "the details we just discussed!!!" → "write the observtion"',
    status: { open: "Rowan's Details of Coaching stays empty through \"yes, do that\" and \"write the observtion\"; the revision path writes nothing" },
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Rowan", "yes"]) await thread.say(turn);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      for (const turn of [
        "spray tan booth, when to press start session and when to press session complete",
        "can you upate the draft with these details of coaching?",
        "rowan marked a session as complete but the guest hadn't been sprayed yet",
        "yes, do that",
      ]) {
        await turnOnDraft(t, thread, id, turn);
      }
      const said = /rowan marked a session as complete but the guest hadn't been sprayed yet/i;
      expect(t.values(id).coaching_details ?? "", 'after "yes, do that" the draft does not say what Rowan did').toMatch(said);
      for (const turn of ["it didnt edit in the card", "the details we just discussed!!!", "write the observtion"]) {
        await turnOnDraft(t, thread, id, turn);
      }
      expect(t.values(id).coaching_details ?? "", 'after "write the observtion" the draft does not say what Rowan did').toMatch(said);
    },
  },
  {
    id: "nov3-stepb-payroll-as-given",
    title: "\"payroll deduct applies and $3.25 will be deducted from check\" — Yes, $3.25 exactly in its own field, and the manager-only action plan does not gain it",
    report:
      'HR, 21 Oct 2026: "create ca form for pat rivera for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check."',
    /*
     * BEHAVIOUR DIFFERENCE FROM ASK BUBBLES (docs/parity-log/2026-11-03-step-b-form-patch.md):
     * here ACTION_PLAN_MANAGER_ONLY_ENABLED is on in production, so the Action
     * Plan is the manager's alone and Step B never writes the deduction into
     * it. The $3.25 goes to the Payroll deduction amount field, verbatim. That
     * already holds with production's flags (replayed 3 Nov 2026), so the case
     * is "fixed" here; it is open in Ask Bubbles, whose plan gains the sentence.
     */
    status: "fixed",
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create ca form for pat rivera for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check.");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera" });
      // The Yes/No group is saved as a ticked option, which `t.values` (text values only) cannot read; the card's reading is checked instead.
      expect((thread.proposal as { payrollDeduct?: string | null }).payrollDeduct, "the card does not read payroll deduct as Yes").toBe("yes");
      const id = await thread.create();
      const values = t.values(id);
      expect(values.payroll_deduct_amount, "the amount is not $3.25 as given").toBe("$3.25");
      expect(values.action_plan ?? "", "the manager-only action plan was given the deduction").not.toMatch(/\$3\.25/);
      expect(JSON.stringify(values), "an amount she did not give is on the form").not.toMatch(/\$(?!3\.25\b)\d/);
    },
  },
  {
    id: "nov3-stepb-date-as-given",
    title: "the incident date \"on 10-1-26\" is the form's Date, written once, and no other date is invented",
    report:
      'HR, 21 Oct 2026: the form "repeated the date of the offense" and "used 10-21-26 instead of 10-1-26"',
    status: { open: "the incident date is written twice: the Date field and again in the Observation (\"… on 10-1-26\")" },
    async run(t) {
      // HR's report was written on 21 Oct 2026; "today" must not leak onto the form.
      vi.setSystemTime(new Date("2026-10-21T15:30:00Z"));
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create verbal ca for pat rivera, she was late to salon 15 minutes on 10-1-26. no payroll deduct");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera" });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.form_date, "the Date is not the incident date she gave").toBe("2026-10-01");
      const dates = Object.entries(values).flatMap(([key, value]) => (value.match(DATE_SHAPES) ?? []).map((text) => ({ key, text, day: monthDay(text) })));
      expect(dates.filter((date) => date.day !== "10-01"), "a date she did not give is on the form").toEqual([]);
      expect(dates.map((date) => `${date.key}: ${date.text}`), "the incident date is written more than once").toEqual(["form_date: 2026-10-01"]);
    },
  },
  {
    id: "nov3-stepb-prior-coaching-kept",
    title: "a prior coaching \"signed May 2025\" added to the open Corrective Action reaches Prior Actions, or the reply says it did not",
    report:
      "the 2 Nov scan (s8): the manager gave the prior coaching and when it was signed; it was not on the form, and the reply said everything else was as it was",
    status: { open: "Prior Actions stays empty and the reply says the form is \"as it was\" without saying the prior coaching was not placed" },
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("CA for Remy Calder for underperformance in the month of October");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      const id = await thread.create();
      const reply = await turnOnDraft(t, thread, id, "Previous coaching was when she signed the policy manual, signed May 2025");
      expect(reply.formProposal, "the turn about her open draft offered a new card").toBeUndefined();
      expect(t.values(id).prior_actions ?? "", "Prior Actions does not hold the coaching signed May 2025").toMatch(/may 2025/i);
      expect(reply.content, "the prior coaching was dropped and the reply says the form is as it was").not.toMatch(/\bas it was\b|nothing else (?:has )?changed/i);
    },
  },
];

import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * ONCE THE ACCOUNT IS REWRITTEN, THE MADE-ABOUT TURN FINISHES (QA's live round-13 test, 9 Nov 2026)
 * ============================================================================
 *
 * QA's live test of round 13 (the person on this app's pack roster): a saved Coaching draft about the missed monthly
 * meeting on 10/10/26, its Details ending "Going Forward" and "Policy reference: Attendance Policy, JBA Policy Manual p.14".
 * "make it about leaving the front desk unattended on 11/6/26" answered "Updated the Coaching Form for …: Details of
 * Coaching. Everything else on the form is as it was." Only Details changed (its Going Forward and the policy line
 * gone); Other and the Date stayed. The live trace had two revision calls: the made-about path's revision rewrote
 * Details, then the reader's own edits were refused, the turn left the patch path, and the old path's revision ran
 * again. The reader's live output is not stored; a refused reader edit (here one that would blank Other) is the scripted
 * shape that gives the same form and reply. MADE_ABOUT_REWRITE_FINISHES_ENABLED (`forms/form-patch-turn.ts`).
 */
const SAID = "make it about leaving the front desk unattended on 11/6/26";
const ATTENDANCE_LINE = "Policy reference: Attendance Policy, JBA Policy Manual p.14";
const DETAILS = `Observed:\nMarnie Holloway missed the monthly meeting on 10/10/26.\n\nExpectation:\nMarnie is expected to attend every scheduled meeting.\n\nGoing Forward:\nMarnie will attend every meeting.\n\n${ATTENDANCE_LINE}`;
const DESK = "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to keep the front desk covered at all times.";
const OTHER = { field: "other_topic", value: "Leaving the front desk unattended", how: "replace", evidence: "leaving the front desk unattended" } as const;
const DET = { field: "coaching_details", value: DESK, how: "replace", evidence: "leaving the front desk unattended on 11/6/26" } as const;
const WORK_AREA_LINE = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Unapproved absence from the work area during a shift",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};
const FIX = [
  ...STEP_B_READER_FLAGS,
  "EDIT_MAKE_IT_ABOUT_ENABLED",
  "STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED",
  "STEP_B_DATE_SAID_ENABLED",
  "STEP_B_DATE_WITH_ABOUT_ENABLED",
  "MADE_ABOUT_ALL_OR_NOTHING_ENABLED",
  "MADE_ABOUT_READER_ACCOUNT_ENABLED",
  "MADE_ABOUT_POLICY_LINE_ENABLED",
  "MADE_ABOUT_REWRITE_FINISHES_ENABLED",
];
const UNDATED_FIX = [...FIX, "MADE_ABOUT_UNDATED_TOGETHER_ENABLED"];
const LATE_SAID = "make it about showing up late";
const LATE = "Observed:\nMarnie Holloway showed up late.\n\nExpectation:\nMarnie is expected to arrive on time for every shift.";
const REPORT = "QA's live round-13 test (9 Nov 2026): only Details changed (Going Forward and the policy line gone), Other and the Date stayed";

async function onDraft(t: ReplayContext, reading: unknown, revised = DESK, beforeTurn?: (t: ReplayContext) => void) {
  vi.setSystemTime(new Date("2026-11-09T22:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([WORK_AREA_LINE]);
  t.patchReads!({ [SAID]: reading as never });
  const thread = t.thread();
  await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
  t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  t.revisionWrites({ coaching_details: revised });
  beforeTurn?.(t);
  const revisionsBefore = t.calls().revision;
  const reply = await thread.say(SAID);
  return { id, reply, revisions: t.calls().revision - revisionsBefore };
}

function allThree(reading: unknown, revised = DESK) {
  return async (t: ReplayContext) => {
    const { id, reply, revisions } = await onDraft(t, reading, revised);
    const saved = t.values(id);
    expect(saved.form_date, `the Date:\n${reply.content}`).toBe("2026-11-06");
    expect(saved.other_topic ?? "", `Other:\n${reply.content}`).toMatch(/front desk/i);
    expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/front desk unattended on 11\/6\/26/);
    expect(saved.coaching_details ?? "", `the new account's reference:\n${saved.coaching_details}`).toMatch(/Policy reference: Standards of Conduct Policy, JBA Policy Manual p\.13$/);
    expect(saved.coaching_details ?? "", "the old account's reference is kept").not.toMatch(/Attendance/);
    expect(reply.content, `the reply does not say the Date changed:\n${reply.content}`).toMatch(/Changed Date to/);
    expect(revisions, "the old path's revision ran a second time").toBe(1);
  };
}

export const NOV9_MADE_ABOUT_REWRITE_FINISHES_CASES: ReplayCase[] = [
  {
    id: "nov9-made-about-rewrite-finishes-reader-refused",
    title: "the live shape: Details rewritten, then the reader's own edit refused — Other, the Date and the new reference still written, one revision",
    report: REPORT,
    // Changed on purpose (10 Nov 2026): fixed in production by MADE_ABOUT_REWRITE_FINISHES + READER_ACCOUNT + POLICY_LINE, QA round 14 (UNDATED_TOGETHER stays off).
    status: "fixed",
    fixFlags: FIX,
    run: allThree(patch("this_form", [{ ...OTHER, value: "" }, DET])),
  },
  {
    id: "nov9-made-about-rewrite-finishes-old-line-kept",
    title: "the revision keeps the old \"Attendance … p.14\" line on the new account: it is replaced by the new account's reference",
    report: `${REPORT} (the old account's reference left on the new one)`,
    // Changed on purpose (10 Nov 2026): fixed in production by MADE_ABOUT_REWRITE_FINISHES + READER_ACCOUNT + POLICY_LINE, QA round 14 (UNDATED_TOGETHER stays off).
    status: "fixed",
    fixFlags: FIX,
    run: allThree(patch("this_form", [OTHER, DET]), `${DESK}\n\n${ATTENDANCE_LINE}`),
  },
  {
    id: "nov9-made-about-rewrite-finishes-details-only",
    title: "the reader sets Details only (set aside): Other is read from the manager's words, with the Date and the new reference",
    report: `${REPORT} (the reader's Details-only shape)`,
    // Changed on purpose (10 Nov 2026): fixed in production by MADE_ABOUT_REWRITE_FINISHES + READER_ACCOUNT + POLICY_LINE, QA round 14 (UNDATED_TOGETHER stays off).
    status: "fixed",
    fixFlags: FIX,
    run: allThree(patch("this_form", [DET])),
  },
  {
    id: "nov9-made-about-rewrite-finishes-error-after-rewrite",
    title: "a save fails after Details is rewritten: the old path never runs again, and the reply says Other and the Date were not saved",
    report: `${REPORT} (the catch-all after the rewrite)`,
    // Changed on purpose (10 Nov 2026): fixed in production by MADE_ABOUT_REWRITE_FINISHES + READER_ACCOUNT + POLICY_LINE, QA round 14 (UNDATED_TOGETHER stays off).
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { id, reply, revisions } = await onDraft(t, patch("this_form", [OTHER, DET]), DESK, (ctx) => ctx.failSavesOf!("other_topic"));
      const saved = t.values(id);
      expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/front desk unattended on 11\/6\/26/);
      expect(revisions, "the old path's revision ran a second time").toBe(1);
      expect(reply.content, `the reply does not say what was not saved:\n${reply.content}`).toMatch(/couldn't save the change to .*\*\*Other\*\*/);
      expect(reply.content, `the reply does not say the Date was not saved:\n${reply.content}`).toMatch(/couldn't save the change to .*\*\*Date\*\*/);
      expect(saved.form_date, "the Date changed although the reply says it was not saved").toBe("2026-10-10");
    },
  },
  {
    id: "nov9-made-about-rewrite-finishes-undated-reader-details",
    title: "QA's live turn 2, \"make it about showing up late\" (no date), the reader rewrites Details: Details and Other together, the Date stays and the reply says so",
    report: `${REPORT} (turn 2: "make it about showing up late" answered "I haven't changed …")`,
    status: { open: "an undated made-about turn whose reader rewrote Details is refused and handed to the old path" },
    fixFlags: UNDATED_FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T22:01:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      t.patchReads!({
        [LATE_SAID]: patch("this_form", [
          { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
          { field: "coaching_details", value: LATE, how: "replace", evidence: "showing up late" },
        ]) as never,
      });
      const thread = t.thread();
      await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
      t.draftWrites({ coaching_details: DESK, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: LATE });
      const revisionsBefore = t.calls().revision;
      const reply = await thread.say(LATE_SAID);
      const saved = t.values(id);
      expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/showed up late/);
      expect(saved.other_topic ?? "", `Other:\n${reply.content}`).toMatch(/late/i);
      expect(saved.form_date, "the Date changed with no date said").toBe("2026-10-10");
      expect(reply.content, `the reply does not say the Date stays:\n${reply.content}`).toMatch(/stays 2026-10-10/);
      expect(t.calls().revision - revisionsBefore, "the old path's revision ran a second time").toBe(1);
    },
  },
];

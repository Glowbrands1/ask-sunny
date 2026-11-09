import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * THE REWRITTEN ACCOUNT'S POLICY REFERENCE IS WRITTEN AGAIN (QA's live round-11 test, 9 Nov 2026)
 * ============================================================================
 *
 * QA's live test on round 11 (the chain on; the person on this app's pack roster): a saved Coaching draft whose Details
 * ended "Policy reference: Attendance Policy, JBA Policy Manual p.14". "make it about leaving the front desk unattended on
 * 11/6/26" changed Other, the Date and Details together, and the line went with the old account: no Standards of Conduct
 * reference was written. MADE_ABOUT_POLICY_LINE_ENABLED (`forms/made-about-policy-line.ts`). The pack's manual (wording
 * invented) also has the Standards of Conduct line the incident is cited by, on printed page 13; the revision writes the
 * new Details without a reference, as live.
 */
const SAID = "make it about leaving the front desk unattended on 11/6/26";
const ATTENDANCE_LINE = "Policy reference: Attendance Policy, JBA Policy Manual p.14";
const DETAILS = `Observed:\nMarnie Holloway missed the monthly meeting on 10/10/26.\n\nExpectation:\nMarnie is expected to attend every scheduled meeting.\n\n${ATTENDANCE_LINE}`;
const DESK = "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to keep the front desk covered at all times.";
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
  "MADE_ABOUT_POLICY_LINE_ENABLED",
];
const REPORT = "QA's live round-11 test (9 Nov 2026): \"Policy reference: Attendance … p.14\" went with the old account; none for the new one";

const TOWELS = "Observed:\nMarnie Holloway folded the towels wrong on 11/6/26.\n\nExpectation:\nMarnie is expected to fold the towels as shown.";

async function onDraft(t: ReplayContext, details: string, said = SAID, revised = DESK) {
  vi.setSystemTime(new Date("2026-11-09T16:30:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([WORK_AREA_LINE]);
  const thread = t.thread();
  await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
  t.draftWrites({ coaching_details: details, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  t.revisionWrites({ coaching_details: revised });
  const reply = await thread.say(said);
  return { id, reply };
}

export const NOV9_MADE_ABOUT_POLICY_LINE_CASES: ReplayCase[] = [
  {
    id: "nov9-made-about-policy-line-rewritten",
    title: "Details ending \"Policy reference: Attendance Policy … p.14\", \"make it about leaving the front desk unattended on 11/6/26\": the new Details carries the Standards of Conduct reference, p.13",
    report: REPORT,
    status: { open: "the new Details carries no policy reference" },
    fixFlags: FIX,
    async run(t) {
      const { id, reply } = await onDraft(t, DETAILS);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `Details:\n${reply.content}`).toMatch(/front desk unattended on 11\/6\/26/);
      expect(details, `the new reference:\n${details}`).toMatch(/Policy reference: Standards of Conduct Policy, JBA Policy Manual p\.13$/);
      expect(details, "the old account's reference is kept").not.toMatch(/Attendance/);
    },
  },
  {
    id: "nov9-made-about-policy-line-no-section",
    title: "negative: \"make it about folding the towels wrong on 11/6/26\" (no section of the manual): the old Attendance reference never comes back",
    report: `${REPORT} (the condition: no section found, no reference rather than the old account's)`,
    // Open on main: with the chain off the old Details, and its Attendance reference, are kept whole.
    status: { open: "the old Details and its Attendance reference stay (the chain off)" },
    fixFlags: FIX,
    async run(t) {
      const { id, reply } = await onDraft(t, DETAILS, "make it about folding the towels wrong on 11/6/26", TOWELS);
      expect(t.values(id).coaching_details ?? "", `the old reference came back:\n${reply.content}`).not.toMatch(/Attendance/);
    },
  },
];

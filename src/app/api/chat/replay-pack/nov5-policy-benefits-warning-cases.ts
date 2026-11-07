import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A BENEFITS "WARNING" NEVER GOES ONTO A CORRECTIVE ACTION (QA, 5 Nov 2026, severe)
 * ============================================================================
 *
 * Ported from the sibling app. There, a real location manager (4× 1-star), revising a Corrective Action Form: "in the previously recieved coaching
 * include that <name> signed the jba policy manual on 10-15-26". The reply said Direct policy "now cites
 * Standards of Conduct (page 12) and Warning (page 36)", and the saved Direct policy quoted the manual's 401k sheet
 * headed "Warning" ("… before your legal retirement age unless you transfer it to an IRA"). The bare "that" read as
 * a reference back, and the app's own "**Verbal Warning** or **Written Warning**?" named the heading
 * (`forms/chat-policy-change.ts`). Here "warning" is no section (policy-change.ts NOT_A_SECTION), so the sheet is
 * never cited, but the turn is still taken as a policy change ("I couldn't find a section called …") and the
 * revision never runs. The manager's words, with an invented person on the pack's roster.
 */
const FIX = ["POLICY_CHANGE_RELEVANT_ENABLED"];

export const NOV5_POLICY_BENEFITS_WARNING_CASES: ReplayCase[] = [
  {
    id: "nov5-policy-benefits-warning-revision",
    title: "a CA asked its warning level, then \"in the previously recieved coaching include that marnie holloway signed the jba policy manual on 10-15-26\": Direct policy never cites the manual's benefits \"Warning\"",
    report: "QA, 5 Nov 2026 (severe; a location manager's revision): Direct policy cited the 401k sheet \"Warning\" (page 36)",
    status: { open: "the reply is \"I couldn't find a section called 'marnie holloway signed the jba' …\": a policy change, so the revision never runs" },
    fixFlags: FIX,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("corrective action");
      await thread.say("marnie holloway");
      await thread.say("marnie did not acknowledge woven policies by the due date 10/31");
      t.draftWrites({});
      const id = await thread.create();
      const reply = await thread.say("in the previously recieved coaching include that marnie holloway signed the jba policy manual on 10-15-26");
      expect(reply.content, `the reply cites the benefits "Warning":\n${reply.content}`).not.toMatch(/\*\*Warning\*\* \(page 36\)|income taxes|retirement age/);
      expect(reply.content, `the turn is taken as a policy change:\n${reply.content}`).not.toMatch(/I couldn't find a section called/);
      expect(t.values(id).policy_language ?? "", "Direct policy quotes the benefits sheet").not.toMatch(/legal retirement age|income taxes|\bIRA\b/);
    },
  },
  {
    id: "nov6-policy-change-relevant-remove-attendance",
    title: "a CA cites Attendance, then \"take the attendance policy off the form\": Attendance is removed, with POLICY_CHANGE_RELEVANT on too",
    report: "The sibling app's flip-3 gate, 6 Nov 2026: with POLICY_CHANGE_RELEVANT_ENABLED on, the form's option \"Attendance Policy\" was taken out of the manager's words, so the section was not found",
    status: "fixed",
    fixFlags: ["POLICY_CHANGE_RELEVANT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("corrective action");
      await thread.say("marnie holloway");
      await thread.say("marnie was 30 minutes late to her shift on 10/31");
      t.draftWrites({});
      const id = await thread.create();
      await thread.say("add the attendance policy");
      expect(t.values(id).policy_language ?? "", "Attendance was never cited").toMatch(/Attendance/);
      const reply = await thread.say("take the attendance policy off the form");
      expect(reply.content, `the section was not found:\n${reply.content}`).not.toMatch(/I couldn't find a section called/);
      expect(t.values(id).policy_language ?? "", "Attendance is still cited").not.toMatch(/Attendance/);
    },
  },
];

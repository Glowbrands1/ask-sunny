import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "REFERENCE THE LATE OPENING POLICY INSTEAD OF THE ATTENDANCE POLICY" NAMES LATE OPENING (QA, 12 Nov 2026)
 * ============================================================================
 *
 * QA's live report: the turn was answered "Attendance, as you said", the opposite of what the manager asked. With
 * production's flags (FORM_EDIT_DATE_RULES on: a policy named after "instead of" is the one set aside) the card reads
 * Late Opening, as asked, whatever the slot model's heading; the opposite answer is reproduced only with
 * FORM_EDIT_DATE_RULES off. A GUARD on that wording until the live turn's path is known. The person is the pack's.
 */
const SAYS = [
  "create corrective action for Marnie Holloway for Late Opening from the policy manual. It is a verbal warning",
  "can you add late opening policy to the direct policy section of this from",
  "can you reference the late opening policy INSTEAD of the attendance policy",
];

export const NOV12_INSTEAD_OF_POLICY_CASES: ReplayCase[] = ([null, "Attendance"] as const).map(
  (heading): ReplayCase => ({
    id: `nov12-instead-of-names-late-opening${heading ? "-model-heading-attendance" : ""}`,
    title: `"${SAYS[2]}"${heading ? " (the slot model's heading Attendance)" : ""}: the Policy line is Late Opening, never "Attendance, as you said"`,
    report: "QA, 12 Nov 2026: the live turn was answered \"Attendance, as you said\"",
    status: "fixed",
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(SAYS[0]!);
      await thread.say(SAYS[1]!);
      if (heading) t.slotsRead({ employee: "Marnie Holloway", formType: "Corrective Action Form", formTurn: true, policyHeading: heading });
      const reply = (await thread.say(SAYS[2]!)).content;
      const policy = reply.split("\n").find((line) => line.startsWith("**Policy:**")) ?? "";
      expect(policy, reply).toMatch(/^\*\*Policy:\*\* Late Opening\b/);
      expect(reply, reply).not.toMatch(/Attendance, as you said/);
    },
  }),
);

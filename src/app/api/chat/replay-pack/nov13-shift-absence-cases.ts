import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * MISSED WEEKEND SHIFTS AND "DIDN'T CALL IN" CITE ATTENDANCE (QA's ruling (a), 13 Nov 2026)
 * ============================================================================
 *
 * Found by the CA_NO_POLICY_ASKS_WHICH replay diff (Ask Bubbles #848): these built Corrective Action cards had no Policy
 * line, though the account is Attendance. The managers' words from sf-s38 and the term-CA case; people on the pack's
 * roster. SHIFT_ABSENCE_WIDER_ENABLED (`forms/ca-policy.ts`), ported from Ask Bubbles.
 */
const REPORT = "QA's ruling (a) on CA_NO_POLICY_ASKS_WHICH, 13 Nov 2026";

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function policyLine(content: string): string {
  return content.split("\n").find((line) => line.startsWith("**Policy:**")) ?? "";
}

export const NOV13_SHIFT_ABSENCE_CASES: ReplayCase[] = [
  {
    id: "nov13-shift-absence-weekend-shifts-cite-attendance",
    title: "\"missing her saturday and sunday shifts … failed to communicate\": the CA card cites Attendance",
    report: `${REPORT}: sf-s38's wording, no Policy line`,
    status: { open: "the card has no Policy line" },
    fixFlags: ["SHIFT_ABSENCE_WIDER_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(
        "make me an CA for Marnie Holloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley",
      );
      expect(thread.proposal, `no CA card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Marnie Holloway" });
      expect(policyLine(reply.content), reply.content).toMatch(/\*\*Policy:\*\* Attendance\b/);
    },
  },
  {
    id: "nov13-shift-absence-didnt-call-in-cites-attendance",
    title: "\"I need a term CA for <B> because she didn't call in.\": the CA card cites Attendance",
    report: `${REPORT}: the term-CA wording, no Policy line`,
    status: { open: "the card has no Policy line" },
    fixFlags: ["SHIFT_ABSENCE_WIDER_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a term CA for Remy Calder because she didn't call in.");
      expect(thread.proposal, `no CA card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      expect(policyLine(reply.content), reply.content).toMatch(/\*\*Policy:\*\* Attendance\b/);
    },
  },
  {
    id: "nov13-shift-absence-call-in-order-guard",
    title: "guard: \"she didn't call in the order\" is no missed shift — no Attendance policy is read from it",
    report: `${REPORT}: guard`,
    status: "fixed",
    fixFlags: ["SHIFT_ABSENCE_WIDER_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a CA for Remy Calder, she didn't call in the order to the vendor on 11/9");
      expect(policyLine(reply.content), reply.content).not.toMatch(/\*\*Policy:\*\* Attendance\b/);
    },
  },
];

import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "SHE WAS LATE" IS ATTENDANCE, WHATEVER THE MODEL'S HEADING (QA, the Sunny round-10 live test, 9 Nov 2026;
 * LATE_READS_ATTENDANCE_ENABLED)
 * ============================================================================
 *
 * "create a CA for <P>, she was late on 11/6/26" gave "Policy: Late Opening — read from this request", Late Opening
 * p.15, in 1 of 6 live runs (Attendance p.14 in the other 5): the policy came from the model's heading. Here the model
 * is scripted to that heading. QA's wording; the pack's invented person.
 */
const FIX = ["LATE_READS_ATTENDANCE_ENABLED"];
const REPORT = "QA, the Sunny round-10 live test (9 Nov 2026): \"she was late on 11/6/26\" cited Late Opening in 1 of 6 runs";
const POLICY = (content: string) => /^\*\*Policy:\*\*[^\n]*/m.exec(content)?.[0] ?? "";

async function reply(t: ReplayContext, said: string, heading: string) {
  vi.setSystemTime(new Date("2026-11-09T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.slotsRead({ policyHeading: heading });
  return t.thread().say(said);
}

async function card(t: ReplayContext, said: string, heading: string) {
  return (await reply(t, said, heading)).content;
}

/** The heading each source card starts with ("Late Opening. …"). */
const SOURCE_HEADINGS = (citations: readonly unknown[] | undefined) =>
  (citations ?? []).map((citation) => String((citation as { excerpt?: unknown }).excerpt ?? "").split(".")[0]!.trim());

export const NOV9_LATE_READS_ATTENDANCE_CASES: ReplayCase[] = [
  {
    id: "nov9-late-reads-attendance",
    title: "\"create a CA for <P>, she was late on 11/6/26\", the model's heading Late Opening: the card cites Attendance",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by LATE_READS_ATTENDANCE_ENABLED, QA round 13, 9 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const content = await card(t, "create a CA for Marnie Holloway, she was late on 11/6/26", "Late Opening");
      expect(POLICY(content), `the Policy line:\n${content}`).toMatch(/^\*\*Policy:\*\* Attendance\b/);
    },
  },
  {
    /*
     * Gate-Sunny's invariant (11 Nov 2026): nov9-late-reads-attendance checks the Policy line only, and passed while the
     * same card's Action Plan said "review the Late Opening policy" and its Sources were Late Opening p.15 (QA's live
     * r22 + r26 turn). The Action Plan and the Sources must read Attendance too. Open on production's flags; holds with
     * LATE_SLOT_READS_ATTENDANCE_ENABLED (#789), which puts the slots on Attendance.
     */
    id: "nov9-late-reads-attendance-plan-and-sources",
    title: "\"create a CA for <P>, she was late on 11/6/26\", the model's heading Late Opening: the Action Plan and the Sources are Attendance too",
    report: `${REPORT}; Gate-Sunny, 11 Nov 2026: the Policy line alone passed while the plan and Sources said Late Opening`,
    // Changed on purpose (11 Nov 2026): fixed in production by LATE_SLOT_READS_ATTENDANCE, QA round 29. Was OPEN.
    status: "fixed",
    fixFlags: [...FIX, "LATE_SLOT_READS_ATTENDANCE_ENABLED"],
    async run(t) {
      const answer = await reply(t, "create a CA for Marnie Holloway, she was late on 11/6/26", "Late Opening");
      const content = answer.content;
      expect(POLICY(content), `the Policy line:\n${content}`).toMatch(/^\*\*Policy:\*\* Attendance\b/);
      // Changed on purpose (CARD_PLAN_MATCHES_CREATE, QA's 17l ruling (B), 12 Nov 2026): with that flag the card shows Pau's
      // attendance plan, the one Create saves ("… Leadership will monitor <first>'s attendance closely …").
      expect(content, `the Action Plan:\n${content}`).toMatch(/\*\*Action Plan:\*\* (?:Management will review the Attendance policy\b|\S+ is expected to arrive on time[^\n]*attendance closely)/);
      expect(SOURCE_HEADINGS((answer as { citations?: readonly unknown[] }).citations), `the Sources:\n${content}`).toContain("Attendance");
      expect(SOURCE_HEADINGS((answer as { citations?: readonly unknown[] }).citations), `the Sources:\n${content}`).not.toContain("Late Opening");
      expect(content, `no Late Opening anywhere on the card:\n${content}`).not.toMatch(/Late Opening/);
    },
  },
  {
    id: "nov9-late-opening-stays-late-opening",
    title: "must not change: \"create a CA for <P>, late opening the salon on 11/6/26\" cites Late Opening, whatever the heading",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      for (const heading of ["Late Opening", "Attendance"]) {
        const content = await card(t, "create a CA for Marnie Holloway, late opening the salon on 11/6/26", heading);
        expect(POLICY(content), `the Policy line (heading ${heading}):\n${content}`).toMatch(/Late Opening/);
      }
    },
  },
];

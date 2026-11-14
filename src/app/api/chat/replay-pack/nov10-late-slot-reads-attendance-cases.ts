import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "SHE WAS LATE": THE WHOLE CARD SAYS ATTENDANCE, NOT ONLY ITS POLICY LINE (QA, live Sunny after #784, 10 Nov 2026,
 * 14:48:37Z; LATE_SLOT_READS_ATTENDANCE_ENABLED)
 * ============================================================================
 *
 * "create a corrective action for <T>, she was late on 11/3/26": the reply said "**Policy:** Attendance — read from this
 * request" (LATE_READS_ATTENDANCE corrects the code's reading), but the card's Action Plan said "Management will review
 * the Late Opening policy" and its Sources Late Opening p.15: those follow the model's heading kept in the slots
 * (policyHeading "Late Opening", which the model returns in some runs). Here the model is scripted to that heading.
 * QA's wording; the pack's invented person.
 */
const FIX = ["LATE_SLOT_READS_ATTENDANCE_ENABLED"];
const REPORT = "QA, live Sunny (10 Nov 2026, 14:48:37Z): \"she was late on 11/3/26\" — Policy line Attendance, Action Plan and Sources Late Opening";

async function card(t: ReplayContext, said: string, heading: string) {
  vi.setSystemTime(new Date("2026-11-10T14:48:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.slotsRead({ policyHeading: heading });
  return (await t.thread().say(said)).content;
}

const line = (content: string, label: string) => new RegExp(`^\\*\\*${label}:\\*\\*[^\\n]*`, "m").exec(content)?.[0] ?? "";

export const NOV10_LATE_SLOT_READS_ATTENDANCE_CASES: ReplayCase[] = [
  {
    id: "nov10-late-slot-reads-attendance",
    title: "\"create a corrective action for <T>, she was late on 11/3/26\", the model's heading Late Opening: the Policy line, the Action Plan and the Sources all say Attendance",
    report: REPORT,
    // Changed on purpose (11 Nov 2026): fixed in production by LATE_SLOT_READS_ATTENDANCE, QA round 29. Was OPEN.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const content = await card(t, "create a corrective action for Marnie Holloway, she was late on 11/3/26", "Late Opening");
      expect(line(content, "Policy"), `the Policy line:\n${content}`).toMatch(/^\*\*Policy:\*\* Attendance\b/);
      // Changed on purpose (CARD_PLAN_MATCHES_CREATE, QA's 17l ruling (B), 12 Nov 2026): Pau's attendance plan reviews
      // attendance in its own words ("… monitor <first>'s attendance closely …").
      expect(line(content, "Action Plan"), `the Action Plan:\n${content}`).toMatch(/Attendance|attendance closely/);
      expect(content, `the card still names Late Opening:\n${content}`).not.toMatch(/Late Opening/);
    },
  },
  {
    id: "nov10-failure-to-open-stays-late-opening",
    title: "must not change: \"failure to open on time\" is never turned into Attendance by this flag (an opening; coding 6's FAILURE_TO_OPEN_IS_LATE_OPENING reads it)",
    report: `${REPORT} (the negative: an opening is Late Opening)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const content = await card(t, "create a corrective action for Marnie Holloway, failure to open on time on 11/3/26", "Late Opening");
      // An opening is never read as Attendance by this flag; what it is read as is coding 6's (FAILURE_TO_OPEN_IS_LATE_OPENING).
      expect(line(content, "Policy"), `the Policy line turned to Attendance:\n${content}`).not.toMatch(/\bAttendance\b/);
      expect(line(content, "Action Plan"), `the Action Plan turned to Attendance:\n${content}`).not.toMatch(/\bAttendance\b/);
    },
  },
];

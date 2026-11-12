/**
 * ============================================================================
 * "SHE WAS LATE" IS ATTENDANCE IN THE SLOTS TOO (LATE_SLOT_READS_ATTENDANCE_ENABLED)
 * ============================================================================
 *
 * QA, live Sunny after #784 (10 Nov 2026, 14:48:37Z): "create a corrective action for <T>, she was late on 11/3/26".
 * The reply's Policy line said "Attendance — read from this request" (LATE_READS_ATTENDANCE corrects the code's own
 * reading, `forms/ca-policy.ts`), but the card's Action Plan and Sources said Late Opening p.15: they follow the model's
 * heading kept in the slots, which is Late Opening in some runs. With the flag on, that heading is Attendance too when
 * the manager's words say an employee was late or tardy and never say "open" ("late opening", "failure to open on
 * time", "opened late" stay Late Opening). Pure: the caller decides when the flag applies.
 */
const LATE_ARRIVAL =
  /\b(?:was|were|is|been|came\s+in|arrived|showed\s+up|clocked\s+in|running|being)\s+(?:\S+\s+){0,2}?late\b|\b(?:tardy|tardies|tardiness|lateness)\b|\blate\s+(?:to|for)\s+(?:her|his|their|a|the|work|shift)/i;
const OPENING_WORD = /\bopen(?:s|ed|ing|er|ers)?\b/i;
const LATE_OPENING = /^\s*late\s+opening\s*$/i;

/** The heading the slots keep: Attendance for a late arrival the model headed "Late Opening"; the heading otherwise. */
export function lateSlotHeading(heading: string | null, managerWords: string, attendanceHeading = "Attendance"): string | null {
  if (!heading || !LATE_OPENING.test(heading)) return heading;
  if (!LATE_ARRIVAL.test(managerWords) || OPENING_WORD.test(managerWords)) return heading;
  return attendanceHeading;
}

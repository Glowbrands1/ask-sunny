# Ask Sunny only: "she was late" keeps Attendance in the slots (LATE_SLOT_READS_ATTENDANCE_ENABLED)

**The finding.** QA's live Sunny test after #784 (10 Nov 2026, 14:48:37Z): "create a corrective action for <T>, she was late on 11/3/26" replied "Policy: Attendance — read from this request", but the card's Action Plan and Sources said Late Opening p.15. The Policy line comes from the code's reading (LATE_READS_ATTENDANCE corrects it); the Action Plan and Sources follow the model's heading kept in the slots, Late Opening in some runs.

**The fix.** With the flag on, `ai/intent-slots.ts` reads that heading as Attendance when the manager's words say an employee was late and never say "open" (`ai/late-slot-attendance.ts`).

**Not needed in Ask Bubbles.** There the slot heading is the code's own reading, and the reader's heading only fills in when the code has none (`ai/reader/merge.ts`). Checked through its replay pack on main (10 Nov 2026): with the reader scripted to "Late Opening", "create a corrective action for <T>, she was late on 11/3/26" gives "Policy: Attendance … page 14" and "Action plan: Management will review the Attendance policy". No disagreement to fix.

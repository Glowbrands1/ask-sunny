# Sunny-only: LATE_READS_ATTENDANCE_ENABLED ("she was late" is Attendance, whatever the model's heading)

QA, the Sunny round-10 live test (9 Nov 2026): "create a CA for <P>, she was late on 11/6/26" cited Late Opening in 1 of
6 runs, from the model's heading (the app's own reading of its policy line). With the flag, an employee late or tardy
with no "open" word reads as Attendance; "late opening the salon" stays Late Opening.

Not needed in the sibling app (checked on its main 4060d6de, the model scripted to either heading): the plain late
already reads as Attendance from the manual's own words, and "late opening the store" as Late Opening. Its replay
pack carries the case as a guard, both directions (its branch claude/late-reads-attendance).

# "Where can I find the day an employee signed the JBA policy manual": the loop reads it from the Corrective Action's own box (the 266-chat run's 115; QA's item 14 (a)): same gap in Ask Bubbles, port pending

**Report (Ask Sunny, the 266-chat run, re-checked on main 7787aa9):** with a CA card on screen, "where can I find the day
an employee signed the JBA policy manual" got "Nothing in the company knowledge base covers where …" and "check Woven or
HR", and the follow-up the same.

**Finding (item 14):** the app keeps that date only as a field on each Corrective Action (`policy_manual_signed`, "List
date of JBA policy manual signed by employee", CA revision 9, manager-typed, required). No employee-level record, no
Woven field. read_form already returns it for a visible form (with the forms-on-file privacy evidence); nothing told
the model so.

**Fix (QA's option (a)):** a Forms on file rules-book line (where the date is, read <P>'s latest CA with
find_past_forms and read_form, give the date and say which form; with none, say it is only kept on Corrective Actions
and none on file has it; never "the knowledge base has nothing") and a read_form description line naming the field.
Text built from the field's own key and label constants. Fixtures re-taken. Options (b) a find_past_forms column and
(c) an employee-level field are parked (QA).

**Ask Bubbles: same gap.** Bubbles' Corrective Action has the same box (`prior-actions.ts`, `policy_manual_signed`, the
same label; Bubbles reads the manual as Buff City Soap's, never rename the manual title) and no line telling the model.
Port the rules-book line, the read_form line, fixtures, and the replay case below with Bubbles' roster and store.

**Tests:** replay `nov23-agent-loop-manual-signed-date-cases.ts` (115's exact words, an invented person): with a CA on
file holding a date, the model is shown the guidance and read_form returns the date; with none, the model is told what
to say. Both fail before the lines, pass after.

# An exit card with payroll "No" never says payroll deduction is ticked (the 266-chat run's 036): same bug in Ask Bubbles, port pending

**Report (Ask Sunny, the 266-chat run, re-checked on main 7787aa9):** for "… payroll is not deducted …" on an exit, the
loop replied "**Is payroll deduct applicable?** No, as you said." and then "Payroll deduction is ticked as you said; the
form has no amount line". Cause: propose_form's `payroll_question_only` fact fired for any payroll answer, "no"
included, without saying the answer, and the rules book told the model to say deduction "is ticked as the manager said".

**Fix (the mechanism):** the fact leads with the card's own answer ("Payroll deduction on the card: Yes / No / not
set."), and the rules book line has the model say that answer, never "ticked" for a No, and the amount line only when
there is an amount or reason. Fixtures re-taken (noted in app-config.test).

**Ask Bubbles: same bug.** On Bubbles main 1e58cd6, `tools.ts` (the `payroll_question_only` fact) and `rules-book.ts`
(the "payroll deduction is ticked as the manager said" line) are identical. Port the mechanism: the fact's first
sentence and the rules-book line; re-take Bubbles' fixtures; the replay case below with Bubbles' roster and store.

**Tests:** replay `nov22-agent-loop-exit-payroll-no-never-ticked-cases.ts` (the manager's exact words, an invented
person): fails before (the note does not say No), passes after; a control with payroll Yes.
